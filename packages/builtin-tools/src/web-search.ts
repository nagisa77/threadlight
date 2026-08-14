import { defineTool, type Tool } from "@threadlight/agent-loop";

const DEFAULT_COUNT = 5;
const DEFAULT_TIMEOUT_MS = 15_000;

export type WebSearchFreshness = "pd" | "pw" | "pm" | "py";

export interface WebSearchRequest {
  query: string;
  count: number;
  country?: string;
  searchLanguage?: string;
  freshness?: WebSearchFreshness;
}

export interface WebSearchItem {
  title: string;
  url: string;
  description: string;
  age?: string;
  language?: string;
}

export interface WebSearchProvider {
  readonly id: string;
  search(
    request: WebSearchRequest,
    context: { signal: AbortSignal },
  ): Promise<readonly WebSearchItem[]>;
}

export interface WebSearchToolOptions {
  provider: WebSearchProvider;
  defaultCount?: number;
  timeoutMs?: number;
}

export interface WebSearchResult {
  query: string;
  results: WebSearchItem[];
}

interface WebSearchArguments {
  query: string;
  count: number;
  country?: string;
  searchLanguage?: string;
  freshness?: WebSearchFreshness;
}

export function createWebSearchTool(options: WebSearchToolOptions): Tool {
  const defaultCount = integerInRange(
    options.defaultCount ?? DEFAULT_COUNT,
    1,
    20,
    "defaultCount",
  );
  const timeoutMs = positiveInteger(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    "timeoutMs",
  );

  return defineTool({
    name: "web_search",
    mutability: "read",
    description:
      "Search the public internet and return page titles, URLs, and short descriptions. Prioritize first-party official sources, search English and global sources by default, and add Chinese or other local-language sources only when local context is relevant.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: 400,
          description:
            "Natural-language web search query. Use English for global discovery and official product, documentation, repository, or paper searches unless the target is inherently local-language.",
        },
        count: {
          type: ["integer", "null"],
          minimum: 1,
          maximum: 20,
          description: "Number of results to return.",
        },
        country: {
          type: ["string", "null"],
          minLength: 2,
          maxLength: 2,
          description:
            "Optional two-letter country preference. Use null for global discovery and set a country only when local coverage is relevant.",
        },
        search_lang: {
          type: ["string", "null"],
          minLength: 2,
          maxLength: 35,
          description:
            "Optional BCP-47 search-result language preference, such as en, ja, zh-Hans, or zh-Hant. Prefer en for global research; use Chinese or another local language as a supplement when local context is relevant.",
        },
        freshness: {
          type: ["string", "null"],
          enum: ["pd", "pw", "pm", "py", null],
          description:
            "Optional recency filter: past day, week, month, or year.",
        },
      },
      required: ["query", "count", "country", "search_lang", "freshness"],
      additionalProperties: false,
    },
    async execute(arguments_, context) {
      const parsed = parseArguments(arguments_, defaultCount);
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const results = await options.provider.search(
        {
          query: parsed.query,
          count: parsed.count,
          ...(parsed.country ? { country: parsed.country } : {}),
          ...(parsed.searchLanguage
            ? { searchLanguage: parsed.searchLanguage }
            : {}),
          ...(parsed.freshness ? { freshness: parsed.freshness } : {}),
        },
        { signal: AbortSignal.any([context.signal, timeoutSignal]) },
      );

      return {
        query: parsed.query,
        results: results.slice(0, parsed.count),
      } satisfies WebSearchResult;
    },
  });
}

function parseArguments(
  value: unknown,
  defaultCount: number,
): WebSearchArguments {
  if (!isObject(value)) throw new Error("arguments must be an object");

  const query = value.query;
  if (typeof query !== "string" || query.trim().length === 0) {
    throw new Error("query must be a non-empty string");
  }
  if (query.length > 400) throw new Error("query cannot exceed 400 characters");

  const count = integerInRange(value.count ?? defaultCount, 1, 20, "count");
  const country = optionalString(value.country, "country");
  if (country !== undefined && !/^[A-Za-z]{2}$/.test(country)) {
    throw new Error("country must be a two-letter code");
  }

  const searchLanguage = optionalString(value.search_lang, "search_lang");
  if (
    searchLanguage !== undefined &&
    !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(
      searchLanguage.replaceAll("_", "-"),
    )
  ) {
    throw new Error("search_lang must be a valid BCP-47 language code");
  }

  const freshness = value.freshness;
  if (
    freshness !== undefined &&
    freshness !== null &&
    freshness !== "pd" &&
    freshness !== "pw" &&
    freshness !== "pm" &&
    freshness !== "py"
  ) {
    throw new Error("freshness must be one of pd, pw, pm, or py");
  }

  return {
    query: query.trim(),
    count,
    country: country?.toUpperCase(),
    searchLanguage: searchLanguage?.replaceAll("_", "-"),
    freshness: freshness ?? undefined,
  };
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function integerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
  const number = Number(value);
  if (number < minimum || number > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return number;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
