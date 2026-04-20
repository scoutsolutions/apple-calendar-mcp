/**
 * Apple Calendar Manager
 *
 * Handles all interactions with Apple Calendar via AppleScript.
 * Read-only operations for now - event creation is deliberately NOT supported
 * because AppleScript-created events don't get Teams/Zoom meeting links.
 * Use the M365 MCP's create_event tool for meetings that need Teams integration.
 *
 * @module services/appleCalendarManager
 */

import { executeAppleScript } from "@/utils/applescript.js";
import { auditLog, buildMultilineAppleScript, isReadOnlyMode } from "@/utils/writeHelpers.js";
import type {
  AppleCalendar,
  CalendarEvent,
  CalendarEventDetail,
  EventAttendee,
  ParticipationStatus,
} from "@/types.js";
import { parseUserDateInput } from "./dateInput.js";
import { buildAppleScriptDateBlock } from "./appleScriptDate.js";

// =============================================================================
// AppleScript Helpers
// =============================================================================

/**
 * Escapes text for safe embedding in AppleScript string literals.
 * Rejects control characters that could escape the string literal and
 * inject AppleScript statements (e.g., newline injection leading to
 * `do shell script` execution).
 */
function escapeForAppleScript(text: string): string {
  if (!text) return "";
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(text)) {
    throw new Error(
      "Invalid control character in AppleScript string input (rejected to prevent statement injection)"
    );
  }
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Wraps script body in a `tell application "Calendar"` block.
 */
function buildCalendarScript(body: string): string {
  return `tell application "Calendar"\n${body}\nend tell`;
}

/**
 * Converts an AppleScript date string (e.g. "Monday, April 20, 2026 at 11:00:00 AM")
 * into an ISO 8601 string. Returns the original string on failure.
 */
function appleDateToIso(dateStr: string): string {
  if (!dateStr) return "";
  try {
    // AppleScript output: "Monday, April 20, 2026 at 11:00:00 AM"
    const cleaned = dateStr.replace(/^[A-Za-z]+,\s*/, "").replace(" at ", " ");
    const d = new Date(cleaned);
    if (isNaN(d.getTime())) return dateStr;
    return d.toISOString();
  } catch {
    return dateStr;
  }
}

/**
 * Records and fields separators for multi-field AppleScript output.
 * Using ASCII Unit Separator (0x1F) and Record Separator (0x1E) - these
 * are the characters standard libraries designate for exactly this purpose
 * and they cannot appear in user-supplied input (escapeForAppleScript
 * rejects all control characters).
 */
const FIELD_SEP = "\x1F";
const RECORD_SEP = "\x1E";

// =============================================================================
// Calendar Manager
// =============================================================================

export class AppleCalendarManager {
  /**
   * List all calendars available in Apple Calendar.
   */
  listCalendars(): AppleCalendar[] {
    const script = buildCalendarScript(`
      set out to ""
      repeat with c in calendars
        set cName to name of c
        set cDesc to ""
        try
          set cDesc to description of c
        end try
        set cWrite to writable of c
        set out to out & cName & "${FIELD_SEP}" & cDesc & "${FIELD_SEP}" & cWrite & "${RECORD_SEP}"
      end repeat
      return out
    `);

    const result = executeAppleScript(script, { timeoutMs: 30000 });

    if (!result.success || !result.output.trim()) return [];

    const calendars: AppleCalendar[] = [];
    const records = result.output.split(RECORD_SEP);
    for (const rec of records) {
      if (!rec.trim()) continue;
      const fields = rec.split(FIELD_SEP);
      if (fields.length < 3) continue;
      calendars.push({
        name: fields[0].trim(),
        description: fields[1].trim() || undefined,
        writable: fields[2].trim() === "true",
      });
    }
    return calendars;
  }

