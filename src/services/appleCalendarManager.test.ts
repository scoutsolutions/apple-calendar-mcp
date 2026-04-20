import { describe, it, expect } from "vitest";
import { _testing } from "./appleCalendarManager.js";
import { buildMultilineAppleScript, checkThrottle } from "@/utils/writeHelpers.js";

describe("escapeForAppleScript", () => {
  it("escapes backslashes", () => {
    expect(_testing.escapeForAppleScript("a\\b")).toBe("a\\\\b");
  });

  it("escapes double quotes", () => {
    expect(_testing.escapeForAppleScript('a"b')).toBe('a\\"b');
  });

  it("passes through normal text unchanged", () => {
    expect(_testing.escapeForAppleScript("April 20, 2026 9:00 AM")).toBe("April 20, 2026 9:00 AM");
  });

  it("returns empty string for empty input", () => {
    expect(_testing.escapeForAppleScript("")).toBe("");
  });

  it("rejects newline injection", () => {
    expect(() => _testing.escapeForAppleScript('a"\ndo shell script "x"')).toThrow(
      /control character/i
    );
  });

  it("rejects carriage return", () => {
    expect(() => _testing.escapeForAppleScript("a\rb")).toThrow(/control character/i);
  });

  it("rejects null byte", () => {
    expect(() => _testing.escapeForAppleScript("a\x00b")).toThrow(/control character/i);
  });

  it("rejects tab", () => {
    expect(() => _testing.escapeForAppleScript("a\tb")).toThrow(/control character/i);
  });

  it("allows high-unicode content", () => {
    expect(_testing.escapeForAppleScript("café 🎉")).toBe("café 🎉");
  });

  it("rejects ASCII Unit Separator (our field delimiter)", () => {
    // Delimiter injection: if a caller could embed \x1F in a value,
    // they could corrupt the wire format. The general control-char
    // rejection catches this automatically; explicit test documents
    // the delimiter-safety guarantee.
    expect(() => _testing.escapeForAppleScript("evil\x1Fname")).toThrow(/control character/i);
  });

  it("rejects ASCII Record Separator (our record delimiter)", () => {
    expect(() => _testing.escapeForAppleScript("evil\x1Ename")).toThrow(/control character/i);
  });
});

describe("delimiter constants", () => {
  it("uses ASCII Unit Separator for FIELD_SEP", () => {
    expect(_testing.FIELD_SEP).toBe("\x1F");
  });

  it("uses ASCII Record Separator for RECORD_SEP", () => {
    expect(_testing.RECORD_SEP).toBe("\x1E");
  });
});

describe("parseEventList", () => {
  const FS = _testing.FIELD_SEP;
  const RS = _testing.RECORD_SEP;

  it("parses a single event correctly", () => {
    const raw = `event-1${FS}Meeting A${FS}2026-04-20 09:00:00${FS}2026-04-20 10:00:00${FS}false${FS}Zoom${FS}Calendar${RS}`;
    const events = _testing.parseEventList(raw);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("event-1");
    expect(events[0].summary).toBe("Meeting A");
    expect(events[0].location).toBe("Zoom");
    expect(events[0].allDay).toBe(false);
    expect(events[0].calendarName).toBe("Calendar");
  });

  it("parses multiple events with mixed all-day flags and empty locations", () => {
    const raw =
      `event-1${FS}Meeting A${FS}2026-04-20 09:00:00${FS}2026-04-20 10:00:00${FS}false${FS}Zoom${FS}Calendar${RS}` +
      `event-2${FS}Meeting B${FS}2026-04-21 14:00:00${FS}2026-04-21 15:00:00${FS}true${FS}${FS}Work${RS}`;
    const events = _testing.parseEventList(raw);
    expect(events).toHaveLength(2);
    expect(events[1].id).toBe("event-2");
    expect(events[1].allDay).toBe(true);
    expect(events[1].location).toBeUndefined();
    expect(events[1].calendarName).toBe("Work");
  });

  it("returns empty array for empty input", () => {
    expect(_testing.parseEventList("")).toHaveLength(0);
  });

  it("skips malformed records with fewer than 7 fields", () => {
    const raw =
      `event-1${FS}Meeting A${FS}2026-04-20 09:00:00${FS}2026-04-20 10:00:00${FS}false${FS}Zoom${FS}Calendar${RS}` +
      `incomplete${FS}record${RS}`;
    const events = _testing.parseEventList(raw);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("event-1");
  });

  it("strips stray control characters from output fields", () => {
    // Simulates stored data that contains our delimiter or other control chars.
    // The parser must not propagate those to consumers.
    const raw = `event-\x011${FS}Meet\x02ing${FS}2026-04-20 09:00:00${FS}2026-04-20 10:00:00${FS}false${FS}Z\x03oom${FS}Cal\x04endar${RS}`;
    const events = _testing.parseEventList(raw);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("event-1");
    expect(events[0].summary).toBe("Meeting");
    expect(events[0].location).toBe("Zoom");
    expect(events[0].calendarName).toBe("Calendar");
  });
});

