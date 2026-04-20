# Troubleshooting

Common error scenarios and how to resolve them. Each entry has symptom, cause, and resolution.

## "Calendar 'X' doesn't exist, is read-only, or is ambiguous"

**Symptom.** `create-event` or `delete-event` returns a message saying the target calendar doesn't exist, is read-only, or is ambiguous (duplicated across accounts).

**Cause.** Exchange's default calendar is almost always named "Calendar" with nothing distinguishing it. If you have multiple Exchange accounts configured in Apple Calendar, both will be named "Calendar" and AppleScript cannot disambiguate them. Writes to an ambiguous name would silently land in an undocumented first-match account, so this MCP refuses. Similarly, subscribed and holiday calendars are read-only and will be rejected.

**Resolution.**
1. Run `list-calendars` to see everything. Writable calendars are marked with a pencil icon; read-only with a lock.
2. If two calendars share a name, rename one in Calendar.app: right-click the calendar -> "Get Info" -> change the name. Then re-run your write call.
3. If the calendar name is correct but marked read-only (e.g., US Holidays), create the event on a different calendar.

## "I accepted an invitation but the organizer says they never heard back"

**Symptom.** `respond-to-invitation` returns success, but the event organizer reports no response notification arrived in their inbox.

**Cause.** The tool sets the participation status on the event via AppleScript, which updates Calendar.app and the CalDAV server that holds the event. Whether a response email is sent to the organizer depends on the account type:
- iCloud calendars: reliably send.
- Exchange (Office 365 / on-prem): inconsistent - Outlook usually sends when you open and respond from Outlook, but AppleScript-driven status changes often skip the response email.
- Google CalDAV: also inconsistent for the same reason.

**Resolution.** If the response email matters (external organizer, tracking attendance), open the invitation in Outlook, Gmail, or Apple Calendar's UI and click Accept/Decline/Tentative there - the native client handles the email dispatch. Alternatively, follow up with the organizer directly.

## "Delete-event refused because the event is a recurring master"

**Symptom.** `delete-event` returns "is a recurring series master. Deleting would remove all occurrences."

**Cause.** AppleScript's `delete e` on a recurrence rule master nukes the entire series with no prompt, no confirmation, and no way to recover individual occurrences. To prevent accidental series-wide deletions, this MCP refuses. Calendar.app's native "delete" action prompts "this event only" vs "all events", which is the correct user experience for recurring events.

**Resolution.**
- For a single occurrence: open the event in Calendar.app, press Delete, choose "This event only".
- For the whole series: open in Calendar.app, press Delete, choose "All events". This MCP will not do series-wide deletions even on explicit request - it's out of scope for v0.2.0.

## "Rate limit exceeded for delete-event"

**Symptom.** `delete-event` returns "Rate limit exceeded: 10 operations per minute. Wait and retry."

**Cause.** Per-session throttle on destructive operations. Primarily a guardrail against prompt-injected AI loops (e.g., a malicious calendar invite tricks the AI into calling delete-event 500 times).

**Resolution.** If you're intentionally doing bulk cleanup, pause for 60 seconds between batches. If you hit the limit unexpectedly, review your session history - something probably called delete-event in a loop. The throttle is per-process, so restarting the MCP clears it.

## "Permission denied" / "not authorized"

**Symptom.** AppleScript errors with a permission or authorization message.

**Cause.** macOS requires user consent for one app to control another. Claude Code (or whatever MCP host you're using) must be granted Automation permission to control Calendar.app.

**Resolution.** System Settings -> Privacy & Security -> Automation. Find your MCP host (Claude Code, Claude Desktop, Warp, etc.) and make sure Calendar is checked under that entry. On first run, macOS should prompt you automatically; if the prompt was dismissed, you'll need to enable it manually here.

## "My event was created but doesn't sync / doesn't appear on my phone"

**Symptom.** `create-event` returns success with a UID, and the event shows up in Calendar.app, but never syncs to iCloud/Exchange/Google.

**Possible causes.**
- The target account is offline or has sync errors. Check Calendar.app -> Window -> Activity (or the top-level sync indicator) for errors.
- CalDAV sync is on a schedule (typically 1-5 minutes); sync isn't instant.
- The calendar is local-only. Local calendars don't sync anywhere by design.

**Resolution.** Verify the target calendar's account in System Settings -> Internet Accounts. If Exchange or Google, sign out and back in to refresh the connection. For local calendars, that's the expected behavior.

## "Search returns old recurring events with wrong dates"

**Symptom.** `list-events` or `search-events` returns events whose dates seem way off from the range you requested (often months earlier).

**Cause.** AppleScript returns the master event's original start date for recurring series, not the specific occurrence in your query range. A weekly meeting that started six months ago still shows its original start date.

**Resolution.** This MCP filters out master events whose dates fall outside the requested range to reduce confusion. The tradeoff: you may miss current-week instances of recurring events. If you need to see all recurring instances correctly, fall back to Calendar.app's UI. A future enhancement could expand RRULE into instance dates, but that's not in v0.2.0.

## "How do I see the audit log?"

All write operations emit a stderr line like `[audit 2026-04-20T19:34:12.000Z] create-event calendarName="Work" summary="Lunch" result="ABC123-UID"`.

**Where to find stderr depends on your MCP host:**
- **Claude Code** (terminal): stderr goes directly to the terminal you launched Claude Code in.
- **Claude Desktop**: stderr is captured in the app logs. On macOS: `~/Library/Logs/Claude/mcp-server-apple-calendar.log` (the filename depends on your mcpServers config name).

If you want a persistent file log, redirect stderr when launching the MCP via shell: run a wrapper script that execs the MCP and pipes stderr into a timestamped file.

## "Character rejection error when I paste text"

**Symptom.** Zod validation error like "must not contain control characters."

**Cause.** Input contains a non-printable ASCII control character (null bytes, raw tabs in some fields, carriage returns in non-description fields, etc.). The escape layer rejects these to prevent AppleScript statement injection.

**Resolution.**
- For event descriptions: newlines are allowed; strip tabs and other control chars.
- For summary, location, calendar name, UID, email: strip all control characters. If your paste source has invisible formatting, retype the visible content.
- Common gotcha: pasting from terminal buffers sometimes includes ANSI escape sequences. Paste into a plain-text editor first to strip them, then re-paste.

## "URL must use http or https scheme"

**Symptom.** `create-event` or `update-event` with a `url` parameter rejects with "URL must use http or https scheme."

**Cause.** The URL schema allows only `http:` and `https:` to prevent XSS vectors in calendar clients that render event URLs. Other schemes (`mailto:`, `tel:`, `javascript:`, `file:`, `data:`) are rejected even if they're syntactically valid URLs.

**Resolution.**
- If you were pasting a Teams/Zoom/Meet URL, those should already be `https://` - check the full link was copied.
- If you want a `mailto:` or `tel:` link, put it in the event description instead of the URL field.
- If you're trying to attach a local file (`file://`), Apple Calendar handles event URLs inconsistently across clients; put the file path in the description instead.
