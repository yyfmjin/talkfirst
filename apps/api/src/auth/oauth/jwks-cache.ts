import { createPublicKey, type JsonWebKeyInput } from "node:crypto";

/**
 * A JWK as it arrives from a provider, for the RSA public keys this app accepts.
 *
 * Declared locally instead of using `crypto.JsonWebKey` because that type needs
 * an index signature, which a value parsed from JSON does not have — and using
 * the DOM's global `JsonWebKey` fails the other way (no index signature at all,
 * so it is not assignable to `JsonWebKeyInput`). The fields listed are exactly
 * what `createPublicKey` reads for `kty: "RSA"`; anything else in the document is
 * ignored, and a document missing these is rejected by `createPublicKey`.
 */
type RsaJwk = {
  kty: string;
  n: string;
  e: string;
  kid?: string;
  use?: string;
  alg?: string;
};

/**
 * Provider JWKS (JSON Web Key Set) 的获取与缓存。
 *
 * ## Why this is hand-written instead of a library
 *
 * The whole job is: fetch a small JSON document, cache it, look a key up by
 * `kid`. `jwks-rsa` would add a dependency and a second HTTP client for that, and
 * Node already has both `fetch` and the JWK→PEM conversion it needs
 * (`crypto.createPublicKey({ key, format: "jwk" })`). Fewer moving parts in the
 * one place that decides whether a token is authentic.
 *
 * ## The two failure modes it has to survive
 *
 *  - **Key rotation.** The provider publishes new keys and keeps the old ones for
 *    a while. A cached set that is *stale* must not be fatal: an unknown `kid` is
 *    the signal to refetch once, immediately, because that is what rotation looks
 *    like from here.
 *  - **A hanging or hostile endpoint.** A fetch that never settles would pin a
 *    login attempt forever, and an unbounded response body is a memory problem.
 *    Both are bounded below (5s, 1MiB).
 */

/** Cache lifetime for a fetched key set. Rotation is handled by the refetch. */
const CACHE_TTL_MS = 5 * 60 * 1000;
/**
 * Floor between two fetches triggered by an unknown `kid`.
 *
 * Without it, an attacker sending tokens with random `kid`s turns every login
 * attempt into an outbound request to the provider — using this API as a
 * traffic amplifier against Google, and burning our own rate limit.
 */
const MIN_REFETCH_INTERVAL_MS = 30 * 1000;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_BODY_BYTES = 1024 * 1024;

type CachedJwks = {
  keys: Map<string, ReturnType<typeof createPublicKey>>;
  fetchedAt: number;
};

export type JwksFetcher = (uri: string, init: { signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

export class JwksCache {
  private readonly cache = new Map<string, CachedJwks>();
  private readonly inflight = new Map<string, Promise<CachedJwks>>();
  /** When an unknown-`kid` refetch was last allowed, per URI. See `getKey`. */
  private readonly lastMissRefetchAt = new Map<string, number>();

  constructor(
    private readonly fetchImpl: JwksFetcher = globalThis.fetch as unknown as JwksFetcher,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * The verification key for `kid`.
   *
   * `kid` is required: a key set may legitimately hold several keys, and picking
   * one without a match would mean guessing which key the provider signed with —
   * i.e. accepting a token whose signature was not checked against the right key.
   * Only a SINGLE-key set is accepted without a `kid`, which is the one case
   * where the choice is not ambiguous.
   */
  async getKey(uri: string, kid: string | undefined): Promise<ReturnType<typeof createPublicKey> | null> {
    const cached = this.cache.get(uri);
    const fresh = cached && this.now() - cached.fetchedAt < CACHE_TTL_MS;

    if (fresh) {
      const key = this.select(cached, kid);
      if (key) return key;
      /**
       * Unknown `kid` against a fresh cache means one of two things:
       *
       *  - the provider rotated and our set is stale — the common, legitimate
       *    case, which must NOT fail a login that should succeed;
       *  - the token is forged with a made-up `kid`, and refetching every time
       *    would turn each attempt into an outbound request to the provider.
       *
       * Both are served by refetching at most once per `MIN_REFETCH_INTERVAL_MS`
       * and falling back to the cached set in between. The FIRST such miss is
       * always allowed through, which is what makes rotation work: a floor that
       * applied to the first miss would deny every rotated key for 30 seconds
       * after the previous fetch, and the E2E suite (which signs in repeatedly)
       * hit exactly that.
       */
      const lastMiss = this.lastMissRefetchAt.get(uri) ?? 0;
      if (this.now() - lastMiss < MIN_REFETCH_INTERVAL_MS) return null;
      this.lastMissRefetchAt.set(uri, this.now());
    }

    const fetched = await this.load(uri);
    return this.select(fetched, kid);
  }

  private select(cached: CachedJwks, kid: string | undefined) {
    if (kid) return cached.keys.get(kid) ?? null;
    // No `kid` on the token: only unambiguous when the set holds exactly one key.
    if (cached.keys.size === 1) return [...cached.keys.values()][0];
    return null;
  }

  /** One in-flight fetch per URI, so a burst of logins does not fan out. */
  private async load(uri: string): Promise<CachedJwks> {
    const existing = this.inflight.get(uri);
    if (existing) return existing;

    const promise = this.fetchKeys(uri).finally(() => {
      this.inflight.delete(uri);
    });
    this.inflight.set(uri, promise);
    return promise;
  }

  private async fetchKeys(uri: string): Promise<CachedJwks> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let body: string;
    try {
      const response = await this.fetchImpl(uri, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`JWKS request failed with HTTP ${response.status}`);
      }
      body = await response.text();
    } finally {
      clearTimeout(timer);
    }

    if (body.length > MAX_BODY_BYTES) {
      throw new Error("JWKS response is implausibly large");
    }

    const parsed = JSON.parse(body) as { keys?: RsaJwk[] };
    if (!Array.isArray(parsed.keys)) {
      throw new Error("JWKS response has no keys array");
    }

    const keys = new Map<string, ReturnType<typeof createPublicKey>>();
    for (const jwk of parsed.keys) {
      if (!jwk?.kid) continue;
      /**
       * A single malformed key must not discard the whole set: the good keys in
       * it are exactly what a login needs while the provider cleans up.
       *
       * `as JsonWebKeyInput` because the parsed JSON is structurally a JWK but
       * carries no static type — the cast is on the boundary of untrusted input,
       * and `createPublicKey` is what actually validates it (a bad key throws and
       * is skipped).
       */
      try {
        keys.set(jwk.kid, createPublicKey({ key: jwk, format: "jwk" } as unknown as JsonWebKeyInput));
      } catch {
        continue;
      }
    }

    const entry: CachedJwks = { keys, fetchedAt: this.now() };
    this.cache.set(uri, entry);
    return entry;
  }
}
