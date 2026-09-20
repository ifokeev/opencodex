import { describe, expect, test } from "bun:test";
import {
  bucketMinutesForWindow,
  buildCompanionSettingsPatch,
  chartPolylinePoints,
  chartStackedBarRects,
  formatCompanionTokens,
} from "../src/pages/usage-companion-utils";

describe("usage companion utilities", () => {
  test("maps chart windows to bounded buckets", () => {
    expect([6, 24, 72, 168].map(bucketMinutesForWindow)).toEqual([15, 60, 180, 360]);
  });

  test("normalizes empty templates and all-selected models", () => {
    expect(buildCompanionSettingsPatch({
      menuBarTemplate: " ",
      models: ["openai/gpt-5", "anthropic/claude"],
    }, ["openai/gpt-5", "anthropic/claude"])).toEqual({
      menuBarTemplate: null,
      models: null,
    });
    expect(buildCompanionSettingsPatch({ models: ["openai/gpt-5"] }, ["openai/gpt-5", "anthropic/claude"])).toEqual({
      models: ["openai/gpt-5"],
    });
  });

  test("creates line and stacked bar geometry", () => {
    expect(chartPolylinePoints([0, 5, 10], 100, 50, 10)).toBe("8,42 50,25 92,8");
    expect(chartStackedBarRects([
      { points: [5] },
      { points: [5] },
    ], 100, 50, 10)).toEqual([
      { x: 9.5, y: 25, width: 81, height: 17, seriesIndex: 0, bucketIndex: 0 },
      { x: 9.5, y: 8, width: 81, height: 17, seriesIndex: 1, bucketIndex: 0 },
    ]);
  });

  test("formats companion token values as integer SI units", () => {
    expect([999, 1_000, 999_600, 1_634_303, 333_400_000, 12_300_000_000].map(formatCompanionTokens)).toEqual([
      "999", "1K", "1M", "2M", "333M", "12B",
    ]);
  });
});
