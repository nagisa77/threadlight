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

export type Translate = (
  key: TranslationKey,
  values?: Record<string, string | number>,
) => string;

interface I18nValue {
  language: Language;
  t: Translate;
}

const I18nContext = createContext<I18nValue>({
  language: "zh-CN",
  t: (key, values) => interpolate(zh[key], values),
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
      t: (key, values) => interpolate(messages[language][key], values),
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

function interpolate(
  template: string,
  values: Record<string, string | number> | undefined,
): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
