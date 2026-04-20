#!/usr/bin/env node
/**
 * Apple Calendar MCP Server
 *
 * A Model Context Protocol (MCP) server that provides AI assistants with
 * read and (as of v0.2.0) limited write access to Apple Calendar events
 * across all synced accounts (iCloud, Google, Exchange, etc.).
 *
 * Write tools (create-event, update-event, delete-event,
 * respond-to-invitation) are deliberately limited. AppleScript cannot
 * provision Teams/Zoom/Meet meeting URLs, so online meetings that need
 * a fresh meeting resource should be created via Outlook, Google
 * Calendar, or the appropriate platform MCP.
 *
 * Set APPLE_CALENDAR_MCP_READ_ONLY=1 to disable write tools server-wide.
 *
 * @module apple-calendar-mcp
 * @see https://modelcontextprotocol.io
 */

import { createRequire } from "module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AppleCalendarManager } from "@/services/appleCalendarManager.js";
import { checkThrottle } from "@/utils/writeHelpers.js";
import {
  REQUIRED_DATE_SCHEMA,
  STRICT_DATE_SCHEMA,
  CALENDAR_NAME_SCHEMA,
  EVENT_UID_SCHEMA,
  SEARCH_QUERY_SCHEMA,
  EVENT_LIMIT_SCHEMA,
  URL_SCHEMA,
  EMAIL_SCHEMA,
  PARTICIPATION_STATUS_SCHEMA,
  EVENT_SUMMARY_SCHEMA,
  EVENT_LOCATION_SCHEMA,
  EVENT_DESCRIPTION_SCHEMA,
} from "@/schemas.js";

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
    "MCP server for reading and writing Apple Calendar events across iCloud, Google, Exchange accounts. Write tools cannot provision Teams/Zoom/Meet meeting URLs - see docs/TEAMS-LINKS.md.",
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

// --- update-event ---

server.tool(
  "update-event",
  {
    uid: EVENT_UID_SCHEMA.describe("Event UID (from list-events, search-events, or get-event)"),
    calendarName: CALENDAR_NAME_SCHEMA.optional().describe(
      "Optional calendar name for scoped update. RECOMMENDED: when provided, the update is scoped to that specific calendar and refuses if the calendar is ambiguous or read-only. When omitted, searches all calendars by UID (backward compat with v0.2.0)."
    ),
    summary: EVENT_SUMMARY_SCHEMA.optional().describe("New event title (omit to leave unchanged)"),
    startDate: STRICT_DATE_SCHEMA.optional().describe(
      "New start time (omit to leave unchanged). If provided with endDate, endDate must be strictly after."
    ),
    endDate: STRICT_DATE_SCHEMA.optional().describe(
      "New end time (omit to leave unchanged). Must be strictly after startDate if both provided."
    ),
    location: EVENT_LOCATION_SCHEMA.optional().describe(
      "New location (omit to leave unchanged; empty string to clear)"
    ),
    description: EVENT_DESCRIPTION_SCHEMA.optional().describe(
      "New event notes, newlines allowed (omit to leave unchanged; empty string to clear)"
    ),
    url: URL_SCHEMA.optional().describe("New URL, http or https only (omit to leave unchanged)"),
  },
  withErrorHandling(
    ({ uid, calendarName, summary, startDate, endDate, location, description, url }) => {
      // If both dates provided, enforce ordering
      if (startDate && endDate && new Date(startDate).getTime() >= new Date(endDate).getTime()) {
        return successResponse("endDate must be strictly after startDate");
      }
      const ok = calendarManager.updateEvent(
        uid,
        { summary, startDate, endDate, location, description, url },
        calendarName
      );
      if (!ok) {
        const scoped = calendarName
          ? ` (scoped to "${calendarName}" - check it exists, is writable, and is unambiguous)`
          : "";
        return successResponse(
          `Failed to update event ${uid}${scoped}. The event may not exist, or an AppleScript error occurred. See server logs.`
        );
      }
      const changed = Object.entries({ summary, startDate, endDate, location, description, url })
        .filter(([, v]) => v !== undefined)
        .map(([k]) => k);
      if (changed.length === 0) {
        return successResponse(`No fields provided to update on event ${uid}.`);
      }
      return successResponse(`Updated event ${uid}. Fields changed: ${changed.join(", ")}.`);
    },
    "Error updating event"
  )
);

// --- delete-event ---

server.tool(
  "delete-event",
  {
    calendarName: CALENDAR_NAME_SCHEMA.describe(
      "Calendar containing the event. Required for safety scoping - prevents cross-calendar " +
        "delete via prompt injection. Use list-calendars to confirm the calendar name is " +
        "unambiguous; this tool refuses to delete from ambiguous or read-only calendars."
    ),
    uid: EVENT_UID_SCHEMA.describe(
      "Event UID to delete. Refuses to delete recurring event masters - use Calendar.app for series-wide deletion."
    ),
  },
  withErrorHandling(({ calendarName, uid }) => {
    // Per-session rate limit on deletes (N1)
    checkThrottle("delete-event", 10);

    // Get event context BEFORE deleting so we can surface it in the response
    const event = calendarManager.getEvent(uid);
    const context = event ? ` ("${event.summary}" at ${event.startDate})` : "";

    const outcome = calendarManager.deleteEvent(calendarName, uid);
    const messages: Record<typeof outcome, string> = {
      ok:
        `Deleted event ${uid}${context}. Recoverability depends on account type - ` +
        `iCloud/Google retain in trash ~30 days; Exchange goes to Deleted Items; ` +
        `local-only calendars are permanent.`,
      "not-found": `Event ${uid} not found in "${calendarName}" (or calendar is ambiguous/read-only).`,
      "is-recurring-master":
        `Event ${uid} is a recurring series master. Deleting would remove all occurrences. ` +
        `Use Calendar.app to delete individual occurrences or confirm series-wide deletion.`,
      error: `An error occurred. See server logs for details.`,
    };
    return successResponse(messages[outcome]);
  }, "Error deleting event")
);

// =============================================================================
// Server Startup
// =============================================================================

const transport = new StdioServerTransport();
await server.connect(transport);
