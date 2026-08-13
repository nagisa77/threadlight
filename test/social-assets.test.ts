import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

const assetSets = [
  ["01-visible-work", 6],
  ["02-five-signals", 7],
  ["03-incident-replay", 6],
] as const;

describe("Xiaohongshu campaign", () => {
  it("ships every carousel page at the native 3:4 publishing size", async () => {
    for (const [directory, count] of assetSets) {
      for (let index = 1; index <= count; index += 1) {
        const filename = String(index).padStart(2, "0") + ".png";
        const asset = new URL(
          `../docs/images/social/${directory}/${filename}`,
          import.meta.url,
        );
        const metadata = await sharp(fileURLToPath(asset)).metadata();

        expect(metadata.format).toBe("png");
        expect(metadata.width).toBe(1_242);
        expect(metadata.height).toBe(1_660);
      }
    }
  });

  it("keeps publish-ready captions and disclosure copy beside the assets", async () => {
    const campaign = new URL(
      "../docs/social/xiaohongshu-campaign/README.md",
      import.meta.url,
    );
    const content = await readFile(campaign, "utf8");

    await access(
      new URL(
        "../docs/social/xiaohongshu-campaign/01-caption.md",
        import.meta.url,
      ),
    );
    await access(
      new URL(
        "../docs/social/xiaohongshu-campaign/02-caption.md",
        import.meta.url,
      ),
    );
    await access(
      new URL(
        "../docs/social/xiaohongshu-campaign/03-caption.md",
        import.meta.url,
      ),
    );
    expect(content).toContain("模拟数据");
    expect(content).toContain("它不是安全沙箱");
    expect(content).toContain("不写「最强」「完全自治」「生产级安全」");
  });
});
