import { describe, it, expect } from "vitest";
import {
  URL_SCHEMA,
  EMAIL_SCHEMA,
  STRICT_DATE_SCHEMA,
  REQUIRED_DATE_SCHEMA,
  EVENT_UID_SCHEMA,
  CALENDAR_NAME_SCHEMA,
  SEARCH_QUERY_SCHEMA,
  EVENT_LIMIT_SCHEMA,
  EVENT_SUMMARY_SCHEMA,
  EVENT_LOCATION_SCHEMA,
  EVENT_DESCRIPTION_SCHEMA,
  PARTICIPATION_STATUS_SCHEMA,
} from "./schemas.js";

describe("URL_SCHEMA", () => {
  it("accepts https URLs", () => {
    expect(URL_SCHEMA.safeParse("https://example.com").success).toBe(true);
    expect(URL_SCHEMA.safeParse("https://teams.microsoft.com/l/meetup-join/abc").success).toBe(
      true
    );
    expect(URL_SCHEMA.safeParse("https://zoom.us/j/123456789").success).toBe(true);
  });

  it("accepts http URLs", () => {
    expect(URL_SCHEMA.safeParse("http://localhost:3000").success).toBe(true);
    expect(URL_SCHEMA.safeParse("http://example.com/path?q=1").success).toBe(true);
  });

  it("rejects javascript: scheme (XSS vector)", () => {
    const r = URL_SCHEMA.safeParse("javascript:alert(1)");
    expect(r.success).toBe(false);
  });

  it("rejects data: scheme (XSS vector)", () => {
    const r = URL_SCHEMA.safeParse("data:text/html,<script>alert(1)</script>");
    expect(r.success).toBe(false);
  });

  it("rejects file: scheme (local file exfiltration)", () => {
    const r = URL_SCHEMA.safeParse("file:///etc/passwd");
    expect(r.success).toBe(false);
  });

  it("rejects mailto: (not applicable for event URL field)", () => {
    expect(URL_SCHEMA.safeParse("mailto:user@example.com").success).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(URL_SCHEMA.safeParse("not a url").success).toBe(false);
    expect(URL_SCHEMA.safeParse("").success).toBe(false);
  });

  it("rejects URLs longer than 2000 chars", () => {
    const longUrl = "https://example.com/" + "a".repeat(2100);
    expect(URL_SCHEMA.safeParse(longUrl).success).toBe(false);
  });
});

describe("EMAIL_SCHEMA", () => {
  it("accepts valid email addresses", () => {
    expect(EMAIL_SCHEMA.safeParse("user@example.com").success).toBe(true);
    expect(EMAIL_SCHEMA.safeParse("kevin.may@scoutsolutions.com").success).toBe(true);
    expect(EMAIL_SCHEMA.safeParse("x@y.z").success).toBe(true);
  });

  it("rejects multiple @ signs", () => {
    expect(EMAIL_SCHEMA.safeParse("a@b@c").success).toBe(false);
    expect(EMAIL_SCHEMA.safeParse("user@host@domain.com").success).toBe(false);
  });

  it("rejects missing @", () => {
    expect(EMAIL_SCHEMA.safeParse("no-at-sign").success).toBe(false);
    expect(EMAIL_SCHEMA.safeParse("user.example.com").success).toBe(false);
  });

  it("rejects whitespace in the local part", () => {
    expect(EMAIL_SCHEMA.safeParse("has spaces@example.com").success).toBe(false);
  });

  it("rejects control characters", () => {
    expect(EMAIL_SCHEMA.safeParse("user\n@example.com").success).toBe(false);
    expect(EMAIL_SCHEMA.safeParse("user\x00@example.com").success).toBe(false);
  });

  it("rejects backslash and double-quote (AppleScript injection)", () => {
    expect(EMAIL_SCHEMA.safeParse('user"@example.com').success).toBe(false);
    expect(EMAIL_SCHEMA.safeParse("user\\@example.com").success).toBe(false);
  });

  it("rejects too-short inputs", () => {
    expect(EMAIL_SCHEMA.safeParse("").success).toBe(false);
    expect(EMAIL_SCHEMA.safeParse("a@").success).toBe(false);
  });
});

