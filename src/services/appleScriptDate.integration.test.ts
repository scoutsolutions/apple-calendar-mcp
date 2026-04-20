/**
 * Integration tests for buildAppleScriptDateBlock on macOS.
 *
 * These execute the generated AppleScript via `osascript` and assert on the
 * resulting date's actual components. Snapshot tests verify STRING shape;
 * these verify SEMANTICS. The v0.2.2 bug was silent data corruption that
 * passed any snapshot-only test, so the integration check is required.
 *
 * Skipped on non-darwin platforms (CI on Linux, contributors on Windows).
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { buildAppleScriptDateBlock } from "./appleScriptDate.js";
import { parseUserDateInput } from "./dateInput.js";

const isDarwin = process.platform === "darwin";
const describeMac = isDarwin ? describe : describe.skip;

/**
 * Execute an AppleScript and return its stdout trimmed.
 */
function osascript(script: string): string {
  return execFileSync("/usr/bin/osascript", ["-e", script], {
    encoding: "utf-8",
    timeout: 5000,
  }).trim();
}

/**
 * Build a script that assigns a date to `d` using the helper, then returns
 * the resulting date's components as a pipe-delimited string:
 *   year|month|day|hours|minutes|seconds
 *
 * The returned string is parsed back and compared to expected integers.
 */
function runDateBlockAndExtract(
  input: string,
  forceMidnight = false
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const comp = parseUserDateInput(input);
  const block = buildAppleScriptDateBlock(comp, "d", { forceMidnight });
  const script = `
${block}
set monthNum to (month of d) as integer
return (year of d as string) & "|" & monthNum & "|" & (day of d as string) & "|" & (hours of d as string) & "|" & (minutes of d as string) & "|" & (seconds of d as string)
`;
  const out = osascript(script);
  const [y, m, dy, h, mn, s] = out.split("|").map((n) => Number(n));
  return { year: y, month: m, day: dy, hour: h, minute: mn, second: s };
}

describeMac("buildAppleScriptDateBlock (macOS integration)", () => {
  it("24-hour local datetime lands at the correct wall-clock time", () => {
    // The original v0.2.1 bug: "April 21, 2026 15:00:00" would become midnight.
    const result = runDateBlockAndExtract("April 21, 2026 15:00:00");
    expect(result).toMatchObject({
      year: 2026,
      month: 4,
      day: 21,
      hour: 15,
      minute: 0,
      second: 0,
    });
  });

  it("12-hour PM datetime matches 24-hour equivalent", () => {
    const result = runDateBlockAndExtract("April 21, 2026 3:00:00 PM");
    expect(result).toMatchObject({ day: 21, hour: 15, minute: 0 });
  });

  it("ISO-T datetime preserves wall-clock", () => {
    const result = runDateBlockAndExtract("2026-04-21T15:30:45");
    expect(result).toMatchObject({
      year: 2026,
      month: 4,
      day: 21,
      hour: 15,
      minute: 30,
      second: 45,
    });
  });

  it("YYYY-MM-DD date-only + forceMidnight does NOT shift to prior day", () => {
    // The gauntlet-caught bug: new Date("2026-04-21") → UTC midnight → Apr 20
    // in US timezones. Integration test proves this specific input arrives
    // at the same calendar day after JS parse + AppleScript assign.
    const result = runDateBlockAndExtract("2026-04-21", true);
    expect(result).toMatchObject({
      year: 2026,
      month: 4,
      day: 21, // critical: must be 21, NOT 20
      hour: 0,
      minute: 0,
      second: 0,
    });
  });

  it("month-end rollover is defused by day-to-1 guard", () => {
    // Input: Feb 28 (not 29, since 2026 is not a leap year).
    // Without the guard, `set month to 2` on a date that's currently the
    // 30th or 31st of another month would roll forward to March.
    const result = runDateBlockAndExtract("2026-02-28 10:00:00");
    expect(result).toMatchObject({ year: 2026, month: 2, day: 28, hour: 10 });
  });

  it("leap day is preserved", () => {
    const result = runDateBlockAndExtract("2024-02-29 12:00:00");
    expect(result).toMatchObject({ year: 2024, month: 2, day: 29, hour: 12 });
  });

  it("end-of-day time (23:59:59) is preserved", () => {
    const result = runDateBlockAndExtract("2026-04-21 23:59:59");
    expect(result).toMatchObject({ hour: 23, minute: 59, second: 59 });
  });

  // DST smoke: US spring-forward 2026 is March 8 at 02:00 local. An input
  // of 02:30 on that day lands inside the nonexistent hour. AppleScript's
  // behavior here is implementation-defined - we just record what happens
  // rather than asserting a specific output. The test passes as long as
  // the script executes without throwing (which would indicate a worse
  // bug: generated script is malformed).
  it("DST spring-forward input does not crash AppleScript", () => {
    const result = runDateBlockAndExtract("2026-03-08 02:30:00");
    expect(result.year).toBe(2026);
    expect(result.month).toBe(3);
    expect(result.day).toBe(8);
    // Hour may be 02 or 03 depending on how AppleScript resolves the
    // nonexistent local time. Both are acceptable; only crash is not.
  });
});
