import { describe, it, expect } from "vitest";
import { _testing } from "./appleCalendarManager.js";

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
});
