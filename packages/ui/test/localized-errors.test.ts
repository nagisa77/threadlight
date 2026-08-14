import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_ERROR_CODES,
  CONNECTOR_AUTH_ERROR_CODES,
} from "@threadlight/protocol";

import { attachmentErrorMessage } from "../src/features/composer/attachment-controller.js";
import { connectorErrorMessage } from "../src/features/composer/capability-controller.js";
import type { Translate } from "../src/i18n.js";

const t = ((key: string) => key) as Translate;

describe("localized feature errors", () => {
  it("translates attachment transport codes at the composer boundary", () => {
    expect(
      attachmentErrorMessage(new Error(ATTACHMENT_ERROR_CODES.fileChanged), t),
    ).toBe("attachmentFileChanged");
    expect(
      attachmentErrorMessage(
        new Error(ATTACHMENT_ERROR_CODES.projectRequired),
        t,
      ),
    ).toBe("attachmentProjectRequired");
  });

  it("translates connector adapter codes at the capability boundary", () => {
    expect(
      connectorErrorMessage(
        new Error(CONNECTOR_AUTH_ERROR_CODES.popupBlocked),
        t,
      ),
    ).toBe("connectorPopupBlocked");
    expect(
      connectorErrorMessage(
        new Error(CONNECTOR_AUTH_ERROR_CODES.popupClosed),
        t,
      ),
    ).toBe("connectorPopupClosed");
  });
});
