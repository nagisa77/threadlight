import type {
  MessageCitationData,
  MessageSourceData,
} from "@threadlight/protocol";

import { defineMessageCatalog, messagesFor, type Language } from "./i18n.js";

const INLINE_CITATION_PATTERN = String.raw`\[([0-9]+(?:,[0-9]+)*)\]\(threadlight-source:(citation-\d+)\)`;
const INLINE_CITATION = new RegExp(INLINE_CITATION_PATTERN, "g");
const INLINE_CITATION_GROUP = new RegExp(
  `${INLINE_CITATION_PATTERN}(?:[\t ]*${INLINE_CITATION_PATTERN})*`,
  "g",
);

export function sourcePresentationKind(
  citationId: string | undefined,
  viewportWidth: number,
): "preview" | "collection" {
  return citationId && viewportWidth > 720 ? "preview" : "collection";
}

export function sourcesForCitation(
  citation: MessageCitationData,
  sources: readonly MessageSourceData[],
): MessageSourceData[] {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  return citation.sourceIds.flatMap((id) => {
    const source = sourceById.get(id);
    return source ? [source] : [];
  });
}

export function coalesceAdjacentCitationLinks(
  text: string,
  citations: readonly MessageCitationData[],
): { text: string; citations: readonly MessageCitationData[] } {
  const citationById = new Map(
    citations.map((citation) => [citation.id, citation]),
  );
  const replacements = new Map<string, MessageCitationData>();
  const removedIds = new Set<string>();
  let changed = false;
  const normalizedText = text.replace(INLINE_CITATION_GROUP, (group) => {
    const links = [...group.matchAll(INLINE_CITATION)];
    if (links.length < 2) return group;
    const groupedCitations = links.flatMap((link) => {
      const citation = citationById.get(link[2] ?? "");
      return citation ? [citation] : [];
    });
    if (groupedCitations.length !== links.length) return group;

    const primaryCitation = groupedCitations[0];
    if (!primaryCitation) return group;
    replacements.set(primaryCitation.id, {
      ...primaryCitation,
      sourceIds: [
        ...new Set(groupedCitations.flatMap((citation) => citation.sourceIds)),
      ],
    });
    groupedCitations
      .slice(1)
      .forEach((citation) => removedIds.add(citation.id));
    changed = true;
    const labels = [
      ...new Set(links.flatMap((link) => (link[1] ?? "").split(","))),
    ];
    return `[${labels.join(",")}](threadlight-source:${primaryCitation.id})`;
  });

  if (!changed) return { text, citations };
  return {
    text: normalizedText,
    citations: citations.flatMap((citation) => {
      if (removedIds.has(citation.id)) return [];
      return [replacements.get(citation.id) ?? citation];
    }),
  };
}

export function sourceDisplayName(source: MessageSourceData): string {
  const domain = source.domain.toLowerCase().replace(/^www\./, "");
  if (domain === "github.com" || domain.endsWith(".github.com"))
    return "GitHub";
  if (domain === "deepseek.com" || domain.endsWith(".deepseek.com")) {
    return "DeepSeek";
  }
  const stem = domain.split(".")[0];
  return stem && !domain.includes("localhost")
    ? `${stem[0]?.toUpperCase() ?? ""}${stem.slice(1)}`
    : source.domain;
}

export function sourceFaviconUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? new URL("/favicon.ico", parsed.origin).href
      : undefined;
  } catch {
    return undefined;
  }
}

const SOURCE_MESSAGES = defineMessageCatalog({
  "zh-CN": {
    sources: "来源",
    sourceCount: "{count} 个来源",
    drawerSubtitle: "共 {count} 个网页来源",
    openCitation: "查看引用 {number}",
    openPage: "打开原网页",
    locate: "定位到对应原句",
    supports: "支持 {count} 处内容",
    close: "关闭来源",
    previousSource: "上一个来源",
    nextSource: "下一个来源",
  },
  "zh-TW": {
    sources: "來源",
    sourceCount: "{count} 個來源",
    drawerSubtitle: "共 {count} 個網頁來源",
    openCitation: "查看引用 {number}",
    openPage: "開啟原網頁",
    locate: "定位到對應原句",
    supports: "支援 {count} 處內容",
    close: "關閉來源",
    previousSource: "上一個來源",
    nextSource: "下一個來源",
  },
  en: {
    sources: "Sources",
    sourceCount: "{count} sources",
    drawerSubtitle: "{count} web sources",
    openCitation: "View citation {number}",
    openPage: "Open original page",
    locate: "Locate cited sentence",
    supports: "Supports {count} passages",
    close: "Close sources",
    previousSource: "Previous source",
    nextSource: "Next source",
  },
  ja: {
    sources: "出典",
    sourceCount: "{count} 件の出典",
    drawerSubtitle: "ウェブ出典 {count} 件",
    openCitation: "引用 {number} を表示",
    openPage: "元のページを開く",
    locate: "引用文へ移動",
    supports: "{count} 箇所を裏付け",
    close: "出典を閉じる",
    previousSource: "前の出典",
    nextSource: "次の出典",
  },
  ko: {
    sources: "출처",
    sourceCount: "출처 {count}개",
    drawerSubtitle: "웹 출처 {count}개",
    openCitation: "인용 {number} 보기",
    openPage: "원본 페이지 열기",
    locate: "인용 문장으로 이동",
    supports: "{count}개 문단 지원",
    close: "출처 닫기",
    previousSource: "이전 출처",
    nextSource: "다음 출처",
  },
});

export function sourceCopy(language: Language) {
  return messagesFor(SOURCE_MESSAGES, language);
}
