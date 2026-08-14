import type { zh } from "./zh-CN.js";

export type TranslationKey = keyof typeof zh;
export type Messages = { readonly [Key in TranslationKey]: string };
