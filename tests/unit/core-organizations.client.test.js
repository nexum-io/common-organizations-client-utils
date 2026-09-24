jest.mock('axios');
const axios = require('axios');
const CoreOrganizationsClient = require('../../src/core-organizations.client');

describe('CoreOrganizationsClient', () => {
  const logger = { warn: jest.fn(), error: jest.fn() };
  const getDelegationJwt = jest.fn(async () => 'test-delegation-jwt');

  beforeEach(() => {
    jest.clearAllMocks();
    getDelegationJwt.mockResolvedValue('test-delegation-jwt');
    axios.get = jest.fn();
    axios.post = jest.fn();
    axios.patch = jest.fn();
  });

  test('rejects baseUrl pre-suffixed with /api', () => {
    expect(
      () => new CoreOrganizationsClient({
        baseUrl: 'http://core:8092/api',
        apiKey: 'k',
        logger,
      })
    ).toThrow(/bare service origin/);
  });

  test('createOrganization posts to /api/v1/internal/organizations with headers', async () => {
    axios.post.mockResolvedValue({ data: { id: 'org-1', name: 'Acme' } });
    const client = new CoreOrganizationsClient({
      baseUrl: 'http://core:8092',
      apiKey: 'secret',
      logger,
      getDelegationJwt,
    });
    const body = await client.createOrganization('user-1', { name: 'Acme' });
    expect(body.id).toBe('org-1');
    expect(getDelegationJwt).toHaveBeenCalledWith({ userSubject: 'user-1' });
    expect(axios.post).toHaveBeenCalledWith(
      'http://core:8092/api/v1/internal/organizations',
      { name: 'Acme' },
      expect.objectContaining({
        headers: expect.objectContaining({
          'api-key': 'secret',
          'X-Delegation-JWT': 'test-delegation-jwt',
        }),
      })
    );
    expect(axios.post.mock.calls[0][2].headers['X-User-Subject']).toBeUndefined();
  });

  test('user-scoped call without delegationJwt fails closed', async () => {
    const client = new CoreOrganizationsClient({
      baseUrl: 'http://core:8092',
      apiKey: 'secret',
      logger,
    });
    await expect(client.createOrganization('user-1', { name: 'Acme' }))
      .rejects.toThrow(/X-Delegation-JWT is required/);
  });

  test('wraps upstream error envelope into CoreOrganizationsError', async () => {
    const { CoreOrganizationsError } = require('../../src/core-organizations-error');
    axios.get.mockRejectedValue({
      response: {
        status: 404,
        data: { error: { code: 'NOT_FOUND', message: 'missing', errors: ['x'] } },
      },
    });
    const client = new CoreOrganizationsClient({
      baseUrl: 'http://core:8092',
      apiKey: 'secret',
      logger,
      maxRetries: 0,
      getDelegationJwt,
    });
    await expect(client.getOrganization('user-1', 'org-1')).rejects.toBeInstanceOf(
      CoreOrganizationsError
    );
  });

  describe('organization API keys', () => {
    const apiKeyDto = {
      id: 'key-1',
      name: 'HandyMan production',
      prefix: 'ab12cd34',
      scopes: ['escrow.read', 'escrow.create'],
      expiresAt: '2027-09-23T00:00:00.000Z',
      revokedAt: null,
      createdAt: '2026-09-23T00:00:00.000Z',
      createdBySubject: 'user-1',
      lastUsedAt: null,
      status: 'active',
    };

    const unavailable = {
      response: {
        status: 503,
        data: { error: { code: 'INTERNAL_ERROR', message: 'Service unavailable', errors: [] } },
      },
    };

    function buildClient(overrides = {}) {
      return new CoreOrganizationsClient({
        baseUrl: 'http://core:8092',
        apiKey: 'secret',
        logger,
        retryBaseDelayMs: 0,
        getDelegationJwt,
        ...overrides,
      });
    }

    const actingUserHeaders = expect.objectContaining({
      headers: expect.objectContaining({ 'api-key': 'secret', 'X-Delegation-JWT': 'test-delegation-jwt' }),
    });

    test('listOrganizationApiKeys GETs the org keys as the acting user and returns Core items', async () => {
      axios.get.mockResolvedValue({ data: { items: [apiKeyDto] } });

      const result = await buildClient().listOrganizationApiKeys('user-1', 'org-1');

      expect(result).toEqual({ items: [apiKeyDto] });
      expect(axios.get).toHaveBeenCalledWith(
        'http://core:8092/api/v1/internal/organizations/org-1/api-keys',
        actingUserHeaders
      );
    });

    test('createOrganizationApiKey POSTs name, scopes and expiresAt and returns the one-time fullKey', async () => {
      const created = { ...apiKeyDto, fullKey: 'nxm_ab12cd34_test-fixture-not-a-real-key' };
      axios.post.mockResolvedValue({ data: created });

      const result = await buildClient().createOrganizationApiKey('user-1', 'org-1', {
        name: 'HandyMan production',
        scopes: ['escrow.read', 'escrow.create'],
        expiresAt: '2027-09-23T00:00:00.000Z',
      });

      expect(result).toEqual(created);
      expect(axios.post).toHaveBeenCalledWith(
        'http://core:8092/api/v1/internal/organizations/org-1/api-keys',
        {
          name: 'HandyMan production',
          scopes: ['escrow.read', 'escrow.create'],
          expiresAt: '2027-09-23T00:00:00.000Z',
        },
        actingUserHeaders
      );
    });

    test('renameOrganizationApiKey PATCHes the key with the new name and returns the key', async () => {
      const renamed = { ...apiKeyDto, name: 'HandyMan staging' };
      axios.patch.mockResolvedValue({ data: renamed });

      const result = await buildClient().renameOrganizationApiKey('user-1', 'org-1', 'key-1', {
        name: 'HandyMan staging',
      });

      expect(result).toEqual(renamed);
      expect(axios.patch).toHaveBeenCalledWith(
        'http://core:8092/api/v1/internal/organizations/org-1/api-keys/key-1',
        { name: 'HandyMan staging' },
        actingUserHeaders
      );
    });

    test('rotateOrganizationApiKey POSTs the new expiresAt and returns the new one-time fullKey', async () => {
      const rotated = {
        ...apiKeyDto,
        prefix: 'ef56ab78',
        expiresAt: '2026-12-22T00:00:00.000Z',
        fullKey: 'nxm_ef56ab78_test-fixture-not-a-real-key',
      };
      axios.post.mockResolvedValue({ data: rotated });

      const result = await buildClient().rotateOrganizationApiKey('user-1', 'org-1', 'key-1', {
        expiresAt: '2026-12-22T00:00:00.000Z',
      });

      expect(result).toEqual(rotated);
      expect(axios.post).toHaveBeenCalledWith(
        'http://core:8092/api/v1/internal/organizations/org-1/api-keys/key-1/rotate',
        { expiresAt: '2026-12-22T00:00:00.000Z' },
        actingUserHeaders
      );
    });

    test('revokeOrganizationApiKey POSTs to the revoke action and returns the revoked key', async () => {
      const revoked = { ...apiKeyDto, revokedAt: '2026-09-24T10:00:00.000Z', status: 'revoked' };
      axios.post.mockResolvedValue({ data: revoked });

      const result = await buildClient().revokeOrganizationApiKey('user-1', 'org-1', 'key-1');

      expect(result).toEqual(revoked);
      expect(axios.post).toHaveBeenCalledWith(
        'http://core:8092/api/v1/internal/organizations/org-1/api-keys/key-1/revoke',
        {},
        actingUserHeaders
      );
    });

    test.each([
      [
        'listOrganizationApiKeys',
        'get',
        (client) => client.listOrganizationApiKeys('user-1', 'org/1'),
        'http://core:8092/api/v1/internal/organizations/org%2F1/api-keys',
      ],
      [
        'createOrganizationApiKey',
        'post',
        (client) => client.createOrganizationApiKey('user-1', 'org/1', {
          name: 'HandyMan production',
          scopes: ['escrow.read'],
          expiresAt: '2027-09-23T00:00:00.000Z',
        }),
        'http://core:8092/api/v1/internal/organizations/org%2F1/api-keys',
      ],
      [
        'renameOrganizationApiKey',
        'patch',
        (client) => client.renameOrganizationApiKey('user-1', 'org/1', '../key-1?x', {
          name: 'HandyMan staging',
        }),
        'http://core:8092/api/v1/internal/organizations/org%2F1/api-keys/..%2Fkey-1%3Fx',
      ],
      [
        'rotateOrganizationApiKey',
        'post',
        (client) => client.rotateOrganizationApiKey('user-1', 'org/1', '../key-1?x', {
          expiresAt: '2026-12-22T00:00:00.000Z',
        }),
        'http://core:8092/api/v1/internal/organizations/org%2F1/api-keys/..%2Fkey-1%3Fx/rotate',
      ],
      [
        'revokeOrganizationApiKey',
        'post',
        (client) => client.revokeOrganizationApiKey('user-1', 'org/1', '../key-1?x'),
        'http://core:8092/api/v1/internal/organizations/org%2F1/api-keys/..%2Fkey-1%3Fx/revoke',
      ],
    ])(
      '%s URI-encodes path params so they stay inside their segment',
      async (_method, verb, call, expectedUrl) => {
        axios[verb].mockResolvedValue({ data: {} });

        await call(buildClient());

        expect(axios[verb].mock.calls[0][0]).toBe(expectedUrl);
      }
    );

    describe.each([
      [
        'createOrganizationApiKey',
        (client) => client.createOrganizationApiKey('user-1', 'org-1', {
          name: 'HandyMan production',
          scopes: ['escrow.read'],
          expiresAt: '2027-09-23T00:00:00.000Z',
        }),
      ],
      [
        'rotateOrganizationApiKey',
        (client) => client.rotateOrganizationApiKey('user-1', 'org-1', 'key-1', {
          expiresAt: '2026-12-22T00:00:00.000Z',
        }),
      ],
    ])('%s is never retried, so a lost response cannot mint a second secret', (_method, issueSecret) => {
      test.each([
        ['a 503', unavailable, 503],
        ['a 429', { response: { status: 429, data: 'Too many requests, please try again later.' } }, 429],
        ['a timeout', Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' }), 502],
      ])('fails fast on %s even when the instance allows retries', async (_failure, rejection, statusCode) => {
        axios.post.mockRejectedValue(rejection);

        await expect(issueSecret(buildClient({ maxRetries: 2 }))).rejects.toMatchObject({
          name: 'CoreOrganizationsError',
          statusCode,
        });
        expect(axios.post).toHaveBeenCalledTimes(1);
        expect(logger.warn).not.toHaveBeenCalled();
      });
    });

    test('listOrganizationApiKeys keeps the instance retry policy and recovers from a transient 503', async () => {
      axios.get
        .mockRejectedValueOnce(unavailable)
        .mockResolvedValueOnce({ data: { items: [apiKeyDto] } });

      const result = await buildClient({ maxRetries: 2 }).listOrganizationApiKeys('user-1', 'org-1');

      expect(result).toEqual({ items: [apiKeyDto] });
      expect(axios.get).toHaveBeenCalledTimes(2);
    });

    describe('introspectApiKey', () => {
      const presentedKey = 'nxm_ab12cd34_test-fixture-not-a-real-key';

      test('POSTs the presented key in the body with only the product api-key (no X-Delegation-JWT)', async () => {
        const introspection = {
          keyId: 'key-1',
          organizationId: 'org-1',
          name: 'HandyMan production',
          prefix: 'ab12cd34',
          scopes: ['escrow.read', 'escrow.create'],
          expiresAt: '2027-09-23T00:00:00.000Z',
          status: 'active',
        };
        axios.post.mockResolvedValue({ data: introspection });

        const result = await buildClient().introspectApiKey(presentedKey);

        expect(result).toEqual(introspection);
        expect(axios.post).toHaveBeenCalledTimes(1);
        const [url, body, config] = axios.post.mock.calls[0];
        expect(url).toBe('http://core:8092/api/v1/internal/api-keys/introspect');
        expect(body).toEqual({ apiKey: presentedKey });
        expect(config.headers).toEqual({ 'Content-Type': 'application/json', 'api-key': 'secret' });
        expect(config.params).toBeUndefined();
      });

      test('keeps the presented key out of the thrown error and the retry log', async () => {
        axios.post.mockRejectedValue(unavailable);

        const error = await buildClient({ maxRetries: 1 })
          .introspectApiKey(presentedKey)
          .catch((rejection) => rejection);

        expect(error).toMatchObject({ name: 'CoreOrganizationsError', statusCode: 503 });
        expect(axios.post).toHaveBeenCalledTimes(2);
        expect(logger.warn).toHaveBeenCalledTimes(1);
        const leakSurface = JSON.stringify([
          error.message,
          error.errors,
          error.meta,
          logger.warn.mock.calls,
        ]);
        expect(leakSurface).not.toContain(presentedKey);
      });

      test('surfaces a definitive Core 401 with its api_key marker and does not retry it', async () => {
        axios.post.mockRejectedValue({
          response: {
            status: 401,
            data: {
              error: { code: 'API_KEY_EXPIRED', message: 'API key expired', errors: ['api_key.expired'] },
            },
          },
        });

        await expect(buildClient({ maxRetries: 2 }).introspectApiKey(presentedKey)).rejects.toMatchObject({
          name: 'CoreOrganizationsError',
          statusCode: 401,
          errors: ['api_key.expired'],
          meta: { coreCode: 'API_KEY_EXPIRED' },
        });
        expect(axios.post).toHaveBeenCalledTimes(1);
      });
    });
  });
});