describe("STRICT_DATE_SCHEMA", () => {
  it("accepts valid natural-language dates", () => {
    expect(STRICT_DATE_SCHEMA.safeParse("April 20, 2026").success).toBe(true);
    expect(STRICT_DATE_SCHEMA.safeParse("April 20 2026 9:00 AM").success).toBe(true);
    expect(STRICT_DATE_SCHEMA.safeParse("Feb 1, 2026").success).toBe(true);
  });

  it("accepts ISO-like dates", () => {
    expect(STRICT_DATE_SCHEMA.safeParse("2026-04-20").success).toBe(true);
    expect(STRICT_DATE_SCHEMA.safeParse("2026-04-20 09:00:00").success).toBe(true);
  });

  it("accepts US slash dates", () => {
    expect(STRICT_DATE_SCHEMA.safeParse("4/20/2026").success).toBe(true);
    expect(STRICT_DATE_SCHEMA.safeParse("04/20/2026").success).toBe(true);
  });

  it("REJECTS rolled-over month-name dates (Feb 30)", () => {
    // JS silently rolls Feb 30 2026 -> Mar 2 2026. We reject.
    const r = STRICT_DATE_SCHEMA.safeParse("Feb 30 2026");
    expect(r.success).toBe(false);
  });

  it("REJECTS rolled-over long-month-name dates (September 31)", () => {
    const r = STRICT_DATE_SCHEMA.safeParse("September 31, 2026");
    expect(r.success).toBe(false);
  });

  it("REJECTS rolled-over ISO dates (2026-02-30)", () => {
    const r = STRICT_DATE_SCHEMA.safeParse("2026-02-30");
    expect(r.success).toBe(false);
  });

  it("REJECTS rolled-over US slash dates (2/30/2026)", () => {
    const r = STRICT_DATE_SCHEMA.safeParse("2/30/2026");
    expect(r.success).toBe(false);
  });

  it("rejects dates far in the past (>50 years)", () => {
    expect(STRICT_DATE_SCHEMA.safeParse("January 1, 1900").success).toBe(false);
  });

  it("rejects dates far in the future (>50 years)", () => {
    const farFuture = `January 1, ${new Date().getFullYear() + 100}`;
    expect(STRICT_DATE_SCHEMA.safeParse(farFuture).success).toBe(false);
  });

  it("rejects obviously malformed input", () => {
    expect(STRICT_DATE_SCHEMA.safeParse("not a date").success).toBe(false);
    expect(STRICT_DATE_SCHEMA.safeParse("").success).toBe(false);
  });

  it("rejects dates with characters outside the safe set", () => {
    expect(STRICT_DATE_SCHEMA.safeParse('April 20, 2026"; do shell script').success).toBe(false);
    expect(STRICT_DATE_SCHEMA.safeParse("2026-04-20\ninjection").success).toBe(false);
  });
});

describe("REQUIRED_DATE_SCHEMA", () => {
  it("accepts valid dates without the 50-year bound", () => {
    // Same as STRICT except no 50-year bound
    expect(REQUIRED_DATE_SCHEMA.safeParse("April 20, 2026").success).toBe(true);
  });

  it("still rejects rolled-over dates", () => {
    expect(REQUIRED_DATE_SCHEMA.safeParse("Feb 30 2026").success).toBe(false);
  });

  // v0.2.2: timezone-qualified inputs rejected via parseUserDateInput
  describe("v0.2.2 timezone-qualified rejection", () => {
    it("rejects ISO with trailing Z", () => {
      const r = REQUIRED_DATE_SCHEMA.safeParse("2026-04-21T15:00:00Z");
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues[0].message).toMatch(/[Tt]imezone-qualified/);
      }
    });

    it("rejects ISO with positive offset", () => {
      const r = REQUIRED_DATE_SCHEMA.safeParse("2026-04-21T15:00:00+05:00");
      expect(r.success).toBe(false);
    });

    it("rejects ISO with negative offset", () => {
      const r = REQUIRED_DATE_SCHEMA.safeParse("2026-04-21T15:00:00-04:00");
      expect(r.success).toBe(false);
    });

    it("still accepts local wall-clock ISO datetime", () => {
      expect(REQUIRED_DATE_SCHEMA.safeParse("2026-04-21T15:00:00").success).toBe(true);
    });

    it("still accepts local 24-hour datetime with space separator", () => {
      expect(REQUIRED_DATE_SCHEMA.safeParse("2026-04-21 15:00:00").success).toBe(true);
    });

    it("still accepts date-only YYYY-MM-DD", () => {
      expect(REQUIRED_DATE_SCHEMA.safeParse("2026-04-21").success).toBe(true);
    });

    it("still accepts natural-language formats", () => {
      expect(REQUIRED_DATE_SCHEMA.safeParse("April 21, 2026 3:00 PM").success).toBe(true);
      expect(REQUIRED_DATE_SCHEMA.safeParse("April 21, 2026 15:00:00").success).toBe(true);
    });
  });
});

