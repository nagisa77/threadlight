import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import {
  isHostLanguage,
  SUPPORTED_LANGUAGES,
  type HostLanguage,
} from "@threadlight/protocol";

import { en } from "./features/i18n/messages/en.js";
import { ja } from "./features/i18n/messages/ja.js";
import { ko } from "./features/i18n/messages/ko.js";
import { zh } from "./features/i18n/messages/zh-CN.js";
import { zhTW } from "./features/i18n/messages/zh-TW.js";
import type {
  Messages,
  TranslationKey,
} from "./features/i18n/messages/types.js";

export { SUPPORTED_LANGUAGES };
export type Language = HostLanguage;

export const LANGUAGE_OPTIONS: readonly {
  value: Language;
  label: string;
}[] = [
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
];

const messages: Record<Language, Messages> = {
  "zh-CN": zh,
  "zh-TW": zhTW,
  en,
  ja,
  ko,
};

export type Translate = (key: TranslationKey, values?: MessageValues) => string;

export type MessageValues = Record<string, string | number>;
export type MessageCatalog<Schema extends object> = Readonly<
  Record<Language, Readonly<Schema>>
>;

interface I18nValue {
  language: Language;
  t: Translate;
}

const I18nContext = createContext<I18nValue>({
  language: "zh-CN",
  t: (key, values) => formatMessage(zh[key], values),
});

export function I18nProvider({
  language,
  children,
}: {
  language: Language;
  children: ReactNode;
}) {
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<I18nValue>(
    () => ({
      language,
      t: (key, values) => formatMessage(messages[language][key], values),
    }),
    [language],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}

export function isLanguage(value: unknown): value is Language {
  return isHostLanguage(value);
}

/** Validates that every scoped catalog provides the same shape for every locale. */
export function defineMessageCatalog<Schema extends object>(
  catalog: MessageCatalog<Schema>,
): MessageCatalog<Schema> {
  validateCatalog(catalog);
  return catalog;
}

export function messagesFor<Schema extends object>(
  catalog: MessageCatalog<Schema>,
  language: Language,
): Readonly<Schema> {
  return catalog[language];
}

export function useMessageCatalog<Schema extends object>(
  catalog: MessageCatalog<Schema>,
): Readonly<Schema> {
  return messagesFor(catalog, useI18n().language);
}

export function formatMessage(
  template: string,
  values?: MessageValues,
): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

function validateCatalog<Schema extends object>(
  catalog: MessageCatalog<Schema>,
): void {
  const canonicalLanguage = SUPPORTED_LANGUAGES[0];
  const canonical = catalog[canonicalLanguage];
  for (const language of SUPPORTED_LANGUAGES.slice(1)) {
    validateCatalogValue(canonical, catalog[language], language, "");
  }
}

function validateCatalogValue(
  canonical: unknown,
  candidate: unknown,
  language: Language,
  path: string,
): void {
  if (typeof canonical === "string") {
    if (typeof candidate !== "string") {
      throw new Error(`Invalid message at ${language}.${path}`);
    }
    const expected = placeholders(canonical);
    const actual = placeholders(candidate);
    if (expected.join("\0") !== actual.join("\0")) {
      throw new Error(`Placeholder mismatch at ${language}.${path}`);
    }
    return;
  }
  if (Array.isArray(canonical)) {
    if (!Array.isArray(candidate) || candidate.length !== canonical.length) {
      throw new Error(`Catalog shape mismatch at ${language}.${path}`);
    }
    canonical.forEach((value, index) => {
      validateCatalogValue(
        value,
        candidate[index],
        language,
        `${path}[${index}]`,
      );
    });
    return;
  }
  if (canonical && typeof canonical === "object") {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      throw new Error(`Catalog shape mismatch at ${language}.${path}`);
    }
    const expectedKeys = Object.keys(canonical as object).sort();
    const actualKeys = Object.keys(candidate as object).sort();
    if (expectedKeys.join("\0") !== actualKeys.join("\0")) {
      throw new Error(`Catalog keys mismatch at ${language}.${path}`);
    }
    for (const key of expectedKeys) {
      validateCatalogValue(
        (canonical as Record<string, unknown>)[key],
        (candidate as Record<string, unknown>)[key],
        language,
        path ? `${path}.${key}` : key,
      );
    }
  }
}

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
}
