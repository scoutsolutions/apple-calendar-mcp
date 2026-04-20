import { describe, it, expect } from "vitest";
import { buildAppleScriptDateBlock } from "./appleScriptDate.js";
import type { DateComponents } from "./dateInput.js";

const base: DateComponents = {
  year: 2026,
  month: 4,
  day: 21,
  hour: 15,
  minute: 0,
  second: 0,
  dateOnly: false,
};

describe("buildAppleScriptDateBlock", () => {
  it("produces the expected block for a standard datetime", () => {
    const block = buildAppleScriptDateBlock(base, "d");
    expect(block).toBe(
      [
        "set d to (current date)",
        "set day of d to 1",
        "set year of d to 2026",
        "set month of d to 4",
        "set day of d to 21",
        "set time of d to 54000",
      ].join("\n")
    );
  });

  it("computes seconds-since-midnight correctly", () => {
    const block = buildAppleScriptDateBlock({ ...base, hour: 15, minute: 30, second: 45 }, "d");
    // 15*3600 + 30*60 + 45 = 54000 + 1800 + 45 = 55845
    expect(block).toContain("set time of d to 55845");
  });

  it("uses a custom variable name", () => {
    const block = buildAppleScriptDateBlock(base, "startDateObj");
    expect(block).toContain("set startDateObj to (current date)");
    expect(block).toContain("set year of startDateObj to 2026");
    expect(block).not.toContain("set year of d to");
  });

  it("forces midnight when forceMidnight is true (all-day events)", () => {
    const block = buildAppleScriptDateBlock({ ...base, hour: 15, minute: 30, second: 45 }, "d", {
      forceMidnight: true,
    });
    expect(block).toContain("set time of d to 0");
    expect(block).not.toContain("set time of d to 55845");
  });

  it("always emits the rollover guard (day=1) before year/month", () => {
    const block = buildAppleScriptDateBlock(base, "d");
    const lines = block.split("\n");
    const dayOneIdx = lines.findIndex((l) => l === "set day of d to 1");
    const yearIdx = lines.findIndex((l) => l.startsWith("set year of d to"));
    const monthIdx = lines.findIndex((l) => l.startsWith("set month of d to"));
    expect(dayOneIdx).toBeGreaterThan(-1);
    expect(dayOneIdx).toBeLessThan(yearIdx);
    expect(dayOneIdx).toBeLessThan(monthIdx);
  });

  it("emits target day AFTER month assignment to prevent rollover", () => {
    // Jan 31 → assign month 2: if day=31 stays set, AppleScript rolls to Mar 3.
    // The fix: day=1 before month, then target day after.
    const block = buildAppleScriptDateBlock(
      { year: 2026, month: 2, day: 28, hour: 0, minute: 0, second: 0, dateOnly: true },
      "d"
    );
    const lines = block.split("\n");
    const monthIdx = lines.findIndex((l) => l === "set month of d to 2");
    const targetDayIdx = lines.findIndex((l) => l === "set day of d to 28");
    expect(monthIdx).toBeGreaterThan(-1);
    expect(targetDayIdx).toBeGreaterThan(monthIdx);
  });

  it("handles midnight input without forceMidnight", () => {
    const block = buildAppleScriptDateBlock(
      { ...base, hour: 0, minute: 0, second: 0, dateOnly: true },
      "d"
    );
    expect(block).toContain("set time of d to 0");
  });

  it("handles end-of-day time (23:59:59 → 86399 seconds)", () => {
    const block = buildAppleScriptDateBlock({ ...base, hour: 23, minute: 59, second: 59 }, "d");
    expect(block).toContain("set time of d to 86399");
  });
});
