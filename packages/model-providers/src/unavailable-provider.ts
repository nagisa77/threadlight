import type {
  ModelAttachment,
  ModelGenerateOptions,
  ModelRequest,
  ModelTurn,
} from "@threadlight/agent-loop";

import type { ConfiguredModelProvider } from "./provider-factory.js";

export class UnavailableModelProvider implements ConfiguredModelProvider {
  constructor(private readonly message: string) {}

  generate(
    _request: ModelRequest,
    _options?: ModelGenerateOptions,
  ): Promise<ModelTurn> {
    return Promise.reject(new Error(this.message));
  }

  validateAttachment(): never {
    throw new Error(this.message);
  }

  uploadAttachment(_attachment: ModelAttachment): Promise<ModelAttachment> {
    return Promise.reject(new Error(this.message));
  }

  prepareStateForPersistence(): undefined {
    return undefined;
  }
}
