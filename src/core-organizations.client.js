const axios = require('axios');

const { CoreOrganizationsError } = require('./core-organizations-error');
const { withRetry } = require('./with-retry');

const BARE_ORIGIN_TRAP_RE = /\/api(\/v\d+)?\/?$/;

/**
 * HTTP transport to core-organizations-ms internal API.
 * Contract: core-organizations-ms/docs/openapi/internal-api.openapi.yaml
 *
 * Trust-boundary: constructor reads NO process.env — consumers resolve
 * config → constructor args. `baseUrl` is bare origin only; this client
 * appends `/api/v1/internal` once.
 */
class CoreOrganizationsClient {
  constructor({
    baseUrl,
    apiKey,
    logger,
    timeoutMs = 30000,
    maxRetries = 2,
    retryBaseDelayMs = 250,
    apiPath = '/api/v1/internal',
  } = {}) {
    const resolvedBaseUrl = (baseUrl ?? '').trim().replace(/\/+$/, '');
    const resolvedApiKey = apiKey ?? null;

    if (!logger) {
      throw new Error('Logger is required for CoreOrganizationsClient');
    }

    if (resolvedBaseUrl && BARE_ORIGIN_TRAP_RE.test(resolvedBaseUrl)) {
      throw new Error(
        `Core organizations client baseUrl must be the bare service origin, not pre-suffixed with `
        + `/api or /api/vN (got "${resolvedBaseUrl}") — this client appends `
        + `"${apiPath}" itself`
      );
    }

    this.logger = logger;
    this.baseUrl = resolvedBaseUrl;
    this.apiKey = resolvedApiKey;
    this.enabled = Boolean(resolvedBaseUrl && resolvedApiKey);
    this.apiRoot = this.enabled ? `${resolvedBaseUrl}${apiPath}` : null;
    this.defaultTimeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.retryBaseDelayMs = retryBaseDelayMs;
  }

  #assertEnabled() {
    if (!this.enabled) {
      throw new Error(
        'Core organizations client is not configured '
        + '(CORE_ORGANIZATIONS_BASE_URL|CORE_ORGANIZATIONS_API_ENDPOINT / CORE_ORGANIZATIONS_API_KEY)'
      );
    }
  }

  #headers(userSubject) {
    const headers = {
      'Content-Type': 'application/json',
      'api-key': this.apiKey,
    };
    if (userSubject) {
      headers['X-User-Subject'] = userSubject;
    }
    return headers;
  }

  #unwrapResponse(response) {
    return response.data;
  }

  #wrapError(error, method, path) {
    const response = error.response;
    const envelope = response?.data?.error;
    const statusCode = response?.status ?? 502;
    const fallbackMessage = envelope?.message ?? error.message ?? 'Core organizations request failed';
    const details = Array.isArray(envelope?.errors) && envelope.errors.length > 0
      ? envelope.errors
      : [fallbackMessage];

    return new CoreOrganizationsError(
      `Core organizations ${method} ${path} failed (${statusCode}): ${fallbackMessage}`,
      statusCode,
      details,
      {
        coreCode: envelope?.code ?? null,
        coreMessage: envelope?.message ?? error.message ?? null,
        noResponse: !response,
      }
    );
  }

  async #withRetry(method, path, requestFn, { maxRetries = this.maxRetries } = {}) {
    return withRetry(
      async () => {
        try {
          return await requestFn();
        } catch (error) {
          throw this.#wrapError(error, method, path);
        }
      },
      {
        maxRetries,
        baseDelay: this.retryBaseDelayMs,
        shouldRetry: (error) => error.statusCode === 429 || error.statusCode >= 500,
        onRetry: (attempt, error, delayMs) => {
          this.logger.warn('Core organizations HTTP request retry', {
            context: {
              method,
              path,
              attempt,
              delayMs,
              statusCode: error.statusCode,
              message: error.message,
            },
          });
        },
      }
    );
  }

  async #request(method, path, { userSubject, body, params, options = {} } = {}) {
    this.#assertEnabled();
    const timeout = options.timeoutMs ?? this.defaultTimeoutMs;
    const maxRetries = options.maxRetries ?? this.maxRetries;
    const url = `${this.apiRoot}${path}`;
    const config = {
      headers: this.#headers(userSubject),
      timeout,
      params,
      validateStatus: (status) => status >= 200 && status < 300,
    };

    return this.#withRetry(method, path, () => {
      const promise = method === 'GET'
        ? axios.get(url, config)
        : method === 'POST'
          ? axios.post(url, body ?? {}, config)
          : axios.patch(url, body ?? {}, config);
      return promise.then((response) => this.#unwrapResponse(response));
    }, { maxRetries });
  }

  listUserOrganizations(userSubject) {
    const encoded = encodeURIComponent(userSubject);
    return this.#request('GET', `/users/${encoded}/organizations`, { userSubject });
  }

  createOrganization(userSubject, body) {
    return this.#request('POST', '/organizations', { userSubject, body });
  }

  getOrganization(userSubject, orgId) {
    return this.#request('GET', `/organizations/${orgId}`, { userSubject });
  }

  updateOrganization(userSubject, orgId, body) {
    return this.#request('PATCH', `/organizations/${orgId}`, { userSubject, body });
  }

  archiveOrganization(userSubject, orgId) {
    return this.#request('POST', `/organizations/${orgId}/archive`, { userSubject, body: {} });
  }

  listOrganizationMembers(userSubject, orgId) {
    return this.#request('GET', `/organizations/${orgId}/members`, { userSubject });
  }

  updateOrganizationMember(userSubject, orgId, memberUserSubject, body) {
    const encoded = encodeURIComponent(memberUserSubject);
    return this.#request('PATCH', `/organizations/${orgId}/members/${encoded}`, {
      userSubject,
      body,
    });
  }

  getOrganizationMembership(userSubject, orgId, memberUserSubject) {
    const encoded = encodeURIComponent(memberUserSubject);
    return this.#request('GET', `/organizations/${orgId}/memberships/${encoded}`, { userSubject });
  }

  authorizeOrganizationAction(userSubject, orgId, body) {
    return this.#request('POST', `/organizations/${orgId}/authorize`, { userSubject, body });
  }

  listOrganizationInvites(userSubject, orgId) {
    return this.#request('GET', `/organizations/${orgId}/invites`, { userSubject });
  }

  createOrganizationInvite(userSubject, orgId, body) {
    return this.#request('POST', `/organizations/${orgId}/invites`, { userSubject, body });
  }

  revokeOrganizationInvite(userSubject, orgId, inviteId) {
    return this.#request('POST', `/organizations/${orgId}/invites/${inviteId}/revoke`, {
      userSubject,
      body: {},
    });
  }

  previewInvite(token) {
    const encoded = encodeURIComponent(token);
    return this.#request('GET', `/invites/${encoded}`, {});
  }

  acceptInvite(userSubject, token) {
    const encoded = encodeURIComponent(token);
    return this.#request('POST', `/invites/${encoded}/accept`, { userSubject, body: {} });
  }
}

module.exports = CoreOrganizationsClient;
