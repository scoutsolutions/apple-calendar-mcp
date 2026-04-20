# Security

## Threat Model

This MCP server is driven by an AI assistant that may process untrusted content (emails, calendar invites, external context). Any input that flows into AppleScript source is an injection vector.

**Specific concern:** AppleScript's `source of msg`, `date "..."`, and similar string-literal patterns are embedded via template interpolation. If user-controlled input contains characters that escape the string literal (e.g., newlines), the caller can inject arbitrary AppleScript statements including `do shell script` - which executes with the user's full privileges.

## Defense in Depth

Three layers of protection:

### 1. Zod schema validation at the tool boundary

Every tool input is validated against a Zod schema that rejects control characters, caps lengths, and constrains formats:

| Schema | Applied to | Rejects |
|--------|-----------|---------|
| `REQUIRED_DATE_SCHEMA` | `startDate`, `endDate` | Anything outside `[a-zA-Z0-9 ,/\-:]` + invalid dates |
| `CALENDAR_NAME_SCHEMA` | `calendarName` | Control chars (0x00-0x1F, 0x7F), backslash, double quote |
| `EVENT_UID_SCHEMA` | `uid` | Control chars, backslash, double quote (reject-list, not allow-list, because real RFC 5545 UIDs include `/`, `+`, `=`, `{`, `}`) |
| `SEARCH_QUERY_SCHEMA` | `query` | Control chars |
| `EVENT_LIMIT_SCHEMA` | `limit` | Non-integer, < 1, > 500, NaN, Infinity |

### 2. AppleScript escape function

The `escapeForAppleScript` function in `src/services/appleCalendarManager.ts` rejects any control character (0x00-0x1F, 0x7F) before passing text into AppleScript source. This catches anything the schema misses - for example, if `getToday` computes a date internally and calls `listEvents` directly, bypassing Zod, the escape function still enforces the same constraint.

Backslash and quote are escaped (not rejected) so legitimate text containing them can still pass through safely.

### 3. Structural separation

- **No `do shell script`**: The `searchEvents` implementation uses AppleScript's native `ignoring case` directive instead of shelling out. Removes an entire class of cascading injection risk.
- **ASCII control delimiters**: `\x1F` (Unit Separator) and `\x1E` (Record Separator) are used as wire-format delimiters between AppleScript and the TypeScript parser. Because the escape function rejects control characters in inputs, these delimiters cannot collide with event data. Mathematically impossible.

## What's Not Protected

- **Privilege of the running process**: This MCP runs with the user's privileges. A malicious caller who bypasses all three layers (if that were possible) would have whatever Calendar permission the user has.
- **Calendar.app itself**: This MCP cannot protect against bugs or vulnerabilities in macOS Calendar or AppleScript itself.
- **Data exposure via read operations**: This is a read-only server. Legitimate use exposes calendar event content to the AI. That's the point.

## Reporting Issues

File a public issue for non-sensitive findings. For anything that appears to enable code execution or escape isolation, please contact the maintainer privately first.

## Audit History

- 2026-04-19: Initial security review (gauntlet pattern). Findings: 2 HIGH + 3 MEDIUM + 2 LOW. All HIGH and MEDIUM addressed in commits 9643f32 (escape + delimiters), 09cab56 (do shell script removal), 9dd7d77 (Zod schemas). Plan and both reviews archived in `docs/superpowers/plans/2026-04-19-calendar-security-hardening.md`.
