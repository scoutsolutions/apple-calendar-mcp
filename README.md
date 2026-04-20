# Apple Calendar MCP

Read-only MCP server for Apple Calendar. Gives AI assistants access to events across all synced calendars - iCloud, Google, Exchange, CalDAV, subscribed calendars.

**Read-only by design.** Event creation is deliberately not supported because AppleScript-created events don't get Teams/Zoom meeting links or proper server-side resources. For meetings that need online-meeting integration, use a Microsoft Graph or Google Calendar MCP instead.

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
- **Exchange calendars commonly have the name "Calendar"** (just that). Multiple Exchange accounts will produce name collisions. The tools return the calendar name alongside each event so the AI can disambiguate from context.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

Tests cover the input validation and parsing logic. AppleScript-level behavior requires a running Mail.app with accounts configured, so is tested interactively rather than in CI.

## License

MIT. See [LICENSE](./LICENSE).

## Credits

AppleScript utility patterns adapted from [sweetrb/apple-mail-mcp](https://github.com/sweetrb/apple-mail-mcp) (MIT). The calendar service and tool registrations are new.
