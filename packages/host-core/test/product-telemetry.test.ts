import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ProductTelemetry,
  productTelemetryEnabled,
  productTelemetrySource,
  type ProductTelemetryPayload,
} from "../src/product-telemetry.js";

const ATTRIBUTION_ID = "123e4567-e89b-42d3-a456-426614174000";
const EVENT_ID = "123e4567-e89b-42d3-a456-426614174001";

describe("ProductTelemetry", () => {
  it("records an attributed event once without product or project content", async () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-telemetry-"));
    const payloads: ProductTelemetryPayload[] = [];
    let nextId = EVENT_ID;
    try {
      const telemetry = new ProductTelemetry({
        homePath: root,
        source: "self_host",
        appVersion: "1.1.0",
        attributionId: ATTRIBUTION_ID,
        now: () => new Date("2026-08-23T12:00:00.000Z"),
        createId: () => nextId,
        transport: {
          async send(_endpoint, payload) {
            payloads.push(payload);
          },
        },
      });

      expect(await telemetry.reportOnce("install_succeeded")).toBe(true);
      nextId = "123e4567-e89b-42d3-a456-426614174002";
      expect(await telemetry.reportOnce("install_succeeded")).toBe(false);

      expect(payloads).toEqual([
        expect.objectContaining({
          schemaVersion: 1,
          eventId: EVENT_ID,
          anonymousId: ATTRIBUTION_ID,
          name: "install_succeeded",
          occurredAt: "2026-08-23T12:00:00.000Z",
          source: "self_host",
          appVersion: "1.1.0",
        }),
      ]);
      expect(JSON.stringify(payloads[0])).not.toMatch(
        /prompt|project|model|path|token|key/i,
      );
      expect(
        JSON.parse(readFileSync(join(root, "telemetry.json"), "utf8")),
      ).toEqual({ schemaVersion: 1, anonymousId: ATTRIBUTION_ID });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retries after transport failure and does not persist state when disabled", async () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-telemetry-"));
    let attempts = 0;
    try {
      const telemetry = new ProductTelemetry({
        homePath: root,
        source: "desktop",
        appVersion: "1.1.0",
        createId: () => ATTRIBUTION_ID,
        transport: {
          async send() {
            attempts += 1;
            if (attempts === 1) throw new Error("offline");
          },
        },
      });

      expect(await telemetry.reportOnce("first_task_completed")).toBe(false);
      expect(await telemetry.reportOnce("first_task_completed")).toBe(true);
      expect(attempts).toBe(2);

      const disabledRoot = join(root, "disabled");
      const disabled = new ProductTelemetry({
        homePath: disabledRoot,
        source: "desktop",
        appVersion: "1.1.0",
        enabled: false,
      });
      expect(await disabled.reportOnce("install_succeeded")).toBe(false);
      expect(existsSync(disabledRoot)).toBe(false);

      const markerRoot = join(root, "marker-disabled");
      mkdirSync(markerRoot);
      writeFileSync(join(markerRoot, "telemetry-disabled"), "disabled\n");
      const markerDisabled = new ProductTelemetry({
        homePath: markerRoot,
        source: "desktop",
        appVersion: "1.1.0",
      });
      expect(await markerDisabled.reportOnce("install_succeeded")).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("never interrupts the product when its state directory is unavailable", async () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-telemetry-"));
    const blockedHome = join(root, "not-a-directory");
    writeFileSync(blockedHome, "file\n");
    try {
      const telemetry = new ProductTelemetry({
        homePath: blockedHome,
        source: "desktop",
        appVersion: "1.1.0",
      });

      await expect(telemetry.reportOnce("install_succeeded")).resolves.toBe(
        false,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("product telemetry environment", () => {
  it("supports an explicit opt-out and normalizes sources", () => {
    expect(productTelemetryEnabled({})).toBe(true);
    expect(
      productTelemetryEnabled({ THREADLIGHT_TELEMETRY_DISABLED: "true" }),
    ).toBe(false);
    expect(productTelemetrySource("desktop")).toBe("desktop");
    expect(productTelemetrySource("self_host")).toBe("self_host");
    expect(productTelemetrySource("unexpected")).toBe("source");
  });
});