  /**
   * List events in a date range, optionally filtered by calendar name.
   * Times are in local timezone.
   *
   * @param startDate - Start of range (ISO string or natural language)
   * @param endDate - End of range
   * @param calendarName - Optional calendar name filter
   * @param limit - Max results (default 100)
   */
  listEvents(
    startDate: string,
    endDate: string,
    calendarName?: string,
    limit = 100
  ): CalendarEvent[] {
    const startEsc = escapeForAppleScript(startDate);
    const endEsc = escapeForAppleScript(endDate);

    // Build the script based on whether we're targeting a specific calendar
    let script: string;
    if (calendarName) {
      script = buildCalendarScript(`
        set startDate to date "${startEsc}"
        set endDate to date "${endEsc}"
        set out to ""
        set counter to 0
        tell calendar "${escapeForAppleScript(calendarName)}"
          set matching to (every event whose start date is greater than or equal to startDate and start date is less than or equal to endDate)
          repeat with e in matching
            if counter >= ${limit} then exit repeat
            set eId to uid of e
            set eSummary to summary of e
            set eStart to (start date of e) as string
            set eEnd to (end date of e) as string
            set eAllDay to allday event of e
            set eLoc to ""
            try
              set locVal to location of e
              set locText to locVal as text
              if locText is not "missing value" then set eLoc to locText
            end try
            set out to out & eId & "${FIELD_SEP}" & eSummary & "${FIELD_SEP}" & eStart & "${FIELD_SEP}" & eEnd & "${FIELD_SEP}" & eAllDay & "${FIELD_SEP}" & eLoc & "${FIELD_SEP}" & "${escapeForAppleScript(calendarName)}" & "${RECORD_SEP}"
            set counter to counter + 1
          end repeat
        end tell
        return out
      `);
    } else {
      script = buildCalendarScript(`
        set startDate to date "${startEsc}"
        set endDate to date "${endEsc}"
        set out to ""
        set counter to 0
        repeat with c in calendars
          if counter >= ${limit} then exit repeat
          set cName to name of c
          try
            set matching to (every event of c whose start date is greater than or equal to startDate and start date is less than or equal to endDate)
            repeat with e in matching
              if counter >= ${limit} then exit repeat
              set eId to uid of e
              set eSummary to summary of e
              set eStart to (start date of e) as string
              set eEnd to (end date of e) as string
              set eAllDay to allday event of e
              set eLoc to ""
              try
                set locVal to location of e
                set locText to locVal as text
                if locText is not "missing value" then set eLoc to locText
              end try
              set out to out & eId & "${FIELD_SEP}" & eSummary & "${FIELD_SEP}" & eStart & "${FIELD_SEP}" & eEnd & "${FIELD_SEP}" & eAllDay & "${FIELD_SEP}" & eLoc & "${FIELD_SEP}" & cName & "${RECORD_SEP}"
              set counter to counter + 1
            end repeat
          end try
        end repeat
        return out
      `);
    }

    const result = executeAppleScript(script, { timeoutMs: 120000 });

    if (!result.success || !result.output.trim()) return [];

    const events = this.parseEventList(result.output);
    // Post-filter recurring masters whose start date falls outside the requested range.
    // AppleScript returns the master event's original start date for recurring events,
    // so a weekly meeting that started months ago still matches "this week" queries.
    // Rather than showing it with a misleading date, filter it out.
    return this.filterEventsToRange(events, startDate, endDate);
  }

