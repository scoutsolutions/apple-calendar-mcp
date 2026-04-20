/**
 * User-supplied date-string parser for v0.2.2.
 *
 * Single source of truth: used by BOTH the Zod refinement in schemas.ts and
 * the AppleScript builder in appleCalendarManager.ts. This prevents the
 * class of bug that v0.2.2 fixes — where JS and AppleScript parsed the same
 * input differently and neither layer noticed.
 *
 * All inputs are interpreted as LOCAL WALL-CLOCK time. ISO strings with a
 * trailing `Z` or `±HH:mm` offset are explicitly rejected — accepting them
 * would require defining instant-vs-wall-clock semantics across day
 * boundaries, which is out of scope for this patch release.
 *
 * @module dateInput
 */

export interface DateComponents {
  /** Four-digit year. */
  year: number;
  /** 1-12. */
  month: number;
  /** 1-31. */
  day: number;
  /** 0-23. */
  hour: number;
  /** 0-59. */
  minute: number;
  /** 0-59. */
  second: number;
  /**
   * True when the input had no time portion (e.g., "2026-04-21"). Callers
   * decide whether to treat this as an all-day event; the parser just
   * reports what was supplied.
   */
  dateOnly: boolean;
}

/**
 * Parse a user-supplied date string per the v0.2.2 supported-format policy.
 *
 * Supported formats (all local wall-clock):
 *   - `YYYY-MM-DD` (date-only, time = 00:00:00, dateOnly=true)
 *   - `YYYY-MM-DD HH:mm[:ss]` (space separator)
 *   - `YYYY-MM-DDTHH:mm[:ss]` (T separator, no Z or offset)
 *   - Natural language: "April 21, 2026 15:00:00", "April 21, 2026 3:00 PM"
 *   - US slash: "4/21/2026", "4/21/2026 15:00"
 *
 * Rejected:
 *   - Any trailing `Z` (UTC)
 *   - Any trailing `±HH:mm` or `±HHmm` offset
 *   - Anything `new Date()` can't make sense of
 *
 * The `YYYY-MM-DD` special-case exists because JavaScript's `new Date()`
 * parses ISO date-only strings as UTC midnight. In US timezones that makes
 * `.getDate()` return the previous day. This function constructs local
 * components directly, avoiding that trap.
 *
 * @throws Error with a user-facing message explaining the rejection.
 */
export function parseUserDateInput(input: string): DateComponents {
  const trimmed = input.trim();

  if (/Z$|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    throw new Error(
      `Timezone-qualified dates (Z or offset) are not supported. Pass local wall-clock time instead of: ${input}`
    );
  }

  const dateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return {
      year: Number(y),
      month: Number(m),
      day: Number(d),
      hour: 0,
      minute: 0,
      second: 0,
      dateOnly: true,
    };
  }

  const localDT = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (localDT) {
    const [, y, m, d, h, min, s] = localDT;
    return {
      year: Number(y),
      month: Number(m),
      day: Number(d),
      hour: Number(h),
      minute: Number(min),
      second: s ? Number(s) : 0,
      dateOnly: false,
    };
  }

  const parsed = new Date(input);
  if (isNaN(parsed.getTime())) {
    throw new Error(`Unparseable date: ${input}`);
  }
  return {
    year: parsed.getFullYear(),
    month: parsed.getMonth() + 1,
    day: parsed.getDate(),
    hour: parsed.getHours(),
    minute: parsed.getMinutes(),
    second: parsed.getSeconds(),
    dateOnly: false,
  };
}
