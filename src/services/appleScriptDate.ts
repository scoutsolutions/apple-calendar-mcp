/**
 * AppleScript date-block generator for v0.2.2.
 *
 * Emits a locale-independent AppleScript fragment that binds a variable to
 * a specific wall-clock date. Bypasses AppleScript's `date "..."` literal
 * coercion, which silently truncates 24-hour times to midnight on US
 * English macOS.
 *
 * The output must be inlined inside a scope where `current date` resolves
 * (e.g., inside a `tell application "Calendar"` block).
 *
 * @module appleScriptDate
 */

import type { DateComponents } from "./dateInput.js";

export interface BuildAppleScriptDateBlockOptions {
  /**
   * When true, emit `set time of <var> to 0` regardless of the components'
   * hour/minute/second. Used for all-day events so the underlying Apple
   * Calendar entry is anchored at midnight local time.
   */
  forceMidnight?: boolean;
}

/**
 * Build a locale-independent AppleScript fragment that assigns the given
 * components to an AppleScript date variable.
 *
 * The assignment order is load-bearing:
 *   1. `set day of <var> to 1` — clears the month-rollover trap. If the
 *      current date is the 31st and we assign a month without fewer days,
 *      AppleScript silently rolls forward (Mar 31 + month=2 → Mar 3).
 *   2. `set year/month/day` — numeric assignments, locale-independent.
 *   3. `set time of <var> to <seconds-since-midnight>` — the canonical
 *      AppleScript idiom (time property is 0-86399 seconds).
 *
 * @param components - Parsed date components from parseUserDateInput
 * @param varName - AppleScript variable name (e.g., "startDateObj")
 * @param options - forceMidnight for all-day events
 */
export function buildAppleScriptDateBlock(
  components: DateComponents,
  varName: string,
  options: BuildAppleScriptDateBlockOptions = {}
): string {
  const { year, month, day, hour, minute, second } = components;
  const timeSeconds = options.forceMidnight ? 0 : hour * 3600 + minute * 60 + second;

  return [
    `set ${varName} to (current date)`,
    `set day of ${varName} to 1`,
    `set year of ${varName} to ${year}`,
    `set month of ${varName} to ${month}`,
    `set day of ${varName} to ${day}`,
    `set time of ${varName} to ${timeSeconds}`,
  ].join("\n");
}