describe("EVENT_UID_SCHEMA", () => {
  it("accepts real-world UIDs with special chars", () => {
    // Exchange/Outlook UIDs commonly contain these
    expect(EVENT_UID_SCHEMA.safeParse("user/event@host.com").success).toBe(true);
    expect(EVENT_UID_SCHEMA.safeParse("{E621E1F8-C36C-495A-93FC-0C247A3E6E5F}").success).toBe(true);
    expect(EVENT_UID_SCHEMA.safeParse("abc123+def=ghi").success).toBe(true);
    expect(EVENT_UID_SCHEMA.safeParse("simple-uid-123").success).toBe(true);
  });

  it("rejects control characters (injection)", () => {
    expect(EVENT_UID_SCHEMA.safeParse("evil\nuid").success).toBe(false);
    expect(EVENT_UID_SCHEMA.safeParse("evil\x00uid").success).toBe(false);
  });

  it("rejects backslash and double-quote (AppleScript injection)", () => {
    expect(EVENT_UID_SCHEMA.safeParse('uid"; do shell').success).toBe(false);
    expect(EVENT_UID_SCHEMA.safeParse("uid\\injection").success).toBe(false);
  });

  it("enforces length bounds", () => {
    expect(EVENT_UID_SCHEMA.safeParse("").success).toBe(false);
    expect(EVENT_UID_SCHEMA.safeParse("x".repeat(256)).success).toBe(false);
    expect(EVENT_UID_SCHEMA.safeParse("x".repeat(255)).success).toBe(true);
  });
});

describe("CALENDAR_NAME_SCHEMA", () => {
  it("accepts typical calendar names", () => {
    expect(CALENDAR_NAME_SCHEMA.safeParse("Work").success).toBe(true);
    expect(CALENDAR_NAME_SCHEMA.safeParse("Calendar").success).toBe(true);
    expect(CALENDAR_NAME_SCHEMA.safeParse("Kevin's Personal").success).toBe(true);
    expect(CALENDAR_NAME_SCHEMA.safeParse("kevin.may@scoutsolutions.com").success).toBe(true);
  });

  it("rejects double-quote (AppleScript literal breakout)", () => {
    expect(CALENDAR_NAME_SCHEMA.safeParse('Work"; drop tables;').success).toBe(false);
  });

  it("rejects backslash", () => {
    expect(CALENDAR_NAME_SCHEMA.safeParse("Work\\path").success).toBe(false);
  });

  it("rejects control characters", () => {
    expect(CALENDAR_NAME_SCHEMA.safeParse("a\nb").success).toBe(false);
    expect(CALENDAR_NAME_SCHEMA.safeParse("a\tb").success).toBe(false);
  });

  it("enforces length bounds", () => {
    expect(CALENDAR_NAME_SCHEMA.safeParse("").success).toBe(false);
    expect(CALENDAR_NAME_SCHEMA.safeParse("x".repeat(201)).success).toBe(false);
  });
});

describe("SEARCH_QUERY_SCHEMA", () => {
  it("accepts typical search queries", () => {
    expect(SEARCH_QUERY_SCHEMA.safeParse("NYDOT").success).toBe(true);
    expect(SEARCH_QUERY_SCHEMA.safeParse("meeting with Sarah").success).toBe(true);
    expect(SEARCH_QUERY_SCHEMA.safeParse("quarterly review").success).toBe(true);
  });

  it("rejects control characters", () => {
    expect(SEARCH_QUERY_SCHEMA.safeParse("test\nquery").success).toBe(false);
    expect(SEARCH_QUERY_SCHEMA.safeParse("test\x00query").success).toBe(false);
  });

  it("enforces length cap", () => {
    expect(SEARCH_QUERY_SCHEMA.safeParse("").success).toBe(false);
    expect(SEARCH_QUERY_SCHEMA.safeParse("x".repeat(501)).success).toBe(false);
    expect(SEARCH_QUERY_SCHEMA.safeParse("x".repeat(500)).success).toBe(true);
  });
});

