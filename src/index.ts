#!/usr/bin/env node
/**
 * Apple Calendar MCP Server
 *
 * A Model Context Protocol (MCP) server that provides AI assistants with
 * read-only access to Apple Calendar events across all synced accounts
 * (iCloud, Google, Exchange, etc.).
 *
 * Event creation is deliberately NOT included. AppleScript-created events
 * don't get Teams/Zoom meeting links or proper server-side resources.
 * For meetings that need online-meeting integration, use a Microsoft Graph
 * or Google Calendar MCP instead.
 *
 * @module apple-calendar-mcp
 * @see https://modelcontextprotocol.io
 */

import { createRequire } from "module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AppleCalendarManager } from "@/services/appleCalendarManager.js";

// =============================================================================
// Input Validation Schemas
// =============================================================================

/** Date strings must look like natural-language dates (e.g. "April 20, 2026 12:00 AM").
 *  Block characters that could escape an AppleScript `date "..."` literal. */
const REQUIRED_DATE_SCHEMA = z
  .string()
  .regex(
    /^[a-zA-Z0-9 ,/\-:]+$/,
    "Date must contain only alphanumeric characters, spaces, commas, slashes, hyphens, and colons"
  )
  .refine((val) => !isNaN(new Date(val).getTime()), {
    message: "Date string must be a valid date (e.g., 'January 1, 2026' or '2026-03-15')",
  });

/** Calendar names are free-form text from Apple Calendar. Reject control chars,
 *  double quote, and backslash to prevent AppleScript literal breakout. */
