import type { CapabilityDescriptor } from "@threadlight/protocol";
import { AtSign, Plug, Sparkles, X } from "lucide-react";

import { useI18n } from "./i18n.js";

export interface CapabilityQuery {
  start: number;
  end: number;
  query: string;
}

export function capabilityQueryAt(
  value: string,
  cursor: number | null,
): CapabilityQuery | undefined {
  if (cursor === null || cursor < 0 || cursor > value.length) return;
  const beforeCursor = value.slice(0, cursor);
  const start = beforeCursor.lastIndexOf("@");
  if (start < 0) return;
  const previous = value[start - 1];
  if (previous && /[a-z0-9._%+-]/iu.test(previous)) return;
  const query = beforeCursor.slice(start + 1);
  if (/[\s@]/u.test(query)) return;
  return {
    start,
    end: cursor,
    query,
  };
}

export function filterCapabilities(
  capabilities: readonly CapabilityDescriptor[],
  query: string,
  selectedIds: ReadonlySet<string>,
): CapabilityDescriptor[] {
  const normalized = query.trim().toLocaleLowerCase();
  return capabilities.filter((capability) => {
    if (selectedIds.has(capability.id)) return false;
    if (!normalized) return true;
    return [capability.name, capability.description, capability.source]
      .filter(Boolean)
      .some((value) =>
        value!.toLocaleLowerCase().includes(normalized),
      );
  });
}

export function nextCapabilityIndex(
  current: number,
  total: number,
  delta: -1 | 1,
): number {
  if (total <= 0) return 0;
  return (current + delta + total) % total;
}

export function removeCapabilityQuery(
  value: string,
  query: CapabilityQuery,
): { value: string; cursor: number } {
  const before = value.slice(0, query.start);
  let after = value.slice(query.end);
  if (/\s$/u.test(before) && /^\s/u.test(after)) {
    after = after.slice(1);
  }
  return {
    value: before + after,
    cursor: before.length,
  };
}

export function CapabilityChips({
  capabilities,
  disabled,
  onRemove,
}: {
  capabilities: readonly CapabilityDescriptor[];
  disabled: boolean;
  onRemove(capability: CapabilityDescriptor): void;
}) {
  const { t } = useI18n();
  if (capabilities.length === 0) return null;
  return (
    <div
      className="capability-chips"
      aria-label={t("selectedCapabilities")}
    >
      {capabilities.map((capability) => (
        <span className="capability-chip" key={capability.id}>
          <CapabilityIcon kind={capability.kind} />
          <span>{capability.name}</span>
          <button
            type="button"
            className="capability-chip-remove pressable"
            disabled={disabled}
            aria-label={t("removeCapability", {
              name: capability.name,
            })}
            onClick={() => onRemove(capability)}
          >
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  );
}

export function CapabilityMenu({
  capabilities,
  activeIndex,
  loading,
  onSelect,
}: {
  capabilities: readonly CapabilityDescriptor[];
  activeIndex: number;
  loading: boolean;
  onSelect(capability: CapabilityDescriptor): void;
}) {
  const { t } = useI18n();
  return (
    <div
      id="composer-capability-menu"
      className="capability-menu"
      role="listbox"
      aria-label={t("capabilities")}
    >
      <div className="capability-menu-heading">
        <AtSign size={14} />
        <span>{t("capabilities")}</span>
      </div>
      {loading ? (
        <p className="capability-menu-empty">
          {t("loadingCapabilities")}
        </p>
      ) : capabilities.length === 0 ? (
        <p className="capability-menu-empty">
          {t("noMatchingCapabilities")}
        </p>
      ) : (
        capabilities.map((capability, index) => (
          <button
            type="button"
            id={`composer-capability-${index}`}
            className="capability-option"
            role="option"
            aria-selected={index === activeIndex}
            key={capability.id}
            onPointerDown={(event) => {
              event.preventDefault();
              onSelect(capability);
            }}
          >
            <span className="capability-option-icon" aria-hidden="true">
              <CapabilityIcon kind={capability.kind} />
            </span>
            <span className="capability-option-copy">
              <strong>{capability.name}</strong>
              <small>{capability.description}</small>
            </span>
            <span className="capability-option-kind">
              {capability.kind === "skill"
                ? t("capabilityKindSkill")
                : t("capabilityKindMcp")}
            </span>
          </button>
        ))
      )}
    </div>
  );
}

function CapabilityIcon({
  kind,
}: {
  kind: CapabilityDescriptor["kind"];
}) {
  return kind === "skill" ? (
    <Sparkles size={14} />
  ) : (
    <Plug size={14} />
  );
}
