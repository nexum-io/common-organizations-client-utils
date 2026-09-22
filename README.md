# @nexum-io/common-organizations-client-utils

S2S HTTP client for [`core-organizations-ms`](https://github.com/nexum-io/core-organizations-ms) internal API.

Exports only:

- `CoreOrganizationsClient` — axios transport (no `process.env` inside the package)
- `CoreOrganizationsError` — transport error with `statusCode`, `errors`, `meta`

Product adapters and domain error maps stay in each MS.

## Install

```bash
npm install github:nexum-io/common-organizations-client-utils#v0.2.0
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
});
```

`baseUrl` must be the bare service origin (e.g. `http://core-organizations-ms:8092`). Do **not** suffix `/api` or `/api/v1` — the client appends `/api/v1/internal` itself.

## Methods

Method name = Core OpenAPI `operationId`. Routes are relative to `{baseUrl}/api/v1/internal`. Every call sends the product `api-key`; a `userSubject` argument is also sent as `X-User-Subject`. Methods resolve with Core's JSON body as is; HTTP failures reject with `CoreOrganizationsError`.

| Method | Route | Notes |
|--------|-------|-------|
| `listUserOrganizations(userSubject)` | `GET /users/{userSubject}/organizations` | |
| `createOrganization(userSubject, body)` | `POST /organizations` | |
| `getOrganization(userSubject, orgId)` | `GET /organizations/{orgId}` | |
| `updateOrganization(userSubject, orgId, body)` | `PATCH /organizations/{orgId}` | |
| `archiveOrganization(userSubject, orgId)` | `POST /organizations/{orgId}/archive` | |
| `listOrganizationMembers(userSubject, orgId)` | `GET /organizations/{orgId}/members` | |
| `updateOrganizationMember(userSubject, orgId, memberUserSubject, body)` | `PATCH /organizations/{orgId}/members/{memberUserSubject}` | |
| `getOrganizationMembership(userSubject, orgId, memberUserSubject)` | `GET /organizations/{orgId}/memberships/{memberUserSubject}` | |
| `authorizeOrganizationAction(userSubject, orgId, body)` | `POST /organizations/{orgId}/authorize` | |
| `listOrganizationInvites(userSubject, orgId)` | `GET /organizations/{orgId}/invites` | |
| `createOrganizationInvite(userSubject, orgId, body)` | `POST /organizations/{orgId}/invites` | |
| `revokeOrganizationInvite(userSubject, orgId, inviteId)` | `POST /organizations/{orgId}/invites/{inviteId}/revoke` | |
| `previewInvite(token)` | `GET /invites/{token}` | no `X-User-Subject` |
| `acceptInvite(userSubject, token)` | `POST /invites/{token}/accept` | |
| `listOrganizationApiKeys(userSubject, orgId)` | `GET /organizations/{orgId}/api-keys` | → `{ items }`, newest first, revoked included |
| `createOrganizationApiKey(userSubject, orgId, body)` | `POST /organizations/{orgId}/api-keys` | body `{ name, scopes, expiresAt }` → key + `fullKey`; never retried |
| `renameOrganizationApiKey(userSubject, orgId, keyId, body)` | `PATCH /organizations/{orgId}/api-keys/{keyId}` | body `{ name }` → key |
| `rotateOrganizationApiKey(userSubject, orgId, keyId, body)` | `POST /organizations/{orgId}/api-keys/{keyId}/rotate` | body `{ expiresAt }` → key + `fullKey`; never retried |
| `revokeOrganizationApiKey(userSubject, orgId, keyId)` | `POST /organizations/{orgId}/api-keys/{keyId}/revoke` | → key |
| `introspectApiKey(apiKey)` | `POST /api-keys/introspect` | body `{ apiKey }` → `{ keyId, organizationId, name, prefix, scopes, expiresAt, status }`; no `X-User-Subject` |

A key is `{ id, name, prefix, scopes, expiresAt, revokedAt, createdAt, createdBySubject, lastUsedAt, status }`, with `status` one of `active`, `expired`, `revoked`.

## Organization API keys

- `createOrganizationApiKey` and `rotateOrganizationApiKey` are **never retried**, whatever the instance `maxRetries`: each successful call mints a new secret, and a retry after a lost response could mint a second one nobody sees. A timeout does not prove the call failed — re-read `listOrganizationApiKeys` before trying again. All other methods keep the instance retry policy.
- `introspectApiKey(apiKey)` sends **no** `X-User-Subject` and is meant for the `partners` consumer (Core rejects other consumers). The presented key travels only in the request body, never in the path or query, which end up in error messages and retry logs. An unknown or revoked key rejects with `statusCode` 401 and `meta.coreCode` `UNAUTHORIZED`; an expired one with `API_KEY_EXPIRED`.
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