const CALENDAR_NAME_SCHEMA = z
  .string()
  .min(1)
  .max(200)
  .regex(
    // eslint-disable-next-line no-control-regex
    /^[^\x00-\x1F\x7F\\"]+$/,
    "Calendar name must not contain control characters, backslash, or double quote"
  );

/** Event UIDs per RFC 5545 can be essentially any text. Real UIDs from Exchange
 *  and Outlook commonly contain '/', '+', '=', '{', '}'. So we constrain by
 *  rejecting only the dangerous chars rather than allowlisting a restricted
 *  charset that would break real-world UIDs. */
const EVENT_UID_SCHEMA = z
  .string()
  .min(1)
  .max(255)
  .regex(
    // eslint-disable-next-line no-control-regex
    /^[^\x00-\x1F\x7F"\\]+$/,
    "Event UID must not contain control characters, backslash, or double quote"
  );

/** Search queries are user-facing text. Allow most chars but reject control
 *  chars. Cap length to prevent pathological AppleScript construction. */
const SEARCH_QUERY_SCHEMA = z
  .string()
  .min(1)
  .max(500)
  .regex(
    // eslint-disable-next-line no-control-regex
    /^[^\x00-\x1F\x7F]+$/,
    "Search query must not contain control characters"
  );

/** Bounded integer limit for event listing. */
const EVENT_LIMIT_SCHEMA = z.number().int().min(1).max(500);

/** URL for event property. MUST be http or https - javascript:, file:, data:
 *  and other schemes are rejected because event URLs get rendered in
 *  various calendar clients (Outlook, Apple Calendar popovers, CalDAV
 *  viewers) where a javascript: URL is an XSS vector. */
const URL_SCHEMA = z
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
const EMAIL_SCHEMA = z
  .string()
  .min(3)
  .max(320)
  .regex(
    // eslint-disable-next-line no-control-regex
    /^[^\x00-\x1F\x7F\\"\s@]+@[^\x00-\x1F\x7F\\"\s@]+$/,
    "Must be a valid ASCII email address (no whitespace, no control characters, exactly one @)"
  );

/** Participation status enum per RFC 5545. Kept as an enum (not free
 *  string) so AppleScript constant mapping is explicit (see Task 1). */
const PARTICIPATION_STATUS_SCHEMA = z.enum(["accepted", "declined", "tentative", "needs-action"]);

/** Event summary (title). Single-line text, control chars rejected. */
const EVENT_SUMMARY_SCHEMA = z
  .string()
  .min(1)
  .max(500)
  .regex(
    // eslint-disable-next-line no-control-regex
    /^[^\x00-\x1F\x7F]+$/,
    "Event summary must not contain control characters or newlines"
  );

/** Event location. Single-line, allows empty (to clear a location). */
const EVENT_LOCATION_SCHEMA = z
  .string()
  .max(500)
  .regex(
    // eslint-disable-next-line no-control-regex
    /^[^\x00-\x1F\x7F]*$/,
    "Location must not contain control characters or newlines"
  );

/** Event description. ALLOWS newlines (\n, \r\n, \r) - multi-line notes
 *  are legitimate. Rejects all other control chars. Handled via
 *  buildMultilineAppleScript in the service layer. */
const EVENT_DESCRIPTION_SCHEMA = z
  .string()
  .max(5000)
  .regex(
    // eslint-disable-next-line no-control-regex
    /^[^\x00-\x08\x0B\x0C\x0E-\x1F\x7F]*$/,
    "Description may contain newlines but not other control characters"
  );

/** Tightened date schema. Rejects rolled-over dates ("Feb 30" -> Mar 2),
 *  bounds to a reasonable window to prevent typos landing years away. */
const STRICT_DATE_SCHEMA = z
  .string()
  .regex(
    /^[a-zA-Z0-9 ,/\-:]+$/,
    "Date must contain only alphanumeric characters, spaces, commas, slashes, hyphens, and colons"
  )
  .refine((val) => !isNaN(new Date(val).getTime()), {
    message: "Date string must be a valid date",
  })
  .refine(
    (val) => {
      const d = new Date(val);
      const now = Date.now();
      const fiftyYears = 50 * 365.25 * 24 * 60 * 60 * 1000;
      return Math.abs(d.getTime() - now) < fiftyYears;
    },
    { message: "Date must be within 50 years of today" }
  );

// Read version from package.json to keep it in sync
const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

// =============================================================================
// Server Initialization
// =============================================================================

const server = new McpServer({
  name: "apple-calendar",
  version,
  description:
    "MCP server for reading Apple Calendar events across iCloud, Google, Exchange accounts",
});

const calendarManager = new AppleCalendarManager();

// =============================================================================
// Response Helpers
// =============================================================================

function successResponse(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
  };
}

function errorResponse(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

function withErrorHandling<T extends Record<string, unknown>>(
  handler: (params: T) => ReturnType<typeof successResponse>,
  errorPrefix: string
) {
  return async (params: T) => {
    try {
      return handler(params);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return errorResponse(`${errorPrefix}: ${message}`);
    }
  };
}

/** Format an event row for display. */
function formatEventLine(e: {
  summary: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  location?: string;
  calendarName: string;
  id: string;
}): string {
  const timeStr = e.allDay ? "all-day" : `${e.startDate} → ${e.endDate}`;
  const locStr = e.location ? ` @ ${e.location}` : "";
  return `  • ${e.summary} [${e.calendarName}] (${timeStr})${locStr}\n    ID: ${e.id}`;
}

// =============================================================================
// Calendar Tools (read-only)
// =============================================================================

// --- list-calendars ---

server.tool(
  "list-calendars",
  {},
  withErrorHandling(() => {
    const calendars = calendarManager.listCalendars();

    if (calendars.length === 0) {
      return successResponse("No calendars found.");
    }

    const lines = calendars.map((c) => {
      const w = c.writable ? "✏️" : "🔒";
      const desc = c.description ? ` — ${c.description}` : "";
      return `  ${w} ${c.name}${desc}`;
    });

    return successResponse(`Found ${calendars.length} calendar(s):\n${lines.join("\n")}`);
  }, "Error listing calendars")
);

// --- list-events ---

server.tool(
  "list-events",
  {
    startDate: REQUIRED_DATE_SCHEMA.describe(
      "Start date (e.g., 'April 20, 2026 12:00 AM' or ISO format)"
    ),
    endDate: REQUIRED_DATE_SCHEMA.describe(
      "End date (e.g., 'April 27, 2026 11:59 PM' or ISO format)"
    ),
    calendarName: CALENDAR_NAME_SCHEMA.optional().describe(
      "Optional calendar name to filter by. Exchange default is often 'Calendar'. Use list-calendars to see options."
    ),
    limit: EVENT_LIMIT_SCHEMA.optional()
      .default(100)
      .describe("Max results (default 100, max 500)"),
  },
  withErrorHandling(({ startDate, endDate, calendarName, limit = 100 }) => {
    const events = calendarManager.listEvents(startDate, endDate, calendarName, limit);

    if (events.length === 0) {
      return successResponse("No events found in that range.");
    }

    const header = `Found ${events.length} event(s)${calendarName ? ` in "${calendarName}"` : ""}:`;
    return successResponse(`${header}\n${events.map(formatEventLine).join("\n")}`);
  }, "Error listing events")
);

// --- search-events ---

server.tool(
  "search-events",
  {
    query: SEARCH_QUERY_SCHEMA.describe("Text to search for in event summary, location, or notes"),
    startDate: REQUIRED_DATE_SCHEMA.optional().describe(
      "Optional start date (highly recommended - searching all history is slow)"
    ),
    endDate: REQUIRED_DATE_SCHEMA.optional().describe("Optional end date"),
    limit: EVENT_LIMIT_SCHEMA.optional().default(50).describe("Max results (default 50, max 500)"),
  },
  withErrorHandling(({ query, startDate, endDate, limit = 50 }) => {
    const events = calendarManager.searchEvents(query, startDate, endDate, limit);

    if (events.length === 0) {
      return successResponse(`No events matching "${query}".`);
    }

    return successResponse(
      `Found ${events.length} event(s) matching "${query}":\n${events.map(formatEventLine).join("\n")}`
    );
  }, "Error searching events")
);

// --- get-event ---

server.tool(
  "get-event",
  {
    uid: EVENT_UID_SCHEMA.describe("Event UID (get from list-events or search-events)"),
  },
  withErrorHandling(({ uid }) => {
    const event = calendarManager.getEvent(uid);

    if (!event) {
      return successResponse(`Event with UID "${uid}" not found.`);
    }

    const lines: string[] = [];
    lines.push(`📅 ${event.summary}`);
    lines.push(`Calendar: ${event.calendarName}`);
    lines.push(`When: ${event.allDay ? "all-day on " : ""}${event.startDate} → ${event.endDate}`);
    if (event.location) lines.push(`Location: ${event.location}`);
    if (event.status) lines.push(`Status: ${event.status}`);
    if (event.url) lines.push(`URL: ${event.url}`);

    if (event.attendees.length > 0) {
      lines.push(`\nAttendees (${event.attendees.length}):`);
      for (const a of event.attendees) {
        lines.push(`  • ${a.name} (${a.status})`);
      }
    }

    if (event.description) {
      lines.push(`\n--- Notes ---\n${event.description}`);
    }

    return successResponse(lines.join("\n"));
  }, "Error getting event")
);

// --- get-today ---

server.tool(
  "get-today",
  {},
  withErrorHandling(() => {
    const events = calendarManager.getToday();

    if (events.length === 0) {
      return successResponse("No events today.");
    }

    return successResponse(
      `Today (${events.length} event(s)):\n${events.map(formatEventLine).join("\n")}`
    );
  }, "Error getting today's events")
);

// --- get-this-week ---

server.tool(
  "get-this-week",
  {},
  withErrorHandling(() => {
    const events = calendarManager.getThisWeek();

    if (events.length === 0) {
      return successResponse("No events this week.");
    }

    return successResponse(
      `This week (${events.length} event(s)):\n${events.map(formatEventLine).join("\n")}`
    );
  }, "Error getting this week's events")
);

// =============================================================================
// Calendar Tools (write - v0.2.0+)
// =============================================================================

// --- respond-to-invitation ---

server.tool(
  "respond-to-invitation",
  {
    uid: EVENT_UID_SCHEMA.describe("Event UID (from list-events, search-events, or get-event)"),
    status: PARTICIPATION_STATUS_SCHEMA.describe(
      "Your response: accepted, declined, tentative, or needs-action. NOTE: Whether the organizer receives the response email depends on account type - iCloud reliably sends, Exchange/Google behavior is inconsistent."
    ),
    userEmail: EMAIL_SCHEMA.describe(
      "Your email address as it appears on the invitation (identifies you among attendees)."
    ),
  },
  withErrorHandling(({ uid, status, userEmail }) => {
    const outcome = calendarManager.respondToInvitation(uid, status, userEmail);
    const messages: Record<typeof outcome, string> = {
      ok: `Status updated to "${status}" on event ${uid}.`,
      "event-not-found": `Event ${uid} not found in any calendar.`,
      "attendee-not-found": `Your email (${userEmail}) was not found among the event's attendees.`,
      error: `An error occurred. See server logs for details.`,
    };
    return successResponse(messages[outcome]);
  }, "Error responding to invitation")
);

// --- create-event ---

server.tool(
  "create-event",
  {
    calendarName: CALENDAR_NAME_SCHEMA.describe(
      "Target calendar name. Must be writable and unambiguous. Exchange's default " +
        "'Calendar' is often duplicated across accounts - use list-calendars to confirm " +
        "your target appears exactly once. NOTE: AppleScript cannot create Teams/Zoom/Meet " +
        "meeting URLs. For online meetings, use Outlook or Google Calendar instead."
    ),
    summary: EVENT_SUMMARY_SCHEMA.describe("Event title"),
    startDate: STRICT_DATE_SCHEMA.describe("Start time"),
    endDate: STRICT_DATE_SCHEMA.describe("End time (must be strictly after startDate)"),
    location: EVENT_LOCATION_SCHEMA.optional().describe("Physical or virtual location"),
    description: EVENT_DESCRIPTION_SCHEMA.optional().describe(
      "Event notes. Newlines allowed. For online meetings, paste the meeting URL here or in the url field."
    ),
    url: URL_SCHEMA.optional().describe(
      "Event URL (http or https only). Useful for pasting a Teams/Zoom link from another source."
    ),
    allDay: z.boolean().optional().default(false).describe("Create as all-day event"),
  },
  withErrorHandling(
    ({ calendarName, summary, startDate, endDate, location, description, url, allDay }) => {
      // Strict date ordering (I1)
      if (new Date(startDate).getTime() >= new Date(endDate).getTime()) {
        return successResponse("endDate must be strictly after startDate");
      }
      const uid = calendarManager.createEvent(calendarName, summary, startDate, endDate, {
        location,
        description,
        url,
        allDay,
      });
      if (!uid) {
        return successResponse(
          `Failed to create event. Possible causes: calendar "${calendarName}" ` +
            `doesn't exist, is read-only, or is ambiguous (duplicated across accounts). ` +
            `Run list-calendars to see available options.`
        );
      }
      return successResponse(`Event created. UID: ${uid}`);
    },
    "Error creating event"
  )
);

// =============================================================================
// Server Startup
// =============================================================================

const transport = new StdioServerTransport();
await server.connect(transport);
