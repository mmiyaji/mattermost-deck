import { describe, expect, it } from "vitest";
import {
  localizePerformancePurpose,
  PERFORMANCE_PURPOSE_TRANSLATION_KEYS,
  type PerformancePurposeTranslationKey,
} from "./performancePurpose";

const translate = (key: PerformancePurposeTranslationKey) => `translated:${key}`;

describe("performance purpose localization", () => {
  it("maps every known API purpose to a translation key", () => {
    for (const [purpose, key] of Object.entries(PERFORMANCE_PURPOSE_TRANSLATION_KEYS)) {
      expect(localizePerformancePurpose(purpose, translate)).toBe(`translated:${key}`);
    }
  });

  it("uses the localized generic purpose when no purpose was recorded", () => {
    expect(localizePerformancePurpose(undefined, translate)).toBe(
      "translated:options.performancePurposeOtherApiRequest",
    );
  });

  it("keeps an unknown future purpose visible instead of hiding it", () => {
    expect(localizePerformancePurpose("Future API operation", translate)).toBe("Future API operation");
  });
});
