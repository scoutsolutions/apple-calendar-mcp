# Changelog

All notable changes to apple-calendar-mcp are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
