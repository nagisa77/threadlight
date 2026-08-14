import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";

import { en } from "./features/i18n/messages/en.js";
import { ja } from "./features/i18n/messages/ja.js";
import { ko } from "./features/i18n/messages/ko.js";
import { zh } from "./features/i18n/messages/zh-CN.js";
import { zhTW } from "./features/i18n/messages/zh-TW.js";
import type {
  Messages,
  TranslationKey,
} from "./features/i18n/messages/types.js";

export const SUPPORTED_LANGUAGES = [
  "zh-CN",
  "zh-TW",
  "en",
  "ja",
  "ko",
] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

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
  return (
    typeof value === "string" &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  );
}

/** Validates that every scoped catalog provides the same shape for every locale. */
export function defineMessageCatalog<Schema extends object>(
  catalog: MessageCatalog<Schema>,
): MessageCatalog<Schema> {
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
