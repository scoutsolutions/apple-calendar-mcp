import { describe, it, expect } from "vitest";
import { parseUserDateInput } from "./dateInput.js";

describe("parseUserDateInput", () => {
  describe("YYYY-MM-DD date-only", () => {
    it("returns local components without UTC drift", () => {
      const result = parseUserDateInput("2026-04-21");
      expect(result).toEqual({
        year: 2026,
        month: 4,
        day: 21,
        hour: 0,
        minute: 0,
        second: 0,
        dateOnly: true,
      });
    });

    it("does NOT shift to previous day in US timezones (the UTC landmine)", () => {
      // This is the critical regression test. new Date("2026-04-21") would
      // produce UTC midnight, which getDate() reports as April 20 in
      // US timezones. The parser must NOT go through new Date() for this.
      const result = parseUserDateInput("2026-04-21");
      expect(result.day).toBe(21);
      expect(result.month).toBe(4);
    });

    it("handles year-start", () => {
      expect(parseUserDateInput("2026-01-01")).toMatchObject({
        year: 2026,
        month: 1,
        day: 1,
        dateOnly: true,
      });
    });
  });

  describe("YYYY-MM-DD local datetime", () => {
    it("parses space separator", () => {
      expect(parseUserDateInput("2026-04-21 15:00:00")).toEqual({
        year: 2026,
        month: 4,
        day: 21,
        hour: 15,
        minute: 0,
        second: 0,
        dateOnly: false,
      });
    });

    it("parses T separator", () => {
      expect(parseUserDateInput("2026-04-21T15:00:00")).toEqual({
        year: 2026,
        month: 4,
        day: 21,
        hour: 15,
        minute: 0,
        second: 0,
        dateOnly: false,
      });
    });

    it("accepts HH:mm without seconds", () => {
      expect(parseUserDateInput("2026-04-21T15:30")).toEqual({
        year: 2026,
        month: 4,
        day: 21,
        hour: 15,
        minute: 30,
        second: 0,
        dateOnly: false,
      });
    });

    it("preserves 24-hour wall-clock time through the parse", () => {
      // The original bug: 24-hour time getting lost. Verify components survive.
      const result = parseUserDateInput("2026-04-21 23:59:59");
      expect(result.hour).toBe(23);
      expect(result.minute).toBe(59);
      expect(result.second).toBe(59);
    });
  });

  describe("natural language", () => {
    it("parses 24-hour month-name datetime as local", () => {
      const result = parseUserDateInput("April 21, 2026 15:00:00");
      expect(result.hour).toBe(15);
      expect(result.day).toBe(21);
    });

    it("parses 12-hour PM as local", () => {
      const result = parseUserDateInput("April 21, 2026 3:00 PM");
      expect(result.hour).toBe(15);
    });

    it("parses US slash date", () => {
      const result = parseUserDateInput("4/21/2026");
      expect(result).toMatchObject({
        year: 2026,
        month: 4,
        day: 21,
      });
    });
  });

  describe("rejection", () => {
    it("rejects trailing Z", () => {
      expect(() => parseUserDateInput("2026-04-21T15:00:00Z")).toThrow(/Timezone-qualified/);
    });

    it("rejects positive offset", () => {
      expect(() => parseUserDateInput("2026-04-21T15:00:00+05:00")).toThrow(/Timezone-qualified/);
    });

    it("rejects negative offset", () => {
      expect(() => parseUserDateInput("2026-04-21T15:00:00-04:00")).toThrow(/Timezone-qualified/);
    });

    it("rejects compact offset without colon", () => {
      expect(() => parseUserDateInput("2026-04-21T15:00:00-0400")).toThrow(/Timezone-qualified/);
    });

    it("rejects unparseable garbage", () => {
      expect(() => parseUserDateInput("not a date")).toThrow(/Unparseable/);
    });

    it("rejects empty string", () => {
      expect(() => parseUserDateInput("")).toThrow();
    });
  });

  describe("boundary cases", () => {
    it("preserves exact components on year-end datetime", () => {
      expect(parseUserDateInput("2026-12-31 23:59:59")).toEqual({
        year: 2026,
        month: 12,
        day: 31,
        hour: 23,
        minute: 59,
        second: 59,
        dateOnly: false,
      });
    });

    it("handles leap day", () => {
      expect(parseUserDateInput("2024-02-29")).toMatchObject({
        year: 2024,
        month: 2,
        day: 29,
        dateOnly: true,
      });
    });
  });
});
