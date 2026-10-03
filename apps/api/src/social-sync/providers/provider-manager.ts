import { Injectable, Logger } from "@nestjs/common";
import { YoutubeAdapter } from "./youtube.adapter";
import { XAdapter } from "./x.adapter";
import { TiktokAdapter } from "./tiktok.adapter";
import { InstagramAdapter } from "./instagram.adapter";
import { DouyinAdapter } from "./douyin.adapter";
import type { SocialProviderAdapter } from "./social-provider.adapter";
import {
  SOCIAL_PROVIDERS,
  allProviderConfigurations,
  isSocialProvider,
  providerConfiguration,
  type SocialProviderConfig,
  type SocialProviderId,
} from "../social-sync.config";

/**
 * The one place a provider id becomes an adapter.
 *
 * ## Why this exists rather than a switch in each caller
 *
 * Every consumer — the authorization endpoint, the callback, the sync job, the settings
 * screen — needs to go from a provider id to behaviour. A switch in each of them is the same
 * knowledge copied four times, and the copies drift: one gets a new platform, the others do
 * not, and the symptom is a platform that authorizes but never syncs.
 *
 * ## Why the registry is a field and not a switch
 *
 * A `Map` built once from the adapter list means "which platforms exist" is answered by the
 * list, and adding a platform is adding an entry to it. A `switch` would need a default
 * branch, and a default branch is how an unknown provider silently becomes a supported one.
 */
@Injectable()
export class ProviderManager {
  private readonly logger = new Logger(ProviderManager.name);

  private readonly adapters: ReadonlyMap<SocialProviderId, SocialProviderAdapter>;

  constructor() {
    const list: SocialProviderAdapter[] = [
      new YoutubeAdapter(),
      new XAdapter(),
      new TiktokAdapter(),
      new InstagramAdapter(),
      new DouyinAdapter(),
    ];
    this.adapters = new Map(list.map((adapter) => [adapter.provider, adapter]));

    /**
     * A provider in the enum with no adapter is a wiring mistake that would otherwise appear
     * as "this platform is unavailable" at runtime. Checked at construction so it fails on
     * boot instead.
     */
    const missing = SOCIAL_PROVIDERS.filter((provider) => !this.adapters.has(provider));
    if (missing.length > 0) {
      throw new Error(`No adapter registered for: ${missing.join(", ")}`);
    }
  }

  /** The adapter, or undefined for a value that is not a provider at all. */
  find(provider: string): SocialProviderAdapter | undefined {
    if (!isSocialProvider(provider)) return undefined;
    return this.adapters.get(provider);
  }

  /**
   * The adapter for a provider that must exist.
   *
   * Callers validate the provider id from their input first, so reaching the throw means the
   * registry and `SOCIAL_PROVIDERS` disagree — a programming error, not user input.
   */
  require(provider: string): SocialProviderAdapter {
    const adapter = this.find(provider);
    if (!adapter) {
      throw new Error(`ProviderManager has no adapter for ${provider}`);
    }
    return adapter;
  }

  /**
   * Every advertised platform with its availability, for the settings screen.
   *
   * `canReadPosts` is included so the client can distinguish "you have not connected this
   * yet" from "this cannot be connected on this deployment" without duplicating the
   * approval list.
   */
  catalogue(env: NodeJS.ProcessEnv = process.env): Array<SocialProviderConfig & { canReadPosts: boolean }> {
    return allProviderConfigurations(env).map((config) => ({
      ...config,
      canReadPosts: this.adapters.get(config.provider)?.canReadPosts ?? false,
      // The secret never leaves the server, even in a management response.
      clientSecret: "",
    }));
  }

  configuration(provider: SocialProviderId, env: NodeJS.ProcessEnv = process.env): SocialProviderConfig {
    return providerConfiguration(provider, env);
  }
}
