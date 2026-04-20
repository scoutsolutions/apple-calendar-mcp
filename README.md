# Apple Calendar MCP

MCP server for Apple Calendar. Gives AI assistants access to events across all synced calendars - iCloud, Google, Exchange, CalDAV, subscribed calendars.

**Read is the primary use case.** Write tools (create/update/delete events, respond to invitations) are included as of v0.2.0, with important caveats: AppleScript cannot provision Teams/Zoom/Meet meeting URLs. For online meetings, use Outlook or Google Calendar (see [docs/TEAMS-LINKS.md](./docs/TEAMS-LINKS.md)). If you need read-only behavior, pin to v0.1.x or set `APPLE_CALENDAR_MCP_READ_ONLY=1`.

## Why this exists

Apple Calendar is the simplest way to access multiple calendar accounts on macOS - it handles the authentication, sync, and unified view. But there wasn't an MCP server for it. This fills that gap.

If you already have an Exchange account configured in Apple Calendar, or an iCloud calendar your family shares, or a Google Workspace account - this MCP can read from all of them without separate API credentials for each service.

## Tools

| Tool | Purpose |
|------|---------|
| `list-calendars` | List all calendars with writable status |
| `list-events` | Events in a date range, optionally filtered by calendar |
| `search-events` | Text search across event summary, location, and notes |
| `get-event` | Full event details including attendees and meeting URLs |
| `get-today` | Events for today across all calendars |
| `get-this-week` | Events for the current week (Monday-Sunday) |
| `respond-to-invitation` | Accept/decline/tentative an event invitation. NOTE: send-behavior varies by account type. |
| `create-event` | Create a new calendar event. NOT for Teams/Zoom meetings (see docs/TEAMS-LINKS.md). |
| `update-event` | Modify an existing event's summary/times/location/notes/URL. |
| `delete-event` | Delete an event from a specified calendar. Refuses recurring masters. |

## Write tool examples

### Responding to an invitation

You received an invitation to "Q2 Planning" and want to accept:

```
list-events startDate="April 20, 2026 12:00 AM" endDate="April 20, 2026 11:59 PM" query="Q2 Planning"
-> Returns event with UID "abc123"

respond-to-invitation uid="abc123" status="accepted" userEmail="you@example.com"
-> "Status updated to 'accepted' on event abc123."
```

**Important:** Whether the organizer receives your response email depends on your account type. iCloud reliably sends. Exchange and Google CalDAV behavior is inconsistent - the status updates locally and on the server but may not email the organizer. If confirmation matters, follow up separately.

### Creating a personal event

Block time for focused work:

```
create-event \
  calendarName="Work" \
  summary="Deep work block" \
  startDate="April 22, 2026 9:00 AM" \
  endDate="April 22, 2026 11:00 AM" \
  description="No meetings. Turning off Slack."
```

### Creating an event with a pasted meeting URL

You have a Zoom link from a separate booking - paste it in the URL field:

```
create-event \
  calendarName="Work" \
  summary="Client sync" \
  startDate="April 23, 2026 2:00 PM" \
  endDate="April 23, 2026 2:30 PM" \
  url="https://zoom.us/j/123456789" \
  description="Quarterly check-in"
```

**Note:** This does NOT provision a new Zoom meeting - you must have obtained the URL from Zoom separately. For AI-created meetings that need a fresh meeting URL, use your calendar platform's tool (Outlook for Teams, Google Calendar for Meet).

### Why the calendar name matters

If you have multiple accounts in Apple Calendar (e.g., iCloud + Exchange work), the tool refuses to guess when names collide:

```
create-event calendarName="Calendar" ...
-> "Failed to create event. Possible causes: calendar 'Calendar' doesn't exist, is read-only, or is ambiguous (duplicated across accounts)."
```

Run `list-calendars` to see your calendars. If two have the same name, you'll need to rename one in Calendar.app or create the event via the native app.

### Rescheduling an event

```
update-event \
  uid="abc123" \
  startDate="April 25, 2026 10:00 AM" \
  endDate="April 25, 2026 11:00 AM"
```

### Clearing a field

Pass an empty string to clear a field. To leave a field unchanged, omit it:

```
update-event uid="abc123" location=""
-> Removes the location

update-event uid="abc123" summary="New title"
-> Changes only the summary; location, times, etc. unchanged
```

### Deleting an event

Requires BOTH `calendarName` and `uid` - this is a safety scoping requirement:

```
delete-event calendarName="Work" uid="abc123"
-> "Deleted event abc123 ('Canceled meeting' at 2026-04-25T15:00:00.000Z).
   Recoverability depends on account type - iCloud/Google retain in trash ~30 days;
   Exchange goes to Deleted Items; local-only calendars are permanent."
```

**What this tool refuses:**
- Recurring event masters (would delete all occurrences) - use Calendar.app for series-wide deletion
- Events not found in the specified calendar (must scope correctly)
- More than 10 deletes in 60 seconds (rate limit)

## Requirements

