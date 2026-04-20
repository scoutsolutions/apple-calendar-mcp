# Teams, Zoom, and Meet Links

This is the most common question this MCP gets, so it deserves its own page. The short version: this MCP cannot provision new Teams/Zoom/Meet meeting URLs. It can store an existing one. If you need a fresh meeting URL as part of creating an event, use your calendar platform's native tool (Outlook for Teams, Google Calendar for Meet) or their API-backed MCP.

## What this MCP CAN do

- Read events that already have Teams/Zoom/Meet URLs (the URL shows up in `get-event` output)
- Create or update an event with a pasted URL from another source. Example:

```
create-event \
  calendarName="Work" \
  summary="Product sync" \
  startDate="April 22, 2026 2:00 PM" \
  endDate="April 22, 2026 2:30 PM" \
  url="https://zoom.us/j/123456789"
```

If the URL already exists (you scheduled the Zoom separately, or got the Teams link from a colleague), you can paste it here.

## What this MCP CANNOT do

- Provision a new Teams meeting resource. Teams meetings are a Microsoft Graph API concept, not a calendar entry field. The meeting has its own server-side state (dial-in numbers, lobby settings, Recording permissions, etc.) that only the Graph API can create.
- Create a Zoom meeting. Same story with Zoom's API.
- Generate a Google Meet link. Google Calendar's API has a `conferenceDataVersion` parameter that tells Google to auto-create a Meet link; AppleScript has no equivalent.

Even if you paste a Teams URL into the `url` field, the event will not have a Teams meeting behind it - you're storing a display URL, nothing more. The URL works if you clicked "copy link" on a real meeting that someone else provisioned.

## Why this tradeoff exists

Apple Calendar is a unified local view across all your synced accounts. Its value in this MCP is that it reads events from iCloud + Exchange + Google + subscribed calendars without needing separate credentials for each service.

Making the write path cross-provider (so it could create a real Teams meeting on an Exchange account AND a real Meet link on a Google account AND a Zoom link via the Zoom API) would require:
- Credentials for each service
- Different code paths per account type
- Much larger security surface area

That's out of scope for v0.2.0 and probably forever. The simple model - local events only, with optional pasted URLs - is intentional.

## Recommended workflow

### For Teams meetings

Use Outlook (desktop or web). Outlook provisions the Teams meeting when you create the event. Alternatively, a Microsoft Graph MCP can do it via API.

After the event exists, this MCP can query and modify it like any other calendar entry (move the time, update the description, etc.). It just can't create it with a fresh Teams link.

### For Google Meet

Use Google Calendar web or mobile. The "Add Google Meet video conferencing" option generates the link at create time. Or use a Google Calendar API MCP.

### For Zoom

Schedule the meeting in the Zoom web portal or app. Zoom returns a meeting URL. Pass that URL to this MCP's `create-event` call via the `url` field.

## What if my invite has a Teams link but my MCP-created event doesn't?

That's expected. The invitee's Teams link lives on their event (they created it, their Outlook provisioned the Teams resource on their Exchange server). When you accept the invite, your local calendar gets a copy of that event WITH the URL attached. So:

- Events you accepted via `respond-to-invitation`: keep the Teams link that came with the invite. It works.
- Events you created yourself via `create-event`: no Teams link unless you pasted one. Use a Graph MCP or Outlook to add one.
