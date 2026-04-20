# Changelog

All notable changes to apple-calendar-mcp are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.3] - 2026-04-21

Patch release fixing a latent bug in `update-event` surfaced during v0.2.2 live smoke testing. Not a regression - the same ordering issue existed in v0.2.0 and v0.2.1 but was never exercised with both dates in the same update.

### Fixed
- **`update-event` fails when both `startDate` and `endDate` are supplied.** AppleScript's Calendar integration validates `start date < end date` on every property assignment, not transactionally. The v0.2.2 (and earlier) generated script ran `set start date of e to ...` first, which briefly made start > existing end for any forward-in-time reschedule and Calendar rejected the write with "The start date must be before the end date." v0.2.3 uses a safe-floor bookend pattern:
  1. Drop start date to Jan 1 2000 (safely before any realistic existing end)
  2. Set end date to the new end (now start << new end, transition valid)
  3. Set start date to the new start (now new start < new end, transition valid)
  
  Works for both forward and backward time moves in a single AppleScript roundtrip. Single-field updates (only startDate or only endDate) skip the bookend - those cases work with a plain setter and any start/end invariant violation reflects genuine user error.

### Added
- 2 new tests covering the safe-floor pattern (reschedule ordering, single-field skip).

### Notes
- 186 tests passing (up from 184).
- Behavioral compatibility: any caller that was working against 0.2.2 continues to work. The fix enables a previously-failing case without changing any passing behavior.

## [0.2.2] - 2026-04-21

Patch release fixing silent data corruption in `create-event` and `update-event` when dates use 24-hour or ISO format. No breaking changes to tool signatures; inputs that worked before still work, plus several previously-broken formats now work correctly.

### Fixed
- **Silent time truncation in write tools.** When `startDate`/`endDate` used 24-hour time (e.g., `"April 21, 2026 15:00:00"`) or ISO format (e.g., `"2026-04-21T15:00:00"`), AppleScript's `date "..."` string coercion on US English macOS dropped the time to midnight without any error. Events were created at 00:00 local instead of the intended time. Root cause: JavaScript `new Date()` understands 24-hour; AppleScript's locale-dependent parser does not. v0.2.2 bypasses the string coercion by generating AppleScript that assigns year/month/day/time components directly, locale-independently.
- **`YYYY-MM-DD` date-only inputs would have shifted to the previous day** under any naive JS parsing (ISO date-only is parsed as UTC midnight by JS; `.getDate()` then returns the prior day in US timezones). Gauntlet-caught before release - now handled explicitly by a local-components parse before `new Date()` ever sees the input.