  /**
   * Search events across all calendars by text match in summary/description/location.
   * Date range filters improve performance significantly.
   */
  searchEvents(query: string, startDate?: string, endDate?: string, limit = 50): CalendarEvent[] {
    // Note: AppleScript's `ignoring case` directive handles case folding
    // natively. No need to lowercase the query in TypeScript - doing so
    // would mix JS's Unicode case rules with AppleScript's.
    const queryEsc = escapeForAppleScript(query);
    const hasDateRange = startDate && endDate;

    const script = buildCalendarScript(`
      set out to ""
      set counter to 0
      ${hasDateRange ? `set startDate to date "${escapeForAppleScript(startDate!)}"` : ""}
      ${hasDateRange ? `set endDate to date "${escapeForAppleScript(endDate!)}"` : ""}
      repeat with c in calendars
        if counter >= ${limit} then exit repeat
        set cName to name of c
        try
          ${
            hasDateRange
              ? `set candidates to (every event of c whose start date is greater than or equal to startDate and start date is less than or equal to endDate)`
              : `set candidates to every event of c`
          }
          repeat with e in candidates
            if counter >= ${limit} then exit repeat
            set eSummary to summary of e
            set eLoc to ""
            try
              set locVal to location of e
              set locText to locVal as text
              if locText is not "missing value" then set eLoc to locText
            end try
            set eDesc to ""
            try
              set descVal to description of e
              set descText to descVal as text
              if descText is not "missing value" then set eDesc to descText
            end try
            set combined to eSummary & " " & eLoc & " " & eDesc
            set matched to false
            ignoring case
              if combined contains "${queryEsc}" then set matched to true
            end ignoring
            if matched then
              set eId to uid of e
              set eStart to (start date of e) as string
              set eEnd to (end date of e) as string
              set eAllDay to allday event of e
              set out to out & eId & "${FIELD_SEP}" & eSummary & "${FIELD_SEP}" & eStart & "${FIELD_SEP}" & eEnd & "${FIELD_SEP}" & eAllDay & "${FIELD_SEP}" & eLoc & "${FIELD_SEP}" & cName & "${RECORD_SEP}"
              set counter to counter + 1
            end if
          end repeat
        end try
      end repeat
      return out
    `);

    const result = executeAppleScript(script, { timeoutMs: 180000 });

    if (!result.success || !result.output.trim()) return [];

    const events = this.parseEventList(result.output);
    // If a date range was provided, filter out recurring masters outside the range
    if (startDate && endDate) {
      return this.filterEventsToRange(events, startDate, endDate);
    }
    return events;
  }

  /**
   * Get full details for a single event by UID.
   * Searches across all calendars.
   */
  getEvent(uid: string): CalendarEventDetail | null {
    const uidEsc = escapeForAppleScript(uid);

    const script = buildCalendarScript(`
      set out to ""
      repeat with c in calendars
        try
          set matches to (every event of c whose uid is "${uidEsc}")
          if (count of matches) > 0 then
            set e to item 1 of matches
            set eSummary to summary of e
            set eStart to (start date of e) as string
            set eEnd to (end date of e) as string
            set eAllDay to allday event of e
            set eLoc to ""
            try
              set locVal to location of e
              set locText to locVal as text
              if locText is not "missing value" then set eLoc to locText
            end try
            set eDesc to ""
            try
              set descVal to description of e
              set descText to descVal as text
              if descText is not "missing value" then set eDesc to descText
            end try
            set eStatus to ""
            try
              set statusVal to status of e
              set statusText to statusVal as text
              if statusText is not "missing value" then set eStatus to statusText
            end try
            set eUrl to ""
            try
              set urlVal to url of e
              set urlText to urlVal as text
              if urlText is not "missing value" then set eUrl to urlText
            end try
            set attOut to ""
            try
              repeat with a in attendees of e
                set aName to ""
                try
                  set nameVal to display name of a
                  set nameText to nameVal as text
                  if nameText is not "missing value" then set aName to nameText
                end try
                if aName is "" then
                  try
                    set emailVal to email of a
                    set emailText to emailVal as text
                    if emailText is not "missing value" then set aName to emailText
                  end try
                end if
                set aStatus to ""
                try
                  set pStatus to participation status of a
                  set pStatusText to pStatus as text
                  if pStatusText is not "missing value" then set aStatus to pStatusText
                end try
                set attOut to attOut & aName & ":" & aStatus & ","
              end repeat
            end try
            set out to "${FIELD_SEP}" & eSummary & "${FIELD_SEP}" & eStart & "${FIELD_SEP}" & eEnd & "${FIELD_SEP}" & eAllDay & "${FIELD_SEP}" & eLoc & "${FIELD_SEP}" & eDesc & "${FIELD_SEP}" & (name of c) & "${FIELD_SEP}" & eStatus & "${FIELD_SEP}" & eUrl & "${FIELD_SEP}" & attOut
            exit repeat
          end if
        end try
      end repeat
      return out
    `);

    const result = executeAppleScript(script, { timeoutMs: 120000 });

    if (!result.success || !result.output.trim()) return null;

    // Output is prefixed with FIELD_SEP so split gives us empty first element
    const fields = result.output.split(FIELD_SEP);
    if (fields.length < 11) return null;

    const attendees: EventAttendee[] = [];
    const attRaw = fields[10] || "";
    for (const pair of attRaw.split(",")) {
      if (!pair.trim()) continue;
      const [name, status] = pair.split(":");
      if (name) {
        attendees.push({
          name: name.trim(),
          status: (status || "unknown").trim(),
        });
      }
    }

    return {
      id: uid,
      summary: stripControlChars(fields[1].trim()),
      startDate: appleDateToIso(fields[2].trim()),
      endDate: appleDateToIso(fields[3].trim()),
      allDay: fields[4].trim() === "true",
      location: stripControlChars(fields[5].trim()) || undefined,
      description: stripControlChars(fields[6].trim()) || undefined,
      calendarName: stripControlChars(fields[7].trim()),
      status: stripControlChars(fields[8].trim()) || undefined,
      url: stripControlChars(fields[9].trim()) || undefined,
      attendees,
    };
  }

