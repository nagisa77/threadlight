export interface ExternalWindowRequest {
  url: string;
}

export interface DeniedWindowResponse {
  action: "deny";
}

export type OpenExternal = (url: string) => Promise<void>;

export function createExternalWindowHandler(openExternal: OpenExternal) {
  return ({ url }: ExternalWindowRequest): DeniedWindowResponse => {
    if (isWebUrl(url)) {
      void openExternal(url).catch(() => undefined);
    }
    return { action: "deny" };
  };
}

export function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
