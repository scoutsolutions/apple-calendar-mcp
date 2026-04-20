# Changelog

All notable changes to apple-calendar-mcp are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/scoutsolutions/apple-calendar-mcp/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/scoutsolutions/apple-calendar-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/scoutsolutions/apple-calendar-mcp/releases/tag/v0.1.0