  /**
   * Get today's events across all calendars.
   */
  getToday(): CalendarEvent[] {
    const today = new Date();
    const todayStr = this.formatAppleDate(today);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const tomorrowStr = this.formatAppleDate(tomorrow);
    return this.listEvents(todayStr, tomorrowStr);
  }

  /**
   * Get this week's events (Monday through Sunday) across all calendars.
   */
  getThisWeek(): CalendarEvent[] {
    const now = new Date();
    const day = now.getDay(); // 0 = Sunday, 1 = Monday
    const daysFromMonday = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - daysFromMonday);
    monday.setHours(0, 0, 0, 0);
    const nextMonday = new Date(monday);
    nextMonday.setDate(monday.getDate() + 7);
    return this.listEvents(this.formatAppleDate(monday), this.formatAppleDate(nextMonday));
  }

  /**
   * Resolve a calendar by name, verifying it's writable and unambiguous.
   *
   * Exchange's default calendar is often just named "Calendar" - multiple
   * accounts produce duplicate names. AppleScript's `tell calendar "X"`
   * targets the first match by undocumented order, so ambiguous names
   * would silently land events in the wrong account. This check refuses
   * to proceed unless exactly one writable calendar with that name exists.
   *
   * @returns null if not found, not writable, or ambiguous. Call
   *          listCalendars() to discover available names.
   */
  resolveWritableCalendar(name: string): { name: string; writable: boolean } | null {
    const all = this.listCalendars();
    const matches = all.filter((c) => c.name === name);
    if (matches.length === 0) return null;
    if (matches.length > 1) {
      console.error(
        `[audit] Calendar "${name}" is ambiguous: ${matches.length} matches found. ` +
          `Apple Calendar AppleScript cannot disambiguate by account. Refusing write.`
      );
      return null;
    }
    if (!matches[0].writable) {
      console.error(`[audit] Calendar "${name}" is read-only. Refusing write.`);
      return null;
    }
    return matches[0];
  }

  // ===========================================================================
  // Write Operations (v0.2.0+)
  // ===========================================================================

  /**
   * Set the current user's participation status on an event.
   *
   * NOTE: Whether this sends a response email to the organizer depends on
   * the calendar account type. iCloud reliably sends. Exchange and Google
   * CalDAV behavior is inconsistent. Callers should verify via the
   * organizer's view if confirmation matters.
   *
   * @returns "ok" | "event-not-found" | "attendee-not-found" | "error"
   */
  respondToInvitation(
    uid: string,
    status: ParticipationStatus,
    userEmail: string
  ): "ok" | "event-not-found" | "attendee-not-found" | "error" {
    if (isReadOnlyMode()) {
      throw new Error("Server is in read-only mode (APPLE_CALENDAR_MCP_READ_ONLY set)");
    }

    const script = buildRespondScript(uid, userEmail, status);
    const result = executeAppleScript(script, { timeoutMs: 60000 });

    auditLog("respond-to-invitation", {
      uid,
      status,
      userEmail,
      result: result.output,
    });

    if (!result.success) return "error";
    if (result.output === "ok") return "ok";
    if (result.output === "event-not-found") return "event-not-found";
    if (result.output === "attendee-not-found") return "attendee-not-found";
    return "error";
  }

  /**
   * Create a new event in the specified calendar.
   *
   * IMPORTANT: AppleScript cannot provision Teams/Zoom/Meet meeting URLs.
   * For events that need online meeting integration, use the native
   * calendar platform's tool (Outlook, Google Calendar).
   *
   * Calendar must be writable and unambiguous. resolveWritableCalendar is
   * called first; if it returns null, the create is refused.
   *
   * @returns UID of the created event, or null on failure
   */
  createEvent(
    calendarName: string,
    summary: string,
    startDate: string,
    endDate: string,
    options: {
      location?: string;
      description?: string;
      url?: string;
      allDay?: boolean;
    } = {}
  ): string | null {
    if (isReadOnlyMode()) {
      throw new Error("Server is in read-only mode (APPLE_CALENDAR_MCP_READ_ONLY set)");
    }

    const resolved = this.resolveWritableCalendar(calendarName);
    if (!resolved) {
      auditLog("create-event", {
        calendarName,
        summary,
        result: "calendar-not-resolved",
      });
      return null;
    }

    const script = buildCreateEventScript(calendarName, summary, startDate, endDate, options);
    const result = executeAppleScript(script, { timeoutMs: 60000 });

    auditLog("create-event", {
      calendarName,
      summary,
      result: result.success ? result.output : result.error,
    });

    if (!result.success || result.output.startsWith("error:") || !result.output.trim()) {
      return null;
    }
    return result.output.trim();
  }

  /**
   * Update properties on an existing event.
   *
   * Passes only the fields provided. An empty string for a field clears it
   * (rather than "no change") - callers who want to preserve a field should
   * omit it entirely.
   *
   * Searches all calendars for the UID. If the UID matches multiple events
   * (rare but possible with imported ICS), only the first is updated.
   */
  updateEvent(
    uid: string,
    updates: {
      summary?: string;
      startDate?: string;
      endDate?: string;
      location?: string;
      description?: string;
      url?: string;
    },
    calendarName?: string
  ): boolean {
    if (isReadOnlyMode()) {
      throw new Error("Server is in read-only mode (APPLE_CALENDAR_MCP_READ_ONLY set)");
    }

    // If calendarName is provided, resolve and scope the update. Refuses
    // ambiguous or read-only calendars. Same safety posture as deleteEvent.
    // When NOT provided, preserves v0.2.0 backward-compat behavior
    // (cross-calendar UID search).
    if (calendarName !== undefined) {
      const resolved = this.resolveWritableCalendar(calendarName);
      if (!resolved) {
        auditLog("update-event", {
          uid,
          calendarName,
          result: "calendar-not-resolved",
        });
        return false;
      }
    }

    const script = buildUpdateEventScript(uid, updates, calendarName);
    if (script === null) return true; // no-op: nothing to update

    const result = executeAppleScript(script, { timeoutMs: 60000 });

    auditLog("update-event", {
      uid,
      calendarName: calendarName ?? "(cross-calendar)",
      fields: Object.keys(updates)
        .filter((k) => updates[k as keyof typeof updates] !== undefined)
        .join(","),
      result: result.output,
    });

    return result.success && result.output === "ok";
  }

  /**
   * Delete an event. Scoped to a specific calendar for safety.
   *
   * Refuses to delete recurring event masters - those would remove the
   * entire series silently. Callers who really want to delete a series
   * must do it through Calendar.app (which prompts for "this event only"
   * vs "all events").
   *
   * Recoverability depends on the source account:
   * - iCloud: event moves to iCloud Trash, recoverable for ~30 days
   * - Exchange: goes to the account's Deleted Items
   * - Google: trash, recoverable for ~30 days
   * - Local-only calendars: permanently deleted
   */
  deleteEvent(
    calendarName: string,
    uid: string
  ): "ok" | "not-found" | "is-recurring-master" | "error" {
    if (isReadOnlyMode()) {
      throw new Error("Server is in read-only mode (APPLE_CALENDAR_MCP_READ_ONLY set)");
    }

    const resolved = this.resolveWritableCalendar(calendarName);
    if (!resolved) {
      auditLog("delete-event", { calendarName, uid, result: "calendar-not-resolved" });
      return "not-found";
    }

    const script = buildDeleteEventScript(calendarName, uid);
    const result = executeAppleScript(script, { timeoutMs: 60000 });

    auditLog("delete-event", {
      calendarName,
      uid,
      result: result.output.split("|||")[0] || result.error,
    });

    if (!result.success) return "error";
    if (result.output.startsWith("ok")) return "ok";
    if (result.output === "not-found") return "not-found";
    if (result.output === "is-recurring-master") return "is-recurring-master";
    return "error";
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Filter out events whose start date falls outside the requested range.
   *
   * AppleScript returns the master event's original start date for recurring
   * events, so a weekly meeting that started months ago still matches queries
   * for "this week" (because it has an instance this week, but the date we get
   * back is the master date, not the instance date).
   *
   * This filter drops events whose returned start date is outside the range,
   * which cleanly hides recurring masters-in-the-past at the cost of also
   * hiding their current-week instances. The tradeoff favors clarity over
   * completeness for now.
   *
   * A future enhancement could expand recurrence rules to compute instance
   * dates, but that requires parsing RRULE and handling exceptions - significant
   * work for a non-critical feature.
   *
   * @param events - Events from parseEventList
   * @param startDate - Start of the range (same format as listEvents input)
   * @param endDate - End of the range
   * @returns Events whose start date falls within [startDate, endDate]
   */
  private filterEventsToRange(
    events: CalendarEvent[],
    startDate: string,
    endDate: string
  ): CalendarEvent[] {
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();

    // If either date is invalid, skip filtering and return all events
    if (isNaN(startMs) || isNaN(endMs)) return events;

    return events.filter((e) => {
      const eventMs = new Date(e.startDate).getTime();
      if (isNaN(eventMs)) return true; // keep events with unparseable dates
      return eventMs >= startMs && eventMs <= endMs;
    });
  }

  /**
   * Format a JS Date as an AppleScript-friendly date string.
   * Example: "April 20, 2026 12:00:00 AM"
   */
  private formatAppleDate(d: Date): string {
    const months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    const month = months[d.getMonth()];
    const day = d.getDate();
    const year = d.getFullYear();
    let hour = d.getHours();
    const min = d.getMinutes().toString().padStart(2, "0");
    const sec = d.getSeconds().toString().padStart(2, "0");
    const ampm = hour >= 12 ? "PM" : "AM";
    hour = hour % 12;
    if (hour === 0) hour = 12;
    return `${month} ${day}, ${year} ${hour}:${min}:${sec} ${ampm}`;
  }

  /**
   * Parse FIELD_SEP/RECORD_SEP delimited event output into CalendarEvent[].
   * Delegates to the free function for testability.
   */
  private parseEventList(raw: string): CalendarEvent[] {
    return parseEventListImpl(raw);
  }
}

