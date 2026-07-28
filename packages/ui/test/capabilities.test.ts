import { describe, expect, it } from "vitest";

import {
  capabilityQueryAt,
  filterCapabilities,
  nextCapabilityIndex,
  removeCapabilityQuery,
} from "../src/capabilities.js";

const capabilities = [
  {
    id: "skill:documents",
    kind: "skill" as const,
    name: "documents",
    description: "Create and edit document artifacts",
    source: "builtin",
  },
  {
    id: "mcp:gmail",
    kind: "mcp" as const,
    name: "Gmail",
    description: "Search and read email",
    source: "fixed",
  },
];

describe("composer capabilities", () => {
  it("recognizes an @ query only at a token boundary", () => {
    expect(capabilityQueryAt("@doc", 4)).toEqual({
      start: 0,
      end: 4,
      query: "doc",
    });
    expect(capabilityQueryAt("请用 @Gmail", 9)).toEqual({
      start: 3,
      end: 9,
      query: "Gmail",
    });
    expect(capabilityQueryAt("请用@Gmail", 8)).toEqual({
      start: 2,
      end: 8,
      query: "Gmail",
    });
    expect(capabilityQueryAt("person@example.com", 18)).toBeUndefined();
  });

  it("searches names and descriptions while excluding selected items", () => {
    expect(
      filterCapabilities(capabilities, "email", new Set()),
    ).toEqual([capabilities[1]]);
    expect(
      filterCapabilities(
        capabilities,
        "",
        new Set(["skill:documents"]),
      ),
    ).toEqual([capabilities[1]]);
  });

  it("wraps keyboard selection and removes the trigger token", () => {
    expect(nextCapabilityIndex(0, 2, -1)).toBe(1);
    expect(nextCapabilityIndex(1, 2, 1)).toBe(0);
    expect(
      removeCapabilityQuery("请用 @doc 创建文档", {
        start: 3,
        end: 7,
        query: "doc",
      }),
    ).toEqual({
      value: "请用 创建文档",
      cursor: 3,
    });
  });
});
