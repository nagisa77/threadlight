import type {
  ModelAttachment,
  ModelGenerateOptions,
  ModelRequest,
  ModelTurn,
} from "@threadlight/agent-loop";

import type { ConfiguredModelProvider } from "./provider-factory.js";

export interface ModelProviderRouterOptions {
  /** Backends keyed by provider id. */
  providers: Readonly<Record<string, ConfiguredModelProvider>>;
  /** Backend used when a request carries no routing hint. */
  defaultProvider: string;
}

function stateProvider(state: unknown): string | undefined {
  if (!state || typeof state !== "object" || Array.isArray(state)) return;
  const provider = (state as Record<string, unknown>).provider;
  return typeof provider === "string" ? provider : undefined;
}

/**
 * Composes one provider per vendor and dispatches each request to the backend
 * named by the request's routing hint. The default backend handles requests
 * without a hint, keeping existing single-provider call sites unchanged.
 */
export function createRoutingModelProvider(
  options: ModelProviderRouterOptions,
): ConfiguredModelProvider {
  const { providers, defaultProvider } = options;

  function resolve(hint?: string): ConfiguredModelProvider | undefined {
    const key = hint ?? defaultProvider;
    return providers[key] ?? providers[defaultProvider];
  }

  return {
    async generate(
      request: ModelRequest,
      generateOptions: ModelGenerateOptions = {},
    ): Promise<ModelTurn> {
      const provider = resolve(request.provider);
      if (!provider) {
        throw new Error(
          `No model provider is configured for ${request.provider ?? "the default provider"}`,
        );
      }
      return provider.generate(request, generateOptions);
    },

    async validateAttachment(attachment: ModelAttachment): Promise<void> {
      const provider = resolve(attachment.provider);
      await provider?.validateAttachment?.(attachment);
    },

    async uploadAttachment(
      attachment: ModelAttachment,
      signal?: AbortSignal,
    ): Promise<ModelAttachment> {
      const provider = resolve(attachment.provider);
      if (!provider?.uploadAttachment) {
        throw new Error(
          "The selected model provider does not support attachments",
        );
      }
      return provider.uploadAttachment(attachment, signal);
    },

    prepareStateForPersistence(
      state: unknown,
      options: { maxBytes: number },
    ): unknown {
      const provider = resolve(stateProvider(state));
      if (provider?.prepareStateForPersistence) {
        return provider.prepareStateForPersistence(state, options);
      }
      return state;
    },
  };
}
