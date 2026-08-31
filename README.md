# @nexum-io/common-organizations-client-utils

S2S HTTP client for [`core-organizations-ms`](https://github.com/nexum-io/core-organizations-ms) internal API.

Exports only:

- `CoreOrganizationsClient` — axios transport (no `process.env` inside the package)
- `CoreOrganizationsError` — transport error with `statusCode`, `errors`, `meta`

Product adapters and domain error maps stay in each MS.

## Install

```bash
npm install github:nexum-io/common-organizations-client-utils#v0.1.0
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