describe("buildMultilineAppleScript", () => {
  const esc = _testing.escapeForAppleScript;

  it("single line stays as a single quoted string", () => {
    expect(buildMultilineAppleScript("hello", esc)).toBe('"hello"');
  });

  it("multi-line joins with linefeed", () => {
    expect(buildMultilineAppleScript("line 1\nline 2", esc)).toBe('"line 1" & linefeed & "line 2"');
  });

  it("CRLF normalized to LF", () => {
    expect(buildMultilineAppleScript("a\r\nb", esc)).toBe('"a" & linefeed & "b"');
  });

  it("lone CR normalized to LF", () => {
    expect(buildMultilineAppleScript("a\rb", esc)).toBe('"a" & linefeed & "b"');
  });

  it("empty lines preserved", () => {
    expect(buildMultilineAppleScript("a\n\nb", esc)).toBe('"a" & linefeed & "" & linefeed & "b"');
  });

  it("rejects >500 lines", () => {
    const pathological = Array(501).fill("x").join("\n");
    expect(() => buildMultilineAppleScript(pathological, esc)).toThrow(/500 lines/);
  });

  it("escapes quotes within a line", () => {
    expect(buildMultilineAppleScript('say "hi"', esc)).toBe('"say \\"hi\\""');
  });

  it("propagates escape errors for control chars other than newline", () => {
    // Tab is a control char; escape rejects it
    expect(() => buildMultilineAppleScript("has\ttab", esc)).toThrow(/control character/i);
  });
});

describe("checkThrottle", () => {
  it("allows operations under the limit", () => {
    expect(() => {
      for (let i = 0; i < 5; i++) checkThrottle("test-under", 10);
    }).not.toThrow();
  });

  it("throws when limit exceeded", () => {
    for (let i = 0; i < 3; i++) checkThrottle("test-over", 3);
    expect(() => checkThrottle("test-over", 3)).toThrow(/Rate limit/);
  });
});

describe("buildRespondScript", () => {
  it("maps accepted to AppleScript 'accepted' constant", () => {
    const script = _testing.buildRespondScript("event-123", "me@example.com", "accepted");
    expect(script).toContain('tell application "Calendar"');
    expect(script).toContain("set participation status of a to accepted");
    expect(script).toContain('uid is "event-123"');
    expect(script).toContain('aEmail is "me@example.com"');
  });

  it("maps needs-action to AppleScript 'needs action' (with space)", () => {
    const script = _testing.buildRespondScript("e1", "u@x.com", "needs-action");
    expect(script).toContain("set participation status of a to needs action");
  });

  it("escapes quotes in uid and email", () => {
    const script = _testing.buildRespondScript("uid-with-quote", "weird@x.com", "declined");
    expect(script).toContain('uid is "uid-with-quote"');
    expect(script).toContain('aEmail is "weird@x.com"');
  });

  it("lookup table maps all four status values correctly", () => {
    expect(_testing.PARTICIPATION_STATUS_APPLESCRIPT).toEqual({
      accepted: "accepted",
      declined: "declined",
      tentative: "tentative",
      "needs-action": "needs action",
    });
  });
});

