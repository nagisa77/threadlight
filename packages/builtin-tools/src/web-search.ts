import { defineTool, type Tool } from "@threadlight/agent-loop";

const DEFAULT_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_COUNT = 5;
const DEFAULT_TIMEOUT_MS = 10_000;
const BRAVE_SEARCH_LANGUAGES = [
  "ar",
  "eu",
  "bn",
  "bg",
  "ca",
  "zh-hans",
  "zh-hant",
  "hr",
  "cs",
  "da",
  "nl",
  "en",
  "en-gb",
  "et",
  "fi",
  "fr",
  "gl",
  "de",
  "gu",
  "he",
  "hi",
  "hu",
  "is",
  "it",
  "jp",
  "kn",
  "ko",
  "lv",
  "lt",
  "ms",
  "ml",
  "mr",
  "nb",
  "pl",
  "pt-br",
  "pt-pt",
  "pa",
  "ro",
  "ru",
  "sr",
  "sk",
  "sl",
  "es",
  "sv",
  "ta",
  "te",
  "th",
  "tr",
  "uk",
  "vi",
] as const;

type BraveSearchLanguage = (typeof BRAVE_SEARCH_LANGUAGES)[number];

const BRAVE_SEARCH_LANGUAGE_SET = new Set<string>(BRAVE_SEARCH_LANGUAGES);
const SEARCH_LANGUAGE_ALIASES: Readonly<Record<string, BraveSearchLanguage>> = {
  ja: "jp",
  zh: "zh-hans",
  "zh-cn": "zh-hans",
  "zh-sg": "zh-hans",
  "zh-hk": "zh-hant",
  "zh-mo": "zh-hant",
  "zh-tw": "zh-hant",
};

type Fetch = typeof fetch;

export interface WebSearchToolOptions {
  apiKey: string;
  fetch?: Fetch;
  endpoint?: string;
  defaultCount?: number;
  timeoutMs?: number;
}

export interface WebSearchResult {
  query: string;
  results: Array<{
    title: string;
    url: string;
    description: string;
    age?: string;
    language?: string;
  }>;
}

interface WebSearchArguments {
  query: string;
  count: number;
  country?: string;
  search_lang?: BraveSearchLanguage;
  freshness?: "pd" | "pw" | "pm" | "py";
}

export function createWebSearchTool(options: WebSearchToolOptions): Tool {
  if (options.apiKey.trim().length === 0) {
    throw new Error("apiKey must be a non-empty string");
  }

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
  const fetchImplementation = options.fetch ?? globalThis.fetch;

  return defineTool({
    name: "web_search",
    mutability: "read",
    description:
      "Search the public internet and return page titles, URLs, and short descriptions.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: 400,
          description: "Search query, including operators such as site: or filetype:.",
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
          description: "Optional two-letter country code.",
        },
        search_lang: {
          type: ["string", "null"],
          enum: [...BRAVE_SEARCH_LANGUAGES, null],
          description:
            "Optional Brave search-result language code. Use zh-hans for Simplified Chinese or zh-hant for Traditional Chinese.",
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
      const url = new URL(options.endpoint ?? DEFAULT_ENDPOINT);
      url.searchParams.set("q", parsed.query);
      url.searchParams.set("count", String(parsed.count));
      if (parsed.country) url.searchParams.set("country", parsed.country);
      if (parsed.search_lang) {
        url.searchParams.set("search_lang", parsed.search_lang);
      }
      if (parsed.freshness) url.searchParams.set("freshness", parsed.freshness);

      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const response = await fetchImplementation(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": options.apiKey,
        },
        signal: AbortSignal.any([context.signal, timeoutSignal]),
      });

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        throw new Error(
          `Brave Search API returned ${response.status}${detail ? `: ${detail}` : ""}`,
        );
      }

      return parseResponse(parsed.query, await response.json());
    },
  });
}

function parseArguments(value: unknown, defaultCount: number): WebSearchArguments {
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

  const searchLang = parseSearchLanguage(value.search_lang);
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
    search_lang: searchLang,
    freshness: freshness ?? undefined,
  };
}

function parseSearchLanguage(value: unknown): BraveSearchLanguage | undefined {
  const searchLang = optionalString(value, "search_lang");
  if (searchLang === undefined) return undefined;

  const normalized = searchLang.trim().toLowerCase().replaceAll("_", "-");
  const canonical = SEARCH_LANGUAGE_ALIASES[normalized] ?? normalized;
  if (!BRAVE_SEARCH_LANGUAGE_SET.has(canonical)) {
    throw new Error(
      "search_lang must be a language supported by Brave Search (for Chinese, use zh-hans or zh-hant)",
    );
  }

  return canonical as BraveSearchLanguage;
}

function parseResponse(query: string, value: unknown): WebSearchResult {
  if (!isObject(value)) throw new Error("Brave Search API returned invalid JSON");

  const web = value.web;
  const rawResults = isObject(web) && Array.isArray(web.results) ? web.results : [];
  const results = rawResults.flatMap((item) => {
    if (!isObject(item)) return [];
    if (typeof item.title !== "string" || typeof item.url !== "string") {
      return [];
    }

    return [
      {
        title: item.title,
        url: item.url,
        description:
          typeof item.description === "string" ? item.description : "",
        ...(typeof item.age === "string" ? { age: item.age } : {}),
        ...(typeof item.language === "string"
          ? { language: item.language }
          : {}),
      },
    ];
  });

  return { query, results };
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
