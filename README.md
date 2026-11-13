# @nexum-io/common-organizations-client-utils

S2S HTTP client for [`core-organizations-ms`](https://github.com/nexum-io/core-organizations-ms) internal API.

Exports only:

- `CoreOrganizationsClient` — axios transport (no `process.env` inside the package)
- `CoreOrganizationsError` — transport error with `statusCode`, `errors`, `meta`

Product adapters and domain error maps stay in each MS.

## Install

```bash
npm install github:nexum-io/common-organizations-client-utils#v0.4.0
```

## Usage

```js
const {
  CoreOrganizationsClient,
  CoreOrganizationsError,
} = require('@nexum-io/common-organizations-client-utils');

const client = new CoreOrganizationsClient({
  baseUrl: process.env.CORE_ORGANIZATIONS_BASE_URL, // bare origin only
  apiKey: process.env.CORE_ORGANIZATIONS_API_KEY,
  logger,
  timeoutMs: Number(process.env.CORE_ORGANIZATIONS_HTTP_TIMEOUT_MS) || 30000,
  maxRetries: Number(process.env.CORE_ORGANIZATIONS_HTTP_MAX_RETRIES) || 2,
  retryBaseDelayMs: Number(process.env.CORE_ORGANIZATIONS_RETRY_BASE_DELAY_MS) || 250,
  // ARCH-005: required for user-scoped calls (Core hard-cut — no bare X-User-Subject)
  getDelegationJwt: async ({ userSubject }) => exchangeAccessForDelegation(userSubject),
});
```

`baseUrl` must be the bare service origin (e.g. `http://core-organizations-ms:8092`). Do **not** suffix `/api` or `/api/v1` — the client appends `/api/v1/internal` itself.

**v0.4.0 (ARCH-030):** every request also sends `x-correlation-id` and a fresh `x-request-id`. When the host app has `@nexum-io/common-observability-logging-package` installed, `x-correlation-id` is the AsyncLocalStorage `correlation_id`. Otherwise it is a new UUID. The observability package is an optional peer, not a hard dependency.

**v0.7.0 (DEV-1913):** every user-scoped method accepts an optional trailing `options` argument. `options.delegationJwt` (non-empty string) is sent as `X-Delegation-JWT` and takes precedence over the constructor `getDelegationJwt`; an empty or non-string value is ignored (falls back to the constructor resolver, else the call fails closed). Without `options` behaviour is unchanged from v0.6.0. Never log the token.

```js
// per-request delegation token (the caller's own), no constructor resolver needed
const members = await client.listOrganizationMembers(userSubject, orgId, {
  delegationJwt: req.headers['x-delegation-jwt'],
});
```

The forwarded delegation token must have been minted for this service's own api-key consumer: core-organizations-ms checks `payload.azp === productConsumer` (s2s-auth.js:126-131) and rejects tokens issued for another consumer.

`userSubject` must be non-empty. With a falsy `userSubject` the client emits no `X-Delegation-JWT`, even when `options.delegationJwt` is set, and core-organizations-ms answers 401 `auth.delegation_missing`.

Other accepted per-call options: `options.timeoutMs` (request timeout in ms, default is the constructor `timeoutMs`) and `options.maxRetries` (default is the constructor `maxRetries`). `createOrganizationApiKey` and `rotateOrganizationApiKey` always stay no-retry: a caller `maxRetries` is ignored there.

## Methods

Method name = Core OpenAPI `operationId`. Routes are relative to `{baseUrl}/api/v1/internal`. Every call sends the product `api-key`. User-scoped methods also send `X-Delegation-JWT` from `getDelegationJwt({ userSubject })` or per-call `options.delegationJwt` (path still uses the `userSubject` argument). Methods resolve with Core's JSON body as is; HTTP failures reject with `CoreOrganizationsError`.

| Method | Route | Notes |
|--------|-------|-------|
| `listUserOrganizations(userSubject, options?)` | `GET /users/{userSubject}/organizations` | |
| `createOrganization(userSubject, body, options?)` | `POST /organizations` | |
| `getOrganization(userSubject, orgId, options?)` | `GET /organizations/{orgId}` | |
| `updateOrganization(userSubject, orgId, body, options?)` | `PATCH /organizations/{orgId}` | |
| `archiveOrganization(userSubject, orgId, options?)` | `POST /organizations/{orgId}/archive` | |
| `listOrganizationMembers(userSubject, orgId, options?)` | `GET /organizations/{orgId}/members` | |
| `updateOrganizationMember(userSubject, orgId, memberUserSubject, body, options?)` | `PATCH /organizations/{orgId}/members/{memberUserSubject}` | |
| `getOrganizationMembership(userSubject, orgId, memberUserSubject, options?)` | `GET /organizations/{orgId}/memberships/{memberUserSubject}` | |
| `authorizeOrganizationAction(userSubject, orgId, body, options?)` | `POST /organizations/{orgId}/authorize` | |
| `listOrganizationInvites(userSubject, orgId, options?)` | `GET /organizations/{orgId}/invites` | |
| `createOrganizationInvite(userSubject, orgId, body, options?)` | `POST /organizations/{orgId}/invites` | |
| `revokeOrganizationInvite(userSubject, orgId, inviteId, options?)` | `POST /organizations/{orgId}/invites/{inviteId}/revoke` | |
| `previewInvite(token)` | `GET /invites/{token}` | no delegation header |
| `acceptInvite(userSubject, token, options?)` | `POST /invites/{token}/accept` | |
| `listOrganizationApiKeys(userSubject, orgId, options?)` | `GET /organizations/{orgId}/api-keys` | → `{ items }`, newest first, revoked included |
| `createOrganizationApiKey(userSubject, orgId, body, options?)` | `POST /organizations/{orgId}/api-keys` | body `{ name, scopes, expiresAt }` → key + `fullKey`; never retried |
| `renameOrganizationApiKey(userSubject, orgId, keyId, body, options?)` | `PATCH /organizations/{orgId}/api-keys/{keyId}` | body `{ name }` → key |
| `rotateOrganizationApiKey(userSubject, orgId, keyId, body, options?)` | `POST /organizations/{orgId}/api-keys/{keyId}/rotate` | body `{ expiresAt }` → key + `fullKey`; never retried |
| `revokeOrganizationApiKey(userSubject, orgId, keyId, options?)` | `POST /organizations/{orgId}/api-keys/{keyId}/revoke` | → key |
| `introspectApiKey(presentedKey)` | `POST /api-keys/introspect` | body `{ apiKey }` → `{ keyId, organizationId, name, prefix, scopes, expiresAt, status }`; no delegation header |
| `isActiveOrganizationMember(organizationId, userSubject, options?)` | `GET /organizations/{organizationId}/members/{userSubject}/membership` | → strict `boolean`; no delegation / subject header; `arbitrator` consumer |
| `listAdminOrganizations({ q, limit, cursor })` | `GET /admin/organizations` | → `{ items, nextCursor }`; no delegation header; `admin` consumer |

A key is `{ id, name, prefix, scopes, expiresAt, revokedAt, createdAt, createdBySubject, lastUsedAt, status }`, with `status` one of `active`, `expired`, `revoked`.

## Organization API keys

- `createOrganizationApiKey` and `rotateOrganizationApiKey` are **never retried**, whatever the instance `maxRetries`: each successful call mints a new secret, and a retry after a lost response could mint a second one nobody sees. A timeout does not prove the call failed — re-read `listOrganizationApiKeys` before trying again. All other methods keep the instance retry policy.
- `introspectApiKey(presentedKey)` sends **no** `X-Delegation-JWT` and is meant for the `partners` consumer. The presented key travels only in the request body (`{ apiKey }`), never in the path or query, which end up in error messages and retry logs. On success Core returns the key with `status: "active"`.
- `isActiveOrganizationMember(organizationId, userSubject, options?)` is the S2S membership check for the `arbitrator` consumer key. It sends **no** `X-Delegation-JWT` and no `X-User-Subject` (even if the constructor has `getDelegationJwt`); `timeoutMs` / `maxRetries` are honoured and GET retries on 429/5xx. Both arguments are `encodeURIComponent`-encoded; an empty or non-string argument throws a `CoreOrganizationsError` (400) before any HTTP call. Core wraps this route in a `{ data }` envelope (other routes return a bare body). The result is a strict boolean: `true` only for `{ data: { active: true } }`, `false` only for `{ data: { active: false } }` (non-member, unknown or archived org). Any other body throws `CoreOrganizationsError` (`statusCode` 502, `meta.malformedResponse: true`), as do 400/401/403/5xx. **Treat every thrown error as "deny"** (fail closed), never as `false`-and-continue or `true`.

  ```js
  try {
    const allowed = await client.isActiveOrganizationMember(organizationId, userSubject);
    if (!allowed) return deny();
  } catch (err) {
    return deny(); // fail closed on any error
  }
  ```
- `listAdminOrganizations({ q, limit, cursor })` sends **no** `X-Delegation-JWT` and is meant for the `admin` consumer (Platform Admin). Query params are optional; Core returns `{ items: [{ id, name, status, createdAt }], nextCursor }`.
- Introspect failures (`CoreOrganizationsError`):

  | `statusCode` | `meta.coreCode` | `errors` | Meaning |
  |---|---|---|---|
  | 401 | `UNAUTHORIZED` | `['api_key.invalid']` | Unknown, malformed or revoked key, or its organization is archived (not distinguished). |
  | 401 | `API_KEY_EXPIRED` | `['api_key.expired']` | Key exists but `expiresAt` has passed. |
  | 401 | `UNAUTHORIZED` | no `api_key.*` marker | The **caller's own** product `api-key` was rejected by Core (misconfiguration), not the presented key. |
  | 403 | `FORBIDDEN` | | The product `api-key` belongs to a consumer other than `partners`. |
  | 400 | `VALIDATION_FAILED` | | `apiKey` missing, empty or not a string. |

  Treat a 401 without an `api_key.*` marker, and any 403, as a dependency failure on your side, never as "the integrator's key is bad".
- `fullKey` (create and rotate responses only) is the plaintext secret, returned once. **Never log it**, nor a presented key or the `api-key` header — log `id` / `keyId` and `prefix` only.

## Consumer ENV

| Variable | Description |
|----------|-------------|
| `CORE_ORGANIZATIONS_BASE_URL` | Bare origin (canonical) |
| `CORE_ORGANIZATIONS_API_ENDPOINT` | Alias for `BASE_URL` (migration) |
| `CORE_ORGANIZATIONS_API_KEY` | Per-consumer `api-key` header |
| `CORE_ORGANIZATIONS_HTTP_TIMEOUT_MS` | default `30000` |
| `CORE_ORGANIZATIONS_HTTP_MAX_RETRIES` | default `2` |
| `CORE_ORGANIZATIONS_RETRY_BASE_DELAY_MS` | default `250` (linear backoff) |

## Contract

OpenAPI: `core-organizations-ms/docs/openapi/internal-api.openapi.yaml`

Cross-product: `core-organizations-ms/docs/cross-product/core-organizations-consumers.md`

## Develop

```bash
npm install
npm test
npm run ci:check
```
