export interface ComputerCaptureSource {
  key: string;
  sourceId: string;
}

export interface ComputerCaptureStreamMetadata {
  width: number;
  height: number;
}

export interface ComputerCaptureStreamStatus {
  key: string;
  active: boolean;
}

export interface ComputerCaptureAdapter<
  Source extends ComputerCaptureSource,
> {
  start(source: Source): Promise<ComputerCaptureStreamMetadata>;
  stopAll(): Promise<void>;
  status(): Promise<readonly ComputerCaptureStreamStatus[]>;
}

export type ActiveComputerCaptureSource<
  Source extends ComputerCaptureSource,
> = Source & ComputerCaptureStreamMetadata;

export class ComputerCaptureSession<
  Source extends ComputerCaptureSource,
> {
  private current: ActiveComputerCaptureSource<Source>[] = [];

  constructor(private readonly adapter: ComputerCaptureAdapter<Source>) {}

  get activeSources(): readonly ActiveComputerCaptureSource<Source>[] {
    return this.current;
  }

  async replace(
    sources: readonly Source[],
  ): Promise<readonly ActiveComputerCaptureSource<Source>[]> {
    await this.adapter.stopAll();
    const started: ActiveComputerCaptureSource<Source>[] = [];
    try {
      for (const source of sources) {
        const metadata = await this.adapter.start(source);
        started.push({ ...source, ...metadata });
      }
    } catch (error) {
      await this.adapter.stopAll();
      this.current = [];
      throw error;
    }
    this.current = started;
    return this.current;
  }

  async inactiveKeys(): Promise<readonly string[]> {
    if (!this.current.length) return [];
    const statuses = await this.adapter.status();
    const active = new Set(
      statuses.filter((status) => status.active).map((status) => status.key),
    );
    return this.current
      .filter((source) => !active.has(source.key))
      .map((source) => source.key);
  }

  async stop(): Promise<void> {
    await this.adapter.stopAll();
    this.current = [];
  }
}
