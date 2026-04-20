/**
 * Input validation schemas for Apple Calendar MCP tools.
 *
 * Extracted to a standalone module so tests can import them directly
 * without instantiating the MCP server. The same schemas are used by
 * tool registrations in index.ts.
 *
 * All schemas here represent the FIRST line of defense. Service-layer
 * escape functions (in appleCalendarManager.ts) are the SECOND line.
 *
 * @module schemas
 */

import { z } from "zod";

// =============================================================================
// Date validation helpers
// =============================================================================

/**
 * Reject dates that JavaScript silently rolls over (e.g., "Feb 30 2026"
 * becomes "Mar 2 2026" via `new Date(...)`).
 *
 * We verify the Date constructor's output round-trips back to the same
 * day/month/year for recognized input formats. Unrecognized formats fall
 * through to trust `new Date(...)` - better than rejecting valid dates
 * we don't know how to parse.
 *
 * Recognized formats:
 *   - ISO-like: YYYY-MM-DD (optional time suffix)
 *   - US slash: M/D/YYYY or MM/DD/YYYY
 *   - Month name: "February 30, 2026", "Feb 30 2026", etc.
 */
function rejectsRolledOver(val: string): boolean {
  if (isNaN(new Date(val).getTime())) return false;

  // For each recognized format, extract the claimed Y/M/D from the input
  // string, construct a LOCAL-TIME Date from those components, and verify
  // the constructed Date reports the same Y/M/D. This catches rollovers
  // without the timezone gotcha of parsing "2026-04-20" as UTC midnight
  // and calling .getDate() in local time.

  const roundTrip = (yr: number, mo: number, dy: number): boolean => {
    const test = new Date(yr, mo - 1, dy);
    return test.getFullYear() === yr && test.getMonth() === mo - 1 && test.getDate() === dy;
  };

  // ISO format: 2026-02-30 (or with time suffix)
  const iso = val.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return roundTrip(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  // US slash format: 2/30/2026
  const slash = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) {
    return roundTrip(Number(slash[3]), Number(slash[1]), Number(slash[2]));
  }

  // Month name format: "Feb 30 2026", "February 30, 2026"
  const monthNames = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];
  const lower = val.toLowerCase();
  for (let i = 0; i < 12; i++) {
    if (lower.includes(monthNames[i])) {
      const dayMatch = val.match(/\b(\d{1,2})\b/);
      const yearMatch = val.match(/\b(\d{4})\b/);
      if (dayMatch && yearMatch) {
        return roundTrip(Number(yearMatch[1]), i + 1, Number(dayMatch[1]));
      }
    }
  }

  // Unknown format - trust the Date constructor.
  return true;
}

/**
 * Bound dates to ±50 years of today. Catches typos like "January 1, 1800"
 * or "December 31, 9999" that would pass structural validation.
 */
function withinFiftyYears(val: string): boolean {
  const d = new Date(val);
  if (isNaN(d.getTime())) return false;
  const now = Date.now();
  const fiftyYears = 50 * 365.25 * 24 * 60 * 60 * 1000;
  return Math.abs(d.getTime() - now) < fiftyYears;
}

// =============================================================================
// Schemas
// =============================================================================

/** Date strings for optional date filters (v0.1.x read tools). */
export const DATE_FILTER_SCHEMA = z
  .string()
  .regex(
    /^[a-zA-Z0-9 ,/\-:]+$/,
    "Date must contain only alphanumeric characters, spaces, commas, slashes, hyphens, and colons"
  )
  .refine((val) => !isNaN(new Date(val).getTime()), {
    message: "Date string must be a valid date (e.g., 'January 1, 2026' or '2026-03-15')",
  })
  .refine(rejectsRolledOver, {
    message:
      "Date is not valid (e.g., 'Feb 30' or 'Sep 31' - JavaScript silently rolls these over)",
  })
  .optional();

/** Required date schema for write tools. Adds 50-year bounds and
 *  rolled-over rejection on top of DATE_FILTER_SCHEMA's base validation. */
export const REQUIRED_DATE_SCHEMA = z
  .string()
  .regex(
    /^[a-zA-Z0-9 ,/\-:]+$/,
    "Date must contain only alphanumeric characters, spaces, commas, slashes, hyphens, and colons"
  )
  .refine((val) => !isNaN(new Date(val).getTime()), {
    message: "Date string must be a valid date (e.g., 'January 1, 2026' or '2026-03-15')",
  })
  .refine(rejectsRolledOver, {
    message:
      "Date is not valid (e.g., 'Feb 30' or 'Sep 31' - JavaScript silently rolls these over)",
  });

