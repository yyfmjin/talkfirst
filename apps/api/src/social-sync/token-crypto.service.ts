import { Injectable, Logger } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { InsecureConfigurationError, allowsInsecureDefaults } from "../common/security-config";

/**
 * Encryption for third-party OAuth tokens at rest.
 *
 * ## Why this is not "just store the token"
 *
 * An access token for a member's social account is a bearer credential: anyone who
 * reads the row can act as that member at the provider until it expires, and a
 * refresh token lets them keep doing it. A database dump, a replica, a backup that
 * ends up in the wrong bucket, or a log line that dumps a whole row would all leak
 * usable credentials. Encrypting at rest means a leaked dump alone is not enough.
 *
 * ## Why a dedicated key rather than an existing secret
 *
 * `JWT_ACCESS_SECRET` already signs sessions, and reusing it would mean one leak
 * invalidates both sessions and stored tokens, and rotating it for either reason
 * breaks the other. `TOKEN_ENCRYPTION_KEY` is separate so it can be rotated on its
 * own schedule.
 *
 * ## Why the key is REQUIRED in production instead of defaulting
 *
 * The tempting shortcut is a development fallback literal, as `jwtSecretOrDevFallback`
 * does. That is wrong here: a deployment that forgot to set the variable would
 * silently encrypt real members' social tokens with a key published in the source
 * tree. Anyone with the repository could then decrypt the tokens of every user of
 * that deployment. Signing a session with a known key is bad; decryptable stored
 * credentials are worse, because the attacker does not need to be online when it
 * happens. So production refuses to boot without it, and only an explicitly
 * development process gets a fallback.
 *
 * ## Algorithm and envelope
 *
 * AES-256-GCM: authenticated encryption, so a tampered ciphertext fails to decrypt
 * rather than silently yielding different plaintext. A fresh random 96-bit IV per
 * encryption (GCM's recommended size) because reusing an IV with the same key is
 * catastrophic for GCM.
 *
 * The stored string is versioned:
 *
 *     v1.<iv-b64>.<authTag-b64>.<ciphertext-b64>
 *
 * The `v1` prefix is what makes a future algorithm or key change possible without
 * guessing at the format of existing rows. `decrypt` refuses an envelope whose
 * version it does not know rather than trying and failing obscurely.
 *
 * ## Never logged
 *
 * No method here logs its input or output. `redact` exists so the one place that
 * might want to (a token-refresh failure path) has a safe alternative.
 */

/** Envelope version. Bump only alongside a migration that rewrites stored rows. */
const ENVELOPE_VERSION = "v1";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const ENV_NAME = "TOKEN_ENCRYPTION_KEY";

/**
 * Fixed scrypt salt.
 *
 * A per-row salt would defend against rainbow tables over the KEY, but the key is
 * not a human password — it is a random 32+ byte secret with full entropy, so a
 * precomputed table over it is not a realistic attack. A fixed salt still removes
 * the "same key material reused directly" property of passing the env value
 * straight to `createCipheriv`, which also lets a shorter configured secret
 * contribute properly to the 32-byte key. Per-encryption IVs (above) are what
 * provide the actual uniqueness.
 */
const KDF_SALT = "talkfirst:social-token:v1";

/** Cached derived key. scrypt is deliberately slow; deriving per call would be wasteful. */
let cachedKey: Buffer | null = null;
let cachedSource: string | null = null;

function deriveKey(secret: string): Buffer {
  if (cachedKey && cachedSource === secret) return cachedKey;
  cachedKey = scryptSync(secret, KDF_SALT, KEY_BYTES);
  cachedSource = secret;
  return cachedKey;
}

/**
 * Boot-time check for the encryption key.
 *
 * Mirrors `assertDeviceSaltConfigured`: a development process may run without it,
 * anything else may not.
 */
export function assertTokenEncryptionKeyConfigured(env: NodeJS.ProcessEnv = process.env): void {
  if (allowsInsecureDefaults(env)) return;
  if ((env[ENV_NAME] ?? "").trim()) return;
  throw new InsecureConfigurationError(
    `${ENV_NAME} is not set, so third-party social tokens cannot be stored safely. ` +
      `Set it to a random value (at least 32 characters), or set NODE_ENV=development ` +
      `(or ALLOW_INSECURE_DEFAULTS=true) if this really is a development process. ` +
      `Rotating this value makes every previously stored token undecryptable, which ` +
      `requires affected members to reconnect their accounts.`,
  );
}