describe("EVENT_LIMIT_SCHEMA", () => {
  it("accepts reasonable integer limits", () => {
    expect(EVENT_LIMIT_SCHEMA.safeParse(1).success).toBe(true);
    expect(EVENT_LIMIT_SCHEMA.safeParse(50).success).toBe(true);
    expect(EVENT_LIMIT_SCHEMA.safeParse(500).success).toBe(true);
  });

  it("rejects unbounded large values", () => {
    expect(EVENT_LIMIT_SCHEMA.safeParse(501).success).toBe(false);
    expect(EVENT_LIMIT_SCHEMA.safeParse(1e9).success).toBe(false);
  });

  it("rejects zero and negative", () => {
    expect(EVENT_LIMIT_SCHEMA.safeParse(0).success).toBe(false);
    expect(EVENT_LIMIT_SCHEMA.safeParse(-1).success).toBe(false);
  });

  it("rejects non-integers", () => {
    expect(EVENT_LIMIT_SCHEMA.safeParse(1.5).success).toBe(false);
  });

  it("rejects NaN and Infinity", () => {
    expect(EVENT_LIMIT_SCHEMA.safeParse(NaN).success).toBe(false);
    expect(EVENT_LIMIT_SCHEMA.safeParse(Infinity).success).toBe(false);
  });
});

describe("EVENT_SUMMARY_SCHEMA", () => {
  it("accepts single-line titles", () => {
    expect(EVENT_SUMMARY_SCHEMA.safeParse("Team Sync").success).toBe(true);
  });

  it("rejects newlines (titles are single-line)", () => {
    expect(EVENT_SUMMARY_SCHEMA.safeParse("Line 1\nLine 2").success).toBe(false);
  });

  it("rejects empty", () => {
    expect(EVENT_SUMMARY_SCHEMA.safeParse("").success).toBe(false);
  });
});

describe("EVENT_LOCATION_SCHEMA", () => {
  it("accepts typical locations", () => {
    expect(EVENT_LOCATION_SCHEMA.safeParse("Conference Room A").success).toBe(true);
    expect(EVENT_LOCATION_SCHEMA.safeParse("Zoom").success).toBe(true);
  });

  it("accepts empty (to clear location)", () => {
    expect(EVENT_LOCATION_SCHEMA.safeParse("").success).toBe(true);
  });

  it("rejects newlines", () => {
    expect(EVENT_LOCATION_SCHEMA.safeParse("Line 1\nLine 2").success).toBe(false);
  });
});

describe("EVENT_DESCRIPTION_SCHEMA", () => {
  it("accepts multi-line descriptions", () => {
    expect(EVENT_DESCRIPTION_SCHEMA.safeParse("Line 1\nLine 2\nLine 3").success).toBe(true);
    expect(EVENT_DESCRIPTION_SCHEMA.safeParse("CRLF\r\nWorks").success).toBe(true);
  });

  it("accepts empty (to clear description)", () => {
    expect(EVENT_DESCRIPTION_SCHEMA.safeParse("").success).toBe(true);
  });

  it("rejects control characters other than newlines", () => {
    // Schema explicitly allows \n, \r, and \t (tab is common in indented notes)
    // but rejects all other control characters.
    expect(EVENT_DESCRIPTION_SCHEMA.safeParse("has\x00null").success).toBe(false);
    expect(EVENT_DESCRIPTION_SCHEMA.safeParse("has\x07bell").success).toBe(false);
    expect(EVENT_DESCRIPTION_SCHEMA.safeParse("has\x1bescape").success).toBe(false);
    expect(EVENT_DESCRIPTION_SCHEMA.safeParse("has\x7fdel").success).toBe(false);
  });

  it("allows tab (common in indented notes)", () => {
    expect(EVENT_DESCRIPTION_SCHEMA.safeParse("indented\tnote").success).toBe(true);
  });

  it("enforces length cap", () => {
    expect(EVENT_DESCRIPTION_SCHEMA.safeParse("x".repeat(5001)).success).toBe(false);
  });
});

describe("PARTICIPATION_STATUS_SCHEMA", () => {
  it("accepts the four valid statuses", () => {
    expect(PARTICIPATION_STATUS_SCHEMA.safeParse("accepted").success).toBe(true);
    expect(PARTICIPATION_STATUS_SCHEMA.safeParse("declined").success).toBe(true);
    expect(PARTICIPATION_STATUS_SCHEMA.safeParse("tentative").success).toBe(true);
    expect(PARTICIPATION_STATUS_SCHEMA.safeParse("needs-action").success).toBe(true);
  });

  it("rejects invalid statuses", () => {
    expect(PARTICIPATION_STATUS_SCHEMA.safeParse("maybe").success).toBe(false);
    expect(PARTICIPATION_STATUS_SCHEMA.safeParse("").success).toBe(false);
    expect(PARTICIPATION_STATUS_SCHEMA.safeParse("needs action").success).toBe(false); // space, not hyphen
  });
});