/** Strict date schema: required date + 50-year bounds. Used for
 *  write-tool dates where we want to catch typo-years (1800, 9999). */
export const STRICT_DATE_SCHEMA = REQUIRED_DATE_SCHEMA.refine(withinFiftyYears, {
  message: "Date must be within 50 years of today",
});

/** Calendar names are free-form text from Apple Calendar. Reject control
 *  chars, double quote, and backslash to prevent AppleScript literal breakout. */
export const CALENDAR_NAME_SCHEMA = z
  .string()
  .min(1)
  .max(200)
  .regex(
    // eslint-disable-next-line no-control-regex
    /^[^\x00-\x1F\x7F\\"]+$/,
    "Calendar name must not contain control characters, backslash, or double quote"
  );

/** Event UIDs per RFC 5545 can be essentially any text. Real UIDs from
 *  Exchange and Outlook commonly contain '/', '+', '=', '{', '}'. Constrain
 *  by rejecting only the dangerous chars rather than allowlisting a
 *  restricted charset that would break real-world UIDs. */
export const EVENT_UID_SCHEMA = z
  .string()
  .min(1)
  .max(255)
  .regex(
    // eslint-disable-next-line no-control-regex
    /^[^\x00-\x1F\x7F"\\]+$/,
    "Event UID must not contain control characters, backslash, or double quote"
  );

/** Search queries are user-facing text. Allow most chars but reject
 *  control chars. Cap length to prevent pathological AppleScript construction. */
export const SEARCH_QUERY_SCHEMA = z
  .string()
  .min(1)
  .max(500)
  .regex(
    // eslint-disable-next-line no-control-regex
    /^[^\x00-\x1F\x7F]+$/,
    "Search query must not contain control characters"
  );

/** Bounded integer limit for event listing. */
export const EVENT_LIMIT_SCHEMA = z.number().int().min(1).max(500);

/** URL for event property. MUST be http or https - javascript:, file:, data:
 *  and other schemes are rejected because event URLs get rendered in
 *  various calendar clients (Outlook, Apple Calendar popovers, CalDAV
 *  viewers) where a javascript: URL is an XSS vector. */
export const URL_SCHEMA = z
  .string()
  .url()
  .max(2000)
  .refine(
    (u) => {
      try {
        const proto = new URL(u).protocol;
        return proto === "http:" || proto === "https:";
      } catch {
        return false;
      }
    },
    { message: "URL must use http or https scheme" }
  );

/** Email address with @ excluded from both sides (prevents a@b@c),
 *  control chars rejected, whitespace rejected. IDN emails (non-ASCII)
 *  are NOT supported - Apple Calendar normalizes to punycode anyway. */
export const EMAIL_SCHEMA = z
  .string()
  .min(3)
  .max(320)
  .regex(
    // eslint-disable-next-line no-control-regex
    /^[^\x00-\x1F\x7F\\"\s@]+@[^\x00-\x1F\x7F\\"\s@]+$/,
    "Must be a valid ASCII email address (no whitespace, no control characters, exactly one @)"
  );

/** Participation status enum per RFC 5545. Kept as an enum so the
 *  AppleScript constant mapping in the service layer is explicit. */
export const PARTICIPATION_STATUS_SCHEMA = z.enum([
  "accepted",
  "declined",
  "tentative",
  "needs-action",
]);

/** Event summary (title). Single-line text, control chars rejected. */
export const EVENT_SUMMARY_SCHEMA = z
  .string()
  .min(1)
  .max(500)
  .regex(
    // eslint-disable-next-line no-control-regex
    /^[^\x00-\x1F\x7F]+$/,
    "Event summary must not contain control characters or newlines"
  );

/** Event location. Single-line, allows empty (to clear a location). */
export const EVENT_LOCATION_SCHEMA = z
  .string()
  .max(500)
  .regex(
    // eslint-disable-next-line no-control-regex
    /^[^\x00-\x1F\x7F]*$/,
    "Location must not contain control characters or newlines"
  );

/** Event description. ALLOWS newlines (\n, \r\n, \r) - multi-line notes
 *  are legitimate. Rejects all other control chars. Multi-line handling
 *  happens via buildMultilineAppleScript in the service layer. */
export const EVENT_DESCRIPTION_SCHEMA = z
  .string()
  .max(5000)
  .regex(
    // eslint-disable-next-line no-control-regex
    /^[^\x00-\x08\x0B\x0C\x0E-\x1F\x7F]*$/,
    "Description may contain newlines but not other control characters"
  );
