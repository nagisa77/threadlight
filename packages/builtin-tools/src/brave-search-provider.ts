import type {
  WebSearchItem,
  WebSearchProvider,
  WebSearchRequest,
} from "./web-search.js";

const DEFAULT_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
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
type Fetch = typeof fetch;

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

export interface BraveSearchProviderOptions {
  apiKey: string;
  fetch?: Fetch;
  endpoint?: string;
}

export function createBraveSearchProvider(
  options: BraveSearchProviderOptions,
): WebSearchProvider {
  const apiKey = requireApiKey(options.apiKey);
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;

  return {
    id: "brave",
    async search(request, context) {
      const url = new URL(endpoint);
      url.searchParams.set("q", request.query);
      url.searchParams.set("count", String(request.count));
      if (request.country) url.searchParams.set("country", request.country);
      if (request.searchLanguage) {
        url.searchParams.set(
          "search_lang",
          parseSearchLanguage(request.searchLanguage),
        );
      }
      if (request.freshness) {
        url.searchParams.set("freshness", request.freshness);
      }

      const response = await fetchImplementation(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": apiKey,
        },
        signal: context.signal,
      });

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        throw new Error(
          `Brave Search API returned ${response.status}${detail ? `: ${detail}` : ""}`,
        );
      }

      return parseResponse(await response.json());
    },
  };
}

function parseSearchLanguage(value: string): BraveSearchLanguage {
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");
  const canonical = SEARCH_LANGUAGE_ALIASES[normalized] ?? normalized;
  if (!BRAVE_SEARCH_LANGUAGE_SET.has(canonical)) {
    throw new Error(
      "search_lang must be a language supported by Brave Search (for Chinese, use zh-Hans or zh-Hant)",
    );
  }
  return canonical as BraveSearchLanguage;
}

function parseResponse(value: unknown): WebSearchItem[] {
  if (!isObject(value))
    throw new Error("Brave Search API returned invalid JSON");

  const web = value.web;
  const rawResults =
    isObject(web) && Array.isArray(web.results) ? web.results : [];
  return rawResults.flatMap((item) => {
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
}

function requireApiKey(value: string): string {
  const apiKey = value.trim();
  if (!apiKey) throw new Error("apiKey must be a non-empty string");
  return apiKey;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