describe("buildCreateEventScript", () => {
  it("minimal event: summary + dates only", () => {
    const script = _testing.buildCreateEventScript(
      "Work",
      "Lunch",
      "April 22, 2026 12:00 PM",
      "April 22, 2026 1:00 PM"
    );
    expect(script).toContain('tell calendar "Work"');
    expect(script).toContain('summary:"Lunch"');
    expect(script).toContain('start date:date "April 22, 2026 12:00 PM"');
    expect(script).toContain('end date:date "April 22, 2026 1:00 PM"');
    expect(script).toContain("allday event:false");
    expect(script).not.toContain("location:");
    expect(script).not.toContain("description:");
    expect(script).not.toContain("url:");
  });

  it("event with all optional fields", () => {
    const script = _testing.buildCreateEventScript(
      "Work",
      "Meet",
      "April 22, 2026 9:00 AM",
      "April 22, 2026 10:00 AM",
      {
        location: "Conf Room A",
        description: "single line",
        url: "https://example.com/meet",
        allDay: false,
      }
    );
    expect(script).toContain('location:"Conf Room A"');
    expect(script).toContain('description:"single line"');
    expect(script).toContain('url:"https://example.com/meet"');
  });

  it("multi-line description uses linefeed concatenation", () => {
    const script = _testing.buildCreateEventScript(
      "Work",
      "Meet",
      "April 22, 2026 9:00 AM",
      "April 22, 2026 10:00 AM",
      { description: "line 1\nline 2\nline 3" }
    );
    expect(script).toContain('description:"line 1" & linefeed & "line 2" & linefeed & "line 3"');
  });

  it("CRLF description normalized to linefeed", () => {
    const script = _testing.buildCreateEventScript(
      "Work",
      "Meet",
      "April 22, 2026 9:00 AM",
      "April 22, 2026 10:00 AM",
      { description: "a\r\nb" }
    );
    expect(script).toContain('description:"a" & linefeed & "b"');
  });

  it("all-day event sets allday event:true", () => {
    const script = _testing.buildCreateEventScript(
      "Work",
      "Holiday",
      "April 22, 2026",
      "April 22, 2026",
      { allDay: true }
    );
    expect(script).toContain("allday event:true");
  });

  it("escapes quotes in summary", () => {
    const script = _testing.buildCreateEventScript(
      "Work",
      'say "hi"',
      "April 22, 2026 9:00 AM",
      "April 22, 2026 10:00 AM"
    );
    expect(script).toContain('summary:"say \\"hi\\""');
  });
});

describe("buildUpdateEventScript", () => {
  it("returns null when no updates provided", () => {
    expect(_testing.buildUpdateEventScript("uid-1", {})).toBeNull();
  });

  it("builds summary-only update", () => {
    const script = _testing.buildUpdateEventScript("uid-1", { summary: "New title" })!;
    expect(script).toContain('uid is "uid-1"');
    expect(script).toContain('set summary of e to "New title"');
    expect(script).not.toContain("set start date");
    expect(script).not.toContain("set end date");
    expect(script).not.toContain("set location");
  });

  it("builds reschedule update (both dates)", () => {
    const script = _testing.buildUpdateEventScript("uid-1", {
      startDate: "April 25, 2026 10:00 AM",
      endDate: "April 25, 2026 11:00 AM",
    })!;
    expect(script).toContain('set start date of e to date "April 25, 2026 10:00 AM"');
    expect(script).toContain('set end date of e to date "April 25, 2026 11:00 AM"');
  });

  it("clears location when empty string passed", () => {
    const script = _testing.buildUpdateEventScript("uid-1", { location: "" })!;
    expect(script).toContain('set location of e to ""');
  });

  it("multi-line description update uses linefeed", () => {
    const script = _testing.buildUpdateEventScript("uid-1", { description: "a\nb" })!;
    expect(script).toContain('set description of e to "a" & linefeed & "b"');
  });

  it("url update", () => {
    const script = _testing.buildUpdateEventScript("uid-1", {
      url: "https://example.com/new",
    })!;
    expect(script).toContain('set url of e to "https://example.com/new"');
  });

  it("combines all fields when all provided", () => {
    const script = _testing.buildUpdateEventScript("uid-1", {
      summary: "S",
      startDate: "April 25, 2026 10:00 AM",
      endDate: "April 25, 2026 11:00 AM",
      location: "L",
      description: "D",
      url: "https://x.test",
    })!;
    expect(script).toContain("set summary of e");
    expect(script).toContain("set start date of e");
    expect(script).toContain("set end date of e");
    expect(script).toContain("set location of e");
    expect(script).toContain("set description of e");
    expect(script).toContain("set url of e");
  });
});

describe("buildDeleteEventScript", () => {
  it("scopes to the specified calendar", () => {
    const script = _testing.buildDeleteEventScript("Work", "uid-1");
    expect(script).toContain('tell calendar "Work"');
    expect(script).toContain('uid is "uid-1"');
    expect(script).toContain("delete e");
  });

  it("refuses recurring masters", () => {
    const script = _testing.buildDeleteEventScript("Work", "uid-1");
    expect(script).toContain("set r to recurrence of e");
    expect(script).toContain('return "is-recurring-master"');
  });

  it("returns delimited summary+start on success for context", () => {
    const script = _testing.buildDeleteEventScript("Work", "uid-1");
    expect(script).toContain('return "ok|||" & eSummary & "|||" & eStart');
  });

  it("distinct outcomes for not-found and recurring", () => {
    const script = _testing.buildDeleteEventScript("Work", "uid-1");
    expect(script).toContain('return "not-found"');
    expect(script).toContain('return "is-recurring-master"');
  });
});
