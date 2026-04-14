# Hyphen SPConnect — Setup Values for Outbound Auth

This document contains the exact values to give Hyphen Solutions so they can
authenticate outbound calls to Abel's SPConnect endpoints. Send this to the
Hyphen onboarding team along with the client credentials minted from
`/admin/hyphen`.

Auth model: **OAuth 2.0, grant_type = client_credentials** (per Hyphen's
"OAuth 2.0 Client Request Documentation"). Abel hosts the OAuth provider;
Hyphen is the OAuth client.

---

## 1. OAuth Token URI

The endpoint Hyphen calls to retrieve a Bearer token before sending order data.

| Field | Value |
|---|---|
| URI (Production) | `https://app.abellumber.com/api/hyphen/oauth/token` |
| HTTP Method | `POST` |

---

## 2. Client Credentials

These are minted in the Abel admin console at `/admin/hyphen` → "Mint New
Credential". The plaintext secret is shown **exactly once** at mint time —
copy it immediately. We will deliver these values via a secure channel
(1Password, encrypted email, or signed Slack DM — not in the same message as
this document).

| Field | Value |
|---|---|
| Client ID | _(provided separately)_ |
| Client Secret | _(provided separately, shown once)_ |

Hyphen base64-encodes `client_id:client_secret` and sends it in the
`Authorization: Basic …` header. Abel's token endpoint also accepts the
credentials in the request body (form-encoded or JSON) for compatibility.

---

## 3. Payload for OAuth Request

| Property | Required? | Value |
|---|---|---|
| `grant_type` | required | `client_credentials` |
| `scope` | optional | `spconnect` |

Example request body:

```json
{
  "grant_type": "client_credentials",
  "scope": "spconnect"
}
```

---

## 4. Content Type

| Field | Value |
|---|---|
| Content-Type (preferred) | `application/json` |
| Content-Type (also accepted) | `application/x-www-form-urlencoded` |

---

## 5. Token Structure (what Abel returns)

```json
{
  "token_type": "Bearer",
  "access_token": "<opaque token string>",
  "expires_in": 3600,
  "scope": "spconnect"
}
```

| Property | Value |
|---|---|
| `token_type` | `Bearer` |
| `access_token` | Opaque string. Hyphen passes this back as `Authorization: Bearer <access_token>`. |
| `expires_in` | `3600` (seconds — 1 hour). Hyphen should refresh before expiry. |
| `scope` | `spconnect` |

Response headers include `Cache-Control: no-store` and `Pragma: no-cache` per
RFC 6749 §5.1.

---

## 6. URIs for Sending Order Data

The endpoints Hyphen calls with `Authorization: Bearer <access_token>`.

| Resource | Method | URI |
|---|---|---|
| Orders (SPConnect API §2) | `POST` | `https://app.abellumber.com/api/hyphen/orders` |
| Change Orders (SPConnect API §3) | `POST` | `https://app.abellumber.com/api/hyphen/changeOrders` |

Both endpoints accept the SPConnect v13 order envelope as `application/json`
and reply with the SPConnect `messageAcknowledgment` shape:

```json
{
  "message": "Order received and queued for processing",
  "additionalInfo": {
    "eventId": "hyphenev_…",
    "builderOrderNumber": "…",
    "externalId": "…",
    "status": "RECEIVED"
  }
}
```

Error responses use the SPConnect error shape:

```json
{
  "correlationId": "…",
  "errorText": "…",
  "details": null
}
```

| HTTP Status | Meaning |
|---|---|
| `200` | Order accepted and queued |
| `400` | Invalid JSON or missing required fields |
| `401` | Missing or invalid Bearer token (refresh and retry) |
| `500` | Abel-side processing failure (Hyphen should retry per their backoff policy) |

---

## 7. Additional Headers

Abel's SPConnect surface does **not** require any additional headers beyond
the standard `Authorization` and `Content-Type`. Specifically:

- No `secret_key`
- No `product_id`
- No custom HMAC signature header

If Hyphen's onboarding form requires a value in the "Additional Headers"
field, leave it blank or send an empty JSON object `{}`.

---

## 8. Error Handling Contract

| Scenario | Abel Response | Hyphen Action |
|---|---|---|
| Token expired | `401` with `WWW-Authenticate: Bearer error="invalid_token"` | Re-mint via `/api/hyphen/oauth/token` and retry |
| Credential revoked | `401` | Contact Abel ops — credential needs to be reissued |
| Body is malformed JSON | `400` with `errorText` | Do not retry; log and escalate |
| Abel internal failure | `500` with `correlationId` | Retry per Hyphen backoff. Reference `correlationId` in any escalation |

---

## 9. Environments

| Environment | Token URI | Order URI | Change Order URI |
|---|---|---|---|
| Production | `https://app.abellumber.com/api/hyphen/oauth/token` | `https://app.abellumber.com/api/hyphen/orders` | `https://app.abellumber.com/api/hyphen/changeOrders` |
| UAT (TBD) | — | — | — |

A separate UAT host is not yet provisioned. For Phase 1 we will use a
dedicated set of credentials labeled "Hyphen UAT" against production with a
test builder code so Hyphen's UAT traffic lands in `HyphenOrderEvent` but does
not commit to live POs until the Phase 2 mapper is enabled.

---

## 10. Operational Contact

| Topic | Contact |
|---|---|
| Credential rotation, revocation, ops issues | Nate Barrett — n.barrett@abellumber.com |
| API behavior, mapping questions | Nate Barrett — n.barrett@abellumber.com |
| Outage escalation | Same — until on-call rotation is staffed |

---

## Internal Notes (Abel-only)

- Credentials live in `HyphenCredential` (sha256-hashed secret, status enum
  ACTIVE/REVOKED).
- Issued tokens live in `HyphenAccessToken` (sha256-hashed token, 1h TTL).
- Inbound order envelopes are persisted to `HyphenOrderEvent` for replay and
  audit before Phase 2 mapping is enabled.
- Mint, list, and revoke flows are at `/admin/hyphen`. All credential
  lifecycle events are audited via `audit()` with severity `WARN` (mint) or
  `CRITICAL` (revoke).
- Phase 2 work: SPConnect → Abel Order schema mapper, then enable Phase 3
  outbound (`orderResponse`, `advanceShipmentNotice`).