### Added
- `src/services/dateInput.ts` - `parseUserDateInput(string) → DateComponents`. Single source of truth used by Zod refinement AND AppleScript builder, eliminating parser divergence between validation and execution layers.
- `src/services/appleScriptDate.ts` - `buildAppleScriptDateBlock(components, varName)`. Emits a locale-independent AppleScript fragment that sets year, month, day, and time via numeric component assignment. Includes the `day of d to 1` rollover guard (AppleScript's eager month arithmetic rolls Feb 31 to Mar 3 without this).
- `src/services/appleScriptDate.integration.test.ts` - macOS-only integration tests that execute generated AppleScript via `osascript` and assert resulting date components. Proves semantics, not just string shape. Skipped on non-darwin platforms.
- 18 new `dateInput` unit tests covering supported formats and rejection cases.
- 8 new `appleScriptDate` unit tests covering rollover guard, forceMidnight, variable naming.
- 7 new schema tests for timezone-qualified input rejection.

### Changed
- `REQUIRED_DATE_SCHEMA` (and `STRICT_DATE_SCHEMA` by inheritance) now routes inputs through `parseUserDateInput` before downstream refinements. This is the primary fix: Zod and AppleScript now agree on what "valid" means.
- `buildCreateEventScript` and `buildUpdateEventScript` emit pre-script date blocks (`set startDateObj to ...`) instead of inlining `date "..."` literals.
- Character set for date schemas expanded to include `+` so offset inputs reach our refinement with a specific error rather than a generic charset rejection.

### Security
- **Explicit input-format policy.** ISO strings with trailing `Z` or `±HH:mm` / `±HHmm` offset are now rejected at the Zod boundary with a clear error. v0.2.0/v0.2.1 parsed these via `new Date()` but the behavior across layers was undefined. Accepting them would require handling wall-clock-vs-instant semantics; v0.2.2 keeps everything wall-clock local. Users who need offset handling should convert to local time before calling the tool.

### Audit guidance for v0.2.0 / v0.2.1 users

If you used `create-event` or `update-event` with 24-hour times during 0.2.0 or 0.2.1, existing events may be on your calendar at **00:00 local** instead of the intended time. Suggested audit:

1. Open Calendar.app and sort by start time.
2. Look for events at 12:00 AM midnight created or modified between 2026-04-20 and your upgrade to 0.2.2.
3. Cross-reference with your original intent and fix any that are wrong. (The fix is now safe: update the event in Calendar.app directly, or call `update-event` with the correct time now that 0.2.2 handles it properly.)

No existing events are modified by the upgrade itself - this is a read-and-correct audit, not a migration.

### Notes
- Total tests: 184 (up from 143 in v0.2.1). 65 schema, 57 manager, 28 applescript-util, 18 dateInput, 8 appleScriptDate unit, 8 appleScriptDate macOS-integration.
- Gauntlet credit: OpenAI (GPT-5.4) caught the duplicate-parser structural issue, the `new Date("YYYY-MM-DD")` UTC landmine, the all-day consistency gap, and the snapshot-only test coverage limitation. Gemini (3.1 Pro, grounded) confirmed AppleScript's `set month of d to <integer>` / `set time of d to <seconds>` idioms are stable on modern macOS. Both reviewers independently flagged the UTC date-only landmine.

## [0.2.1] - 2026-04-20

Patch release addressing findings from the post-execution gauntlet review of v0.2.0. No breaking changes; existing callers are unaffected.

### Security
- `STRICT_DATE_SCHEMA`, `REQUIRED_DATE_SCHEMA`, and `DATE_FILTER_SCHEMA` now actually reject rolled-over dates (e.g., "Feb 30 2026"). JavaScript's `Date` constructor silently rolls these to "Mar 2 2026" and the previous `!isNaN` refinement let them through. v0.2.0 documented this as a fix but did not implement it - v0.2.1 does.
- `update-event` tool accepts an optional `calendarName` parameter for safety scoping, consistent with `delete-event`. When provided, the tool refuses updates targeting ambiguous or read-only calendars.

### Added
- `src/schemas.ts` - schemas extracted to their own module for standalone testing.
- `src/schemas.test.ts` - 58 assertions covering every input schema (positive and negative cases) including URL scheme allowlist, multi-@ rejection, rolled-over date rejection in all three formats, 50-year bounds, control-char rejection, length caps, and integer bounds.
- Tests proving `APPLE_CALENDAR_MCP_READ_ONLY=1` blocks every write method.
- Snapshot tests for `update-event` scoped vs cross-calendar AppleScript generation.
- `getEvent` now strips control characters from all string fields (summary, location, description, calendarName, status, url) for consistency with `parseEventListImpl`.
- TROUBLESHOOTING entry for URL scheme rejection.

### Fixed
- README: "Mail.app" reference corrected to "Calendar.app" and test-coverage description updated to reflect the schema + script-builder + helper coverage that actually exists.
- SECURITY.md: documented recurring-master detection as best-effort in Known Weaknesses.

### Notes
- Total tests: 143 (up from 77 in v0.2.0).
- Backward compatibility: existing `update-event` callers that don't pass `calendarName` preserve v0.2.0 cross-calendar UID lookup behavior. Providing `calendarName` is recommended going forward.

## [0.2.0] - 2026-04-20

### Added
- `respond-to-invitation` - Accept, decline, or tentatively respond to event invitations
- `create-event` - Create new calendar events with summary, dates, location, description, URL, and all-day flag
- `update-event` - Modify existing event properties
- `delete-event` - Delete events (with safety scoping: requires calendar name, refuses recurring masters)
- `APPLE_CALENDAR_MCP_READ_ONLY` environment variable to disable write tools server-wide
- Per-session rate limiting on destructive operations (10 deletes per 60 seconds)
- Audit logging to stderr for all write operations
- `CHANGELOG.md` (this file), `docs/TROUBLESHOOTING.md`, `docs/TEAMS-LINKS.md`

### Changed
- `SECURITY.md` updated with v0.2.0 threat model, including write-specific concerns
- README expanded: write tool examples, environment variables, "When NOT to use write tools"

### Security
- `URL_SCHEMA` rejects non-http(s) schemes (blocks `javascript:`, `file:`, `data:` URIs)
- `EMAIL_SCHEMA` rejects multiple `@` characters
- `STRICT_DATE_SCHEMA` rejects rolled-over dates and bounds to +/- 50 years from today
- `resolveWritableCalendar` refuses ambiguous calendar names to prevent writes landing in wrong account
- Multi-line description handling uses AppleScript `linefeed` concatenation; the `escapeForAppleScript` function stays strict and rejects all control characters
- `parseEventListImpl` strips control characters from output fields (defense against stored data that contains our delimiters)

### Known Limitations
- AppleScript cannot provision Teams/Zoom/Meet meeting URLs (see docs/TEAMS-LINKS.md)
- Invitation response email sending varies by account type (iCloud reliable, Exchange/Google inconsistent)
- Recurring event series deletion not supported via this tool (use Calendar.app)
- Internationalized (IDN/non-ASCII) email addresses not supported by `respond-to-invitation`

## [0.1.0] - 2026-04-20

### Added
- Initial public release with read-only calendar tools
- `list-calendars`, `list-events`, `search-events`, `get-event`, `get-today`, `get-this-week`
- Security hardening: input validation via Zod, AppleScript escape layer, ASCII control char delimiters
- README, SECURITY.md

[Unreleased]: https://github.com/scoutsolutions/apple-calendar-mcp/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/scoutsolutions/apple-calendar-mcp/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/scoutsolutions/apple-calendar-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/scoutsolutions/apple-calendar-mcp/releases/tag/v0.1.0
