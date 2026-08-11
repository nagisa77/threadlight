import type {
  WebSearchFreshness,
  WebSearchItem,
  WebSearchProvider,
  WebSearchRequest,
} from "./web-search.js";

const DEFAULT_ENDPOINT = "https://api.linkup.so/v1/search";
type Fetch = typeof fetch;

export interface LinkupSearchProviderOptions {
  apiKey: string;
  fetch?: Fetch;
  endpoint?: string;
  now?: () => Date;
}

export function createLinkupSearchProvider(
  options: LinkupSearchProviderOptions,
): WebSearchProvider {
  const apiKey = requireApiKey(options.apiKey);
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const now = options.now ?? (() => new Date());

  return {
    id: "linkup",
    async search(request, context) {
      const response = await fetchImplementation(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(linkupRequest(request, now())),
        signal: context.signal,
      });

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        throw new Error(
          `Linkup Search API returned ${response.status}${detail ? `: ${detail}` : ""}`,
        );
      }

      return parseResponse(await response.json());
    },
  };
}

function linkupRequest(request: WebSearchRequest, now: Date) {
  return {
    q: contextualizeQuery(request),
    depth: "standard",
    outputType: "searchResults",
    maxResults: request.count,
    ...(request.freshness
      ? { fromDate: freshnessStart(request.freshness, now) }
      : {}),
  };
}

function contextualizeQuery(request: WebSearchRequest): string {
  const preferences: string[] = [];
  if (request.country) {
    preferences.push(
      `Prioritize sources relevant to country code ${request.country}.`,
    );
  }
  if (request.searchLanguage) {
    preferences.push(
      `Prefer sources written in ${request.searchLanguage} when possible.`,
    );
  }
  return preferences.length > 0
    ? `${request.query}\n\nSearch preferences: ${preferences.join(" ")}`
    : request.query;
}

function freshnessStart(freshness: WebSearchFreshness, now: Date): string {
  const start = new Date(now);
  const days = { pd: 1, pw: 7, pm: 30, py: 365 }[freshness];
  start.setUTCDate(start.getUTCDate() - days);
  return start.toISOString().slice(0, 10);
}

function parseResponse(value: unknown): WebSearchItem[] {
  if (!isObject(value) || !Array.isArray(value.results)) {
    throw new Error("Linkup Search API returned invalid JSON");
  }
  return value.results.flatMap((item) => {
    if (!isObject(item)) return [];
    if (typeof item.name !== "string" || typeof item.url !== "string") {
      return [];
    }
    return [
      {
        title: item.name,
        url: item.url,
        description: typeof item.content === "string" ? item.content : "",
      },
    ];
  });
}

function requireApiKey(value: string): string {
  const apiKey = value.trim();
  if (!apiKey) throw new Error("apiKey must be a non-empty string");
  return apiKey;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