/** Thrown when a stored envelope cannot be decrypted. Never carries the value. */
export class TokenDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenDecryptionError";
  }
}

@Injectable()
export class TokenCryptoService {
  private readonly logger = new Logger(TokenCryptoService.name);

  private secret(): string {
    const configured = (process.env[ENV_NAME] ?? "").trim();
    if (configured) return configured;
    if (allowsInsecureDefaults(process.env)) {
      /**
       * Development-only fallback. Reaching this in production is impossible because
       * `assertTokenEncryptionKeyConfigured` runs at boot, but the check is repeated
       * here so a module exercised outside the normal bootstrap cannot quietly
       * encrypt with a known key.
       */
      return "talkfirst-development-only-token-key";
    }
    throw new InsecureConfigurationError(
      `${ENV_NAME} is not set and this is not a development process.`,
    );
  }

  /** Encrypts a token for storage. Returns the versioned envelope. */
  encrypt(plaintext: string): string {
    if (typeof plaintext !== "string" || plaintext.length === 0) {
      throw new TokenDecryptionError("Cannot encrypt an empty token");
    }
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, deriveKey(this.secret()), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      ENVELOPE_VERSION,
      iv.toString("base64"),
      tag.toString("base64"),
      ciphertext.toString("base64"),
    ].join(".");
  }

  /**
   * Decrypts a stored envelope.
   *
   * Throws `TokenDecryptionError` for a malformed envelope, an unknown version, a
   * failed authentication tag, or a key that no longer matches. The message says
   * which of those happened; it never includes the ciphertext or the plaintext.
   */
  decrypt(envelope: string): string {
    const parts = (envelope ?? "").split(".");
    if (parts.length !== 4) {
      throw new TokenDecryptionError("Stored token is not in the expected envelope format");
    }
    const [version, ivB64, tagB64, dataB64] = parts;
    if (version !== ENVELOPE_VERSION) {
      throw new TokenDecryptionError(`Unsupported token envelope version: ${version}`);
    }

    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const data = Buffer.from(dataB64, "base64");
    if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES) {
      throw new TokenDecryptionError("Stored token envelope is malformed");
    }

    try {
      const decipher = createDecipheriv(ALGORITHM, deriveKey(this.secret()), iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    } catch (error) {
      /**
       * A GCM authentication failure is indistinguishable from "the key was rotated"
       * at this layer. Both are reported as unrecoverable-for-this-row, and the caller
       * marks the connection `NEEDS_REAUTH` rather than retrying.
       */
      this.logger.warn(`Could not decrypt a stored social token: ${(error as Error).message}`);
      throw new TokenDecryptionError(
        "Stored token could not be decrypted (wrong key, or the value was tampered with)",
      );
    }
  }

  /**
   * Decrypts, or returns null instead of throwing.
   *
   * For the background sync, where one undecryptable row must not abort the whole
   * run — it should mark that one connection `NEEDS_REAUTH` and continue.
   */
  tryDecrypt(envelope: string | null | undefined): string | null {
    if (!envelope) return null;
    try {
      return this.decrypt(envelope);
    } catch {
      return null;
    }
  }

  /**
   * A short, fixed-length, non-reversible marker for logging.
   *
   * Use this instead of a token in any log line. It is a truncated SHA-256 of the
   * stored envelope, so it is stable for the same row (useful for correlating two
   * log lines) without revealing any byte of it.
   *
   * ## Why not a prefix of the ciphertext
   *
   * The first attempt returned `<enc:${ciphertext.slice(0,6)}…>`, which is wrong for
   * short values: a 1-byte token encrypts to a 2-character base64 fragment, so the
   * "prefix" was the ENTIRE ciphertext — the marker leaked exactly what it was
   * meant to hide. A hash has a length independent of the input, which removes the
   * whole class of problem rather than narrowing it.
   */
  redact(envelope: string | null | undefined): string {
    if (!envelope) return "<none>";
    const digest = createHash("sha256").update(envelope).digest("hex");
    return `<enc:${digest.slice(0, 8)}>`;
  }
}
