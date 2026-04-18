# Google Chat Bridge — Architecture Notes

## Status: Phase 2 (Native AbelOS chat launched first)

The unified chat system is live in AbelOS. Google Chat two-way sync is the next phase.

## What's needed for Google Chat integration

1. **Google Workspace Admin**: Enable the Google Chat API
2. **Service Account**: Create in Google Cloud Console with domain-wide delegation
3. **Chat Bot**: Register as a Google Chat app (can be HTTP endpoint or Pub/Sub)
4. **Webhook URL**: AbelOS endpoint that receives incoming Google Chat events

## Two-way sync flow

### AbelOS → Google Chat
- When a builder sends a message in AbelOS chat, post it to a configured Google Chat space
- Use the Google Chat REST API: `POST https://chat.googleapis.com/v1/spaces/{space}/messages`
- Include builder name and company as context

### Google Chat → AbelOS
- Google Chat sends events to our webhook endpoint
- Event types: `MESSAGE` (new message), `ADDED_TO_SPACE`, `REMOVED_FROM_SPACE`
- Parse the event, find the matching conversation, create a Message record

## Environment Variables Needed

```env
GOOGLE_CHAT_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
GOOGLE_CHAT_WEBHOOK_SECRET=<verification token>
```

## API Endpoint

`POST /api/webhooks/google-chat` — receives events from Google Chat
`POST /api/ops/google-chat/send` — sends message to Google Chat space

## Mapping

Each Conversation can optionally store a `googleChatSpaceId` to link it to a Google Chat space.
When set, messages are synced both ways.

## Limitation

Google Chat API for bots requires the bot to be @mentioned or in a DM.
For space-level integration, need a Chat app with appropriate scopes.