- macOS (uses AppleScript)
- Node.js 20+
- Automation permission for Calendar.app (macOS will prompt on first run)

## Installation

```bash
npm install -g apple-calendar-mcp
```

Or run via npx without installing:

```bash
npx -y apple-calendar-mcp
```

## Configuration for Claude Code

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "apple-calendar": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "apple-calendar-mcp"]
    }
  }
}
```

Or install from source:

```bash
git clone https://github.com/scoutsolutions/apple-calendar-mcp
cd apple-calendar-mcp
npm install
npm run build
```

Then in `~/.claude.json`:

```json
{
  "mcpServers": {
    "apple-calendar": {
      "type": "stdio",
      "command": "/opt/homebrew/bin/node",
      "args": ["/path/to/apple-calendar-mcp/build/index.js"]
    }
  }
}
```

## Permissions

On first use, macOS will prompt to allow Claude Code (or whichever process is running this MCP) to control Calendar.app. Approve in System Settings → Privacy & Security → Automation.

## Environment variables

| Variable | Values | Effect |
|----------|--------|--------|
| `APPLE_CALENDAR_MCP_READ_ONLY` | `1`, `true`, `yes` | Disables all write tools server-wide. Read tools continue to work normally. |

Example in `~/.claude.json`:

```json
{
  "mcpServers": {
    "apple-calendar": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "apple-calendar-mcp"],
      "env": {
        "APPLE_CALENDAR_MCP_READ_ONLY": "1"
      }
    }
  }
}
```

## When NOT to use write tools

Write tools in this MCP are deliberately limited. Don't use them for:

- **Business meetings that need Teams/Zoom/Meet URLs.** AppleScript can't provision those. Use Outlook or Google Calendar, or their API-backed MCPs. See [docs/TEAMS-LINKS.md](./docs/TEAMS-LINKS.md).
- **Resource booking.** Conference rooms, equipment - these require server-side reservation logic that's outside AppleScript's reach.
- **Recurring series creation or series-wide edits.** Out of scope for v0.2.0.
- **Cross-calendar moves.** Not supported; delete from one and create on the other if you must.

Write tools are for:

- Personal reminders and time blocks
- Family calendar entries
- Flight/travel events
- Responding to invitations (accept/decline/tentative)
- Events where the meeting URL isn't needed (offline meetings, lunch, phone calls)
- Events where you have an existing meeting URL to paste into the event

## Security

This MCP validates all input at the Zod schema boundary and rejects control characters that could escape AppleScript string literals. See [SECURITY.md](./SECURITY.md) for details on the threat model and hardening choices.

Key properties:
- Input strings with control characters (including newlines) are rejected, blocking AppleScript statement injection
- Date strings must match a date-safe character set
- Event UIDs, calendar names, and search queries have schema-level validation
- Limits are bounded integers
- No `do shell script` patterns - case-insensitive search uses AppleScript's native `ignoring case`
- ASCII control characters (`\x1F`, `\x1E`) used as delimiters, guaranteed not to collide with user data

Found an issue? Please file an issue or email the maintainer.

## Known Limitations

- **Recurring events show their master event's original start date**, not the specific occurrence in your query range. To avoid misleading dates, occurrences outside the requested range are filtered out. A future enhancement could expand recurrence rules to compute instance dates, but that requires parsing RRULE and handling exceptions.
- **Event UIDs are not globally unique** across calendars. `get-event` returns the first match across all calendars. If you have the same UID in multiple calendars (rare), only the first is returned.
- **Exchange calendars commonly have the name "Calendar"** (just that). Multiple Exchange accounts will produce name collisions. The tools return the calendar name alongside each event so the AI can disambiguate from context. Write tools refuse to act on ambiguous calendar names.
- **Teams/Zoom/Meet meeting URLs cannot be provisioned** by this MCP. See [docs/TEAMS-LINKS.md](./docs/TEAMS-LINKS.md).
- **Invitation response email sending varies by account type.** iCloud reliably sends; Exchange and Google CalDAV are inconsistent. See [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md).
- **Recurring series edits and deletes are not supported.** Single-occurrence events are fully handled.
- **Internationalized (non-ASCII) email addresses not supported** by `respond-to-invitation`.

## Further reading

- [CHANGELOG.md](./CHANGELOG.md) - version history
- [SECURITY.md](./SECURITY.md) - threat model and audit history
- [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) - common error scenarios and fixes
- [docs/TEAMS-LINKS.md](./docs/TEAMS-LINKS.md) - why online meeting URLs aren't provisioned and what to do instead

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

Tests cover the Zod schemas, script builders (snapshot tests against generated AppleScript), parsing helpers, and write-helper utilities. AppleScript-level behavior requires a running Calendar.app with accounts configured, so is tested interactively rather than in CI.

## License

MIT. See [LICENSE](./LICENSE).

## Credits

AppleScript utility patterns adapted from [sweetrb/apple-mail-mcp](https://github.com/sweetrb/apple-mail-mcp) (MIT). The calendar service and tool registrations are new.