/**
 * Strip ASCII control characters from a string. Used on output fields to
 * defend against stored data that contains the field/record delimiters
 * (e.g., from an imported ICS file or another tool's write).
 */
function stripControlChars(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

// =============================================================================
// Write Operation Script Builders (v0.2.0+)
//
// Script generation is extracted as pure functions so snapshot tests can
// assert on the generated AppleScript without running osascript.
// =============================================================================

/**
 * Map ParticipationStatus enum -> AppleScript participation status constant.
 * Defined as a lookup table (not direct interpolation) so adding a new
 * enum value is a compile error until the mapping is updated.
 */
const PARTICIPATION_STATUS_APPLESCRIPT: Record<ParticipationStatus, string> = {
  accepted: "accepted",
  declined: "declined",
  tentative: "tentative",
  "needs-action": "needs action", // AppleScript uses space
};

/**
 * Build the AppleScript for respond-to-invitation.
 * Extracted for snapshot testing.
 */
function buildRespondScript(uid: string, userEmail: string, status: ParticipationStatus): string {
  const uidEsc = escapeForAppleScript(uid);
  const emailEsc = escapeForAppleScript(userEmail);
  const asStatus = PARTICIPATION_STATUS_APPLESCRIPT[status];

  return buildCalendarScript(`
    try
      repeat with c in calendars
        try
          set matches to (every event of c whose uid is "${uidEsc}")
          if (count of matches) > 0 then
            set e to item 1 of matches
            repeat with a in attendees of e
              try
                set aEmail to email of a
                if aEmail is "${emailEsc}" then
                  set participation status of a to ${asStatus}
                  return "ok"
                end if
              end try
            end repeat
            return "attendee-not-found"
          end if
        end try
      end repeat
      return "event-not-found"
    on error errMsg
      return "error:" & errMsg
    end try
  `);
}

/** Build create-event script.
 *
 * Since v0.2.2: uses buildAppleScriptDateBlock to construct start/end dates
 * from parsed components rather than feeding raw strings to AppleScript's
 * `date "..."` coercion. This fixes silent time-truncation for 24-hour and
 * ISO-format inputs (see CHANGELOG for v0.2.2). */
function buildCreateEventScript(
  calendarName: string,
  summary: string,
  startDate: string,
  endDate: string,
  options: {
    location?: string;
    description?: string;
    url?: string;
    allDay?: boolean;
  } = {}
): string {
  const calEsc = escapeForAppleScript(calendarName);
  const summaryEsc = escapeForAppleScript(summary);
  const allDay = options.allDay ? "true" : "false";

  const startComp = parseUserDateInput(startDate);
  const endComp = parseUserDateInput(endDate);
  const forceMidnight = options.allDay === true;
  const startBlock = buildAppleScriptDateBlock(startComp, "startDateObj", { forceMidnight });
  const endBlock = buildAppleScriptDateBlock(endComp, "endDateObj", { forceMidnight });

  const props: string[] = [
    `summary:"${summaryEsc}"`,
    `start date:startDateObj`,
    `end date:endDateObj`,
    `allday event:${allDay}`,
  ];
  if (options.location !== undefined) {
    props.push(`location:"${escapeForAppleScript(options.location)}"`);
  }
  if (options.description !== undefined) {
    const descExpr = buildMultilineAppleScript(options.description, escapeForAppleScript);
    props.push(`description:${descExpr}`);
  }
  if (options.url !== undefined) {
    props.push(`url:"${escapeForAppleScript(options.url)}"`);
  }

  return buildCalendarScript(`
    ${startBlock}
    ${endBlock}
    try
      tell calendar "${calEsc}"
        set newEvent to make new event with properties {${props.join(", ")}}
        return uid of newEvent
      end tell
    on error errMsg
      return "error:" & errMsg
    end try
  `);
}

/** Build update-event script. Returns null if no updates provided.
 *  When `calendarName` is provided, scopes the event lookup to that
 *  specific calendar (safer against cross-calendar prompt injection).
 *  When undefined, searches across all calendars (v0.2.0 behavior).
 *
 *  Since v0.2.2: date updates use buildAppleScriptDateBlock pre-script
 *  blocks instead of `date "..."` literals, avoiding the locale-dependent
 *  silent time-truncation bug. Date blocks are only emitted when the
 *  corresponding field is being updated. */
function buildUpdateEventScript(
  uid: string,
  updates: {
    summary?: string;
    startDate?: string;
    endDate?: string;
    location?: string;
    description?: string;
    url?: string;
  },
  calendarName?: string
): string | null {
  const uidEsc = escapeForAppleScript(uid);
  const setters: string[] = [];
  const preBlocks: string[] = [];

  if (updates.summary !== undefined) {
    setters.push(`set summary of e to "${escapeForAppleScript(updates.summary)}"`);
  }
  if (updates.startDate !== undefined) {
    const comp = parseUserDateInput(updates.startDate);
    preBlocks.push(buildAppleScriptDateBlock(comp, "startDateObj"));
    setters.push(`set start date of e to startDateObj`);
  }
  if (updates.endDate !== undefined) {
    const comp = parseUserDateInput(updates.endDate);
    preBlocks.push(buildAppleScriptDateBlock(comp, "endDateObj"));
    setters.push(`set end date of e to endDateObj`);
  }
  if (updates.location !== undefined) {
    setters.push(`set location of e to "${escapeForAppleScript(updates.location)}"`);
  }
  if (updates.description !== undefined) {
    const descExpr = buildMultilineAppleScript(updates.description, escapeForAppleScript);
    setters.push(`set description of e to ${descExpr}`);
  }
  if (updates.url !== undefined) {
    setters.push(`set url of e to "${escapeForAppleScript(updates.url)}"`);
  }

  if (setters.length === 0) return null;

  const pre = preBlocks.join("\n");

  // Scoped variant: wrap in tell calendar block
  if (calendarName !== undefined) {
    const calEsc = escapeForAppleScript(calendarName);
    return buildCalendarScript(`
    ${pre}
    try
      tell calendar "${calEsc}"
        set matches to (every event whose uid is "${uidEsc}")
        if (count of matches) > 0 then
          set e to item 1 of matches
          ${setters.join("\n          ")}
          return "ok"
        end if
        return "event-not-found"
      end tell
    on error errMsg
      return "error:" & errMsg
    end try
  `);
  }

  // Unscoped variant: cross-calendar UID search (backward compatible)
  return buildCalendarScript(`
    ${pre}
    try
      repeat with c in calendars
        try
          set matches to (every event of c whose uid is "${uidEsc}")
          if (count of matches) > 0 then
            set e to item 1 of matches
            ${setters.join("\n            ")}
            return "ok"
          end if
        end try
      end repeat
      return "event-not-found"
    on error errMsg
      return "error:" & errMsg
    end try
  `);
}

/** Build delete-event script. */
function buildDeleteEventScript(calendarName: string, uid: string): string {
  const calEsc = escapeForAppleScript(calendarName);
  const uidEsc = escapeForAppleScript(uid);

  return buildCalendarScript(`
    try
      tell calendar "${calEsc}"
        set matches to (every event whose uid is "${uidEsc}")
        if (count of matches) = 0 then return "not-found"
        set e to item 1 of matches
        -- Reject recurring masters: presence of recurrence indicates series
        try
          set r to recurrence of e
          if r is not missing value and r is not "" then return "is-recurring-master"
        end try
        set eSummary to summary of e
        set eStart to (start date of e) as string
        delete e
        return "ok|||" & eSummary & "|||" & eStart
      end tell
    on error errMsg
      return "error:" & errMsg
    end try
  `);
}

/**
 * Free-function implementation of parseEventList for unit testing.
 * Kept outside the class because it has no instance state.
 */
function parseEventListImpl(raw: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const records = raw.split(RECORD_SEP);
  for (const rec of records) {
    if (!rec.trim()) continue;
    const fields = rec.split(FIELD_SEP);
    if (fields.length < 7) continue;
    events.push({
      id: stripControlChars(fields[0].trim()),
      summary: stripControlChars(fields[1].trim()),
      startDate: appleDateToIso(fields[2].trim()),
      endDate: appleDateToIso(fields[3].trim()),
      allDay: fields[4].trim() === "true",
      location: stripControlChars(fields[5].trim()) || undefined,
      calendarName: stripControlChars(fields[6].trim()),
    });
  }
  return events;
}

/**
 * Exported for unit testing only - not part of the public API.
 */
export const _testing = {
  escapeForAppleScript,
  FIELD_SEP,
  RECORD_SEP,
  parseEventList: parseEventListImpl,
  stripControlChars,
  buildRespondScript,
  buildCreateEventScript,
  buildUpdateEventScript,
  buildDeleteEventScript,
  PARTICIPATION_STATUS_APPLESCRIPT,
};
