import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

const siteCssUrl = new URL("../src/styles/site.css", import.meta.url);
const siteFoundationCssUrl = new URL(
  "../src/styles/site-foundation.css",
  import.meta.url,
);
const siteSectionsCssUrl = new URL(
  "../src/styles/site-sections.css",
  import.meta.url,
);
const appIconSvgUrl = new URL(
  "../../desktop/resources/app-icon.svg",
  import.meta.url,
);
const appIconPngUrl = new URL(
  "../../desktop/resources/app-icon.png",
  import.meta.url,
);
const ogImageUrl = new URL("../public/og.png", import.meta.url);
const readmeUrl = new URL("../../../README.md", import.meta.url);
const englishReadmeUrl = new URL("../../../README.en.md", import.meta.url);

const retiredBrandColors = /#(?:d56a3a|df7b4d|e2743c|ee8047|f1c8af|f5e3d8)\b/i;

describe("neutral brand palette", () => {
  it("keeps the website, icon source, and README badges free of the retired orange palette", () => {
    const siteCss = [siteCssUrl, siteFoundationCssUrl, siteSectionsCssUrl]
      .map((url) => readFileSync(url, "utf8"))
      .join("\n");
    const appIconSvg = readFileSync(appIconSvgUrl, "utf8");
    const readmes = `${readFileSync(readmeUrl, "utf8")}\n${readFileSync(englishReadmeUrl, "utf8")}`;

    expect(siteCss).toMatch(
      /--dark:\s*#101012;[\s\S]*--cream:\s*#f3f3f4;[\s\S]*--accent:\s*#3a3a3f;[\s\S]*--accent-soft:\s*#d6d6d9;/,
    );
    expect(siteCss).toMatch(
      /\.app-frame img\s*\{[^}]*filter:\s*grayscale\(1\);/s,
    );
    expect(siteCss).toMatch(
      /\.capability-media img\s*\{[^}]*filter:\s*grayscale\(1\);/s,
    );
    expect(appIconSvg).toContain('stroke="#303034"');
    expect(readmes).toContain("Apache--2.0-3A3A3F");
    expect(`${siteCss}\n${appIconSvg}\n${readmes}`).not.toMatch(
      retiredBrandColors,
    );
  });

  it("renders the README icon without orange pixels", async () => {
    const { data, info } = await sharp(fileURLToPath(appIconPngUrl))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect(info.width).toBe(1024);
    expect(info.height).toBe(1024);

    let orangePixels = 0;
    for (let offset = 0; offset < data.length; offset += info.channels) {
      if (data[offset + 3] === 0) continue;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      if (red > 80 && red > green + 12 && green > blue + 6) {
        orangePixels += 1;
      }
    }
    expect(orangePixels).toBe(0);
  });

  it("keeps the website share image at 1200 by 630 without orange pixels", async () => {
    const { data, info } = await sharp(fileURLToPath(ogImageUrl))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let orangePixels = 0;

    expect(info.width).toBe(1200);
    expect(info.height).toBe(630);

    for (let offset = 0; offset < data.length; offset += info.channels) {
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      if (red > 80 && red > green + 12 && green > blue + 6) {
        orangePixels += 1;
      }
    }

    expect(orangePixels).toBe(0);
  });
});
