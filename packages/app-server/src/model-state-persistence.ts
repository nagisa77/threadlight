export const DEFAULT_MAX_PERSISTED_MODEL_STATE_BYTES = 5 * 1024 * 1024;

export interface ModelStatePersistenceOptions {
  maxBytes?: number;
  prepareState?(
    state: unknown,
    options: { maxBytes: number },
  ): unknown;
}

export class ModelStatePersistence {
  private readonly maxBytes: number;
  private readonly prepareState?: ModelStatePersistenceOptions["prepareState"];

  constructor(options: ModelStatePersistenceOptions = {}) {
    const maxBytes =
      options.maxBytes ?? DEFAULT_MAX_PERSISTED_MODEL_STATE_BYTES;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      throw new Error("maxBytes must be a positive integer");
    }
    this.maxBytes = maxBytes;
    this.prepareState = options.prepareState;
  }

  prepare(state: unknown): unknown {
    if (state === undefined) return;
    const prepared =
      this.prepareState?.(state, { maxBytes: this.maxBytes }) ?? state;
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(prepared);
    } catch (error) {
      throw new Error(
        `Model state is not JSON-serializable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (serialized === undefined) {
      throw new Error("Model state is not JSON-serializable");
    }
    const bytes = Buffer.byteLength(serialized);
    if (bytes > this.maxBytes) {
      throw new Error(
        `Model state is ${bytes} bytes and exceeds the ${this.maxBytes}-byte persistence limit`,
      );
    }
    return prepared;
  }
}
