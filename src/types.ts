/**
 * Type Definitions for Apple Calendar MCP Server
 *
 * @module types
 */

// =============================================================================
// AppleScript Execution
// =============================================================================

export interface AppleScriptOptions {
  /** Maximum execution time in milliseconds */
  timeoutMs?: number;
  /** Maximum number of retry attempts */
  maxRetries?: number;
  /** Initial delay between retries in milliseconds */
  retryDelayMs?: number;
}

export interface AppleScriptResult {
  /** Whether the script executed successfully */
  success: boolean;
  /** Output from the script (stdout) */
  output: string;
  /** Error message if execution failed */
  error?: string;
}

// =============================================================================
// Calendar Data Models
// =============================================================================

/**
 * Represents a calendar in Apple Calendar.
 */
export interface AppleCalendar {
  /** Calendar name (may collide across accounts - e.g. Exchange defaults to "Calendar") */
  name: string;
  /** Calendar description (often the account email for external accounts) */
  description?: string;
  /** Whether events can be created/modified in this calendar */
  writable: boolean;
}

/**
 * Represents a calendar event in Apple Calendar.
 */
export interface CalendarEvent {
  /** Event UID - stable identifier across syncs */
  id: string;
  /** Event title */
  summary: string;
  /** Event location */
  location?: string;
  /** Event description/notes */
  description?: string;
  /** Start time in ISO format */
  startDate: string;
  /** End time in ISO format */
  endDate: string;
  /** Whether the event is all-day */
  allDay: boolean;
  /** Calendar name this event belongs to */
  calendarName: string;
  /** Event URL (often contains Teams/Zoom meeting links) */
  url?: string;
}

/**
 * Full event details including attendees.
 */
export interface CalendarEventDetail extends CalendarEvent {
  /** Attendees with names and status */
  attendees: EventAttendee[];
  /** Event status (confirmed, tentative, cancelled) */
  status?: string;
}

/**
 * An attendee on a calendar event.
 */
export interface EventAttendee {
  /** Attendee display name or email */
  name: string;
  /** Response status (accepted, declined, needs-action, etc.) */
  status: string;
}
