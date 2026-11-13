jest.mock('axios');
jest.mock('@nexum-io/common-observability-logging-package', () => {
  const { AsyncLocalStorage } = require('async_hooks');
  const als = new AsyncLocalStorage();
  return {
    getCorrelationContext: () => als.getStore() || {},
    runWithCorrelation: (context, fn) => als.run({ ...(als.getStore() || {}), ...context }, fn),
  };
}, { virtual: true });
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
        expect(config.headers).toEqual(expect.objectContaining({
          'Content-Type': 'application/json',
          'api-key': 'secret',
        }));
        expect(config.headers['X-Delegation-JWT']).toBeUndefined();
        expect(config.headers['x-correlation-id']).toEqual(expect.any(String));
        expect(config.headers['x-request-id']).toEqual(expect.any(String));
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

  describe('listAdminOrganizations', () => {
    test('GETs /admin/organizations without delegation', async () => {
      axios.get.mockResolvedValue({ data: { items: [], nextCursor: null } });
      const client = new CoreOrganizationsClient({
        baseUrl: 'http://core:8092',
        apiKey: 'secret',
        logger,
        getDelegationJwt,
      });

      await client.listAdminOrganizations({ q: 'Acme', limit: 20, cursor: 'abc' });

      expect(axios.get).toHaveBeenCalledWith(
        'http://core:8092/api/v1/internal/admin/organizations',
        expect.objectContaining({
          params: { q: 'Acme', limit: 20, cursor: 'abc' },
          headers: expect.objectContaining({ 'api-key': 'secret' }),
        }),
      );
      expect(axios.get.mock.calls[0][1].headers['X-Delegation-JWT']).toBeUndefined();
      expect(getDelegationJwt).not.toHaveBeenCalled();
    });
  });

  describe('admin organization get and arbitration patch', () => {
    test('GETs one organization without delegation', async () => {
      axios.get.mockResolvedValue({ data: { id: 'org-1', arbitrationEnabled: false } });
      const client = new CoreOrganizationsClient({
        baseUrl: 'http://core:8092',
        apiKey: 'secret',
        logger,
        getDelegationJwt,
      });

      await client.getAdminOrganization('org-1');

      expect(axios.get).toHaveBeenCalledWith(
        'http://core:8092/api/v1/internal/admin/organizations/org-1',
        expect.objectContaining({
          headers: expect.objectContaining({ 'api-key': 'secret' }),
        }),
      );
      expect(axios.get.mock.calls[0][1].headers['X-Delegation-JWT']).toBeUndefined();
    });

    test('PATCHes arbitrationEnabled without delegation', async () => {
      axios.patch.mockResolvedValue({ data: { id: 'org-1', arbitrationEnabled: true } });
      const client = new CoreOrganizationsClient({
        baseUrl: 'http://core:8092',
        apiKey: 'secret',
        logger,
      });

      await client.patchAdminOrganizationArbitration('org-1', true);

      expect(axios.patch).toHaveBeenCalledWith(
        'http://core:8092/api/v1/internal/admin/organizations/org-1',
        { arbitrationEnabled: true },
        expect.objectContaining({
          headers: expect.objectContaining({ 'api-key': 'secret' }),
        }),
      );
    });
  });

  test('sends the same correlation id and a new request id on each call', async () => {
    const { runWithCorrelation } = require('@nexum-io/common-observability-logging-package');
    axios.get.mockResolvedValue({ data: { token: 'invite' } });
    const client = new CoreOrganizationsClient({
      baseUrl: 'http://core:8092',
      apiKey: 'secret',
      logger,
    });

    await runWithCorrelation({ correlation_id: 'corr-orgs' }, async () => {
      await client.previewInvite('tok-1');
      await client.previewInvite('tok-2');
    });

    const first = axios.get.mock.calls[0][1].headers;
    const second = axios.get.mock.calls[1][1].headers;
    expect(first['x-correlation-id']).toBe('corr-orgs');
    expect(second['x-correlation-id']).toBe('corr-orgs');
    expect(first['x-request-id']).not.toBe(second['x-request-id']);
    expect(first['api-key']).toBe('secret');
  });

  describe('per-call options.delegationJwt', () => {
    const make = (extra = {}) => new CoreOrganizationsClient({
      baseUrl: 'http://core:8092',
      apiKey: 'secret',
      logger,
      ...extra,
    });

    test.each([
      ['listOrganizationMembers', (c, o) => c.listOrganizationMembers('user-1', 'org-1', o)],
      ['getOrganization', (c, o) => c.getOrganization('user-1', 'org-1', o)],
    ])('%s sends per-call delegationJwt as X-Delegation-JWT', async (_name, call) => {
      axios.get.mockResolvedValue({ data: {} });
      await call(make(), { delegationJwt: 'per-call-jwt' });
      expect(axios.get.mock.calls[0][1].headers['X-Delegation-JWT']).toBe('per-call-jwt');
    });

    test.each([
      ['listOrganizationMembers', (c, o) => c.listOrganizationMembers('user-1', 'org-1', o)],
      ['getOrganization', (c, o) => c.getOrganization('user-1', 'org-1', o)],
    ])('%s: per-call wins over constructor getDelegationJwt', async (_name, call) => {
      axios.get.mockResolvedValue({ data: {} });
      await call(make({ getDelegationJwt }), { delegationJwt: 'per-call-jwt' });
      expect(axios.get.mock.calls[0][1].headers['X-Delegation-JWT']).toBe('per-call-jwt');
      expect(getDelegationJwt).not.toHaveBeenCalled();
    });

    test.each([
      ['listOrganizationMembers', (c, o) => c.listOrganizationMembers('user-1', 'org-1', o)],
      ['getOrganization', (c, o) => c.getOrganization('user-1', 'org-1', o)],
    ])('%s without option keeps constructor behaviour', async (_name, call) => {
      axios.get.mockResolvedValue({ data: {} });
      await call(make({ getDelegationJwt }));
      expect(axios.get.mock.calls[0][1].headers['X-Delegation-JWT']).toBe('test-delegation-jwt');
    });

    test.each([
      ['listOrganizationMembers', (c, o) => c.listOrganizationMembers('user-1', 'org-1', o)],
      ['getOrganization', (c, o) => c.getOrganization('user-1', 'org-1', o)],
    ])('%s: empty / non-string option falls back and never sends a bogus header', async (_name, call) => {
      axios.get.mockResolvedValue({ data: {} });
      for (const bad of ['', '   ', 123, null, {}]) {
        axios.get.mockClear();
        await call(make({ getDelegationJwt }), { delegationJwt: bad });
        expect(axios.get.mock.calls[0][1].headers['X-Delegation-JWT']).toBe('test-delegation-jwt');
      }
      await expect(call(make(), { delegationJwt: '' })).rejects.toThrow(/X-Delegation-JWT is required/);
    });

    test.each([
      ['listUserOrganizations', (c, o) => c.listUserOrganizations('user-1', o), 'get'],
      ['createOrganization', (c, o) => c.createOrganization('user-1', {}, o), 'post'],
      ['updateOrganization', (c, o) => c.updateOrganization('user-1', 'org-1', {}, o), 'patch'],
      ['archiveOrganization', (c, o) => c.archiveOrganization('user-1', 'org-1', o), 'post'],
      ['updateOrganizationMember', (c, o) => c.updateOrganizationMember('user-1', 'org-1', 'm-1', {}, o), 'patch'],
      ['getOrganizationMembership', (c, o) => c.getOrganizationMembership('user-1', 'org-1', 'm-1', o), 'get'],
      ['authorizeOrganizationAction', (c, o) => c.authorizeOrganizationAction('user-1', 'org-1', {}, o), 'post'],
      ['listOrganizationInvites', (c, o) => c.listOrganizationInvites('user-1', 'org-1', o), 'get'],
      ['createOrganizationInvite', (c, o) => c.createOrganizationInvite('user-1', 'org-1', {}, o), 'post'],
      ['revokeOrganizationInvite', (c, o) => c.revokeOrganizationInvite('user-1', 'org-1', 'inv-1', o), 'post'],
      ['acceptInvite', (c, o) => c.acceptInvite('user-1', 'tok', o), 'post'],
      ['listOrganizationApiKeys', (c, o) => c.listOrganizationApiKeys('user-1', 'org-1', o), 'get'],
      ['createOrganizationApiKey', (c, o) => c.createOrganizationApiKey('user-1', 'org-1', {}, o), 'post'],
      ['renameOrganizationApiKey', (c, o) => c.renameOrganizationApiKey('user-1', 'org-1', 'k-1', {}, o), 'patch'],
      ['rotateOrganizationApiKey', (c, o) => c.rotateOrganizationApiKey('user-1', 'org-1', 'k-1', {}, o), 'post'],
      ['revokeOrganizationApiKey', (c, o) => c.revokeOrganizationApiKey('user-1', 'org-1', 'k-1', o), 'post'],
    ])('%s accepts per-call delegationJwt', async (_name, call, verb) => {
      axios[verb].mockResolvedValue({ data: {} });
      await call(make(), { delegationJwt: 'per-call-jwt' });
      const cfg = axios[verb].mock.calls[0][verb === 'get' ? 1 : 2];
      expect(cfg.headers['X-Delegation-JWT']).toBe('per-call-jwt');
    });

    test('no-retry key minting stays no-retry when options are passed', async () => {
      axios.post.mockRejectedValue({ response: { status: 503, data: {} }, message: 'x' });
      await expect(
        make({ maxRetries: 2, retryBaseDelayMs: 1 })
          .createOrganizationApiKey('user-1', 'org-1', {}, { delegationJwt: 'per-call-jwt', maxRetries: 5 })
      ).rejects.toThrow();
      expect(axios.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('isActiveOrganizationMember', () => {
    const { CoreOrganizationsError } = require('../../src/core-organizations-error');
    const BASE = 'http://core:8092/api/v1/internal/organizations';
    const buildClient = (extra = {}) => new CoreOrganizationsClient({
      baseUrl: 'http://core:8092',
      apiKey: 'secret',
      logger,
      retryBaseDelayMs: 1,
      ...extra,
    });

    test('returns true for { data: { active: true } }', async () => {
      axios.get.mockResolvedValue({ data: { data: { active: true } } });
      await expect(buildClient().isActiveOrganizationMember('org-1', 'user-1')).resolves.toBe(true);
      expect(axios.get.mock.calls[0][0]).toBe(`${BASE}/org-1/members/user-1/membership`);
    });

    test('returns false for { data: { active: false } }', async () => {
      axios.get.mockResolvedValue({ data: { data: { active: false } } });
      await expect(buildClient().isActiveOrganizationMember('org-1', 'user-1')).resolves.toBe(false);
    });

    test.each([
      ['empty object', {}],
      ['data without active', { data: {} }],
      ['string active', { data: { active: 'true' } }],
      ['numeric active', { data: { active: 1 } }],
      ['null data', { data: null }],
      ['envelope-less', { active: true }],
      ['array', []],
      ['array data', { data: [{ active: true }] }],
      ['null body', null],
      ['empty body', ''],
      ['undefined body', undefined],
    ])('malformed body (%s) throws CoreOrganizationsError, never a boolean', async (_name, body) => {
      axios.get.mockResolvedValue({ data: body });
      const err = await buildClient().isActiveOrganizationMember('org-1', 'user-1').catch((e) => e);
      expect(err).toBeInstanceOf(CoreOrganizationsError);
      expect(err.statusCode).toBe(502);
      expect(err.meta.malformedResponse).toBe(true);
    });

    test.each([
      ['../x', '..%2Fx'],
      ['a/b', 'a%2Fb'],
      ['a?b=1', 'a%3Fb%3D1'],
      ['a#b', 'a%23b'],
      ['a b', 'a%20b'],
      ['%2f', '%252f'],
    ])('encodes %j as a single path segment for both arguments', async (raw, encoded) => {
      axios.get.mockResolvedValue({ data: { data: { active: true } } });
      await buildClient().isActiveOrganizationMember(raw, raw);
      expect(axios.get.mock.calls[0][0]).toBe(`${BASE}/${encoded}/members/${encoded}/membership`);
    });

    test('sends api-key and trace headers only: no delegation JWT, no subject header', async () => {
      axios.get.mockResolvedValue({ data: { data: { active: true } } });
      await buildClient({ getDelegationJwt }).isActiveOrganizationMember('org-1', 'user-1', {
        delegationJwt: 'per-call-jwt',
      });
      const { headers } = axios.get.mock.calls[0][1];
      expect(headers['api-key']).toBe('secret');
      expect(headers['X-Delegation-JWT']).toBeUndefined();
      expect(headers['X-User-Subject']).toBeUndefined();
      expect(getDelegationJwt).not.toHaveBeenCalled();
    });

    test.each([400, 401, 403, 404])('%i surfaces as CoreOrganizationsError, not false, no retry', async (status) => {
      axios.get.mockRejectedValue({ response: { status, data: { error: { code: 'X', message: 'nope' } } }, message: 'm' });
      const err = await buildClient({ maxRetries: 2 }).isActiveOrganizationMember('org-1', 'user-1').catch((e) => e);
      expect(err).toBeInstanceOf(CoreOrganizationsError);
      expect(err.statusCode).toBe(status);
      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    test('5xx is retried per default then surfaces as an error', async () => {
      axios.get.mockRejectedValue({ response: { status: 503, data: {} }, message: 'unavailable' });
      const err = await buildClient({ maxRetries: 2 }).isActiveOrganizationMember('org-1', 'user-1').catch((e) => e);
      expect(err).toBeInstanceOf(CoreOrganizationsError);
      expect(err.statusCode).toBe(503);
      expect(axios.get).toHaveBeenCalledTimes(3);
    });

    test('recovers after a transient 5xx', async () => {
      axios.get
        .mockRejectedValueOnce({ response: { status: 502, data: {} }, message: 'bad gateway' })
        .mockResolvedValueOnce({ data: { data: { active: false } } });
      await expect(buildClient({ maxRetries: 2 }).isActiveOrganizationMember('org-1', 'user-1')).resolves.toBe(false);
      expect(axios.get).toHaveBeenCalledTimes(2);
    });

    test('options.timeoutMs and options.maxRetries are honoured', async () => {
      axios.get.mockRejectedValue({ response: { status: 500, data: {} }, message: 'boom' });
      await buildClient({ maxRetries: 2 })
        .isActiveOrganizationMember('org-1', 'user-1', { timeoutMs: 1234, maxRetries: 0 })
        .catch(() => {});
      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(axios.get.mock.calls[0][1].timeout).toBe(1234);
    });

    test.each([
      ['dot org', '.', 'user-1'],
      ['dotdot org', '..', 'user-1'],
      ['dot subject', 'org-1', '.'],
      ['dotdot subject', 'org-1', '..'],
    ])('%s is rejected before any HTTP call', async (_name, org, subject) => {
      const err = await buildClient().isActiveOrganizationMember(org, subject).catch((e) => e);
      expect(err).toBeInstanceOf(CoreOrganizationsError);
      expect(err.statusCode).toBe(400);
      expect(axios.get).not.toHaveBeenCalled();
    });

    test('inherited data/active (polluted Object.prototype) never yields a boolean', async () => {
      try {
        Object.prototype.active = true;
        Object.prototype.data = { active: true };
        axios.get.mockResolvedValue({ data: {} });
        const err = await buildClient().isActiveOrganizationMember('org-1', 'user-1').catch((e) => e);
        expect(err).toBeInstanceOf(CoreOrganizationsError);
        expect(err.statusCode).toBe(502);
        expect(err.meta.malformedResponse).toBe(true);
      } finally {
        delete Object.prototype.active;
        delete Object.prototype.data;
      }
    });

    test.each([
      ['empty org', '', 'user-1'],
      ['empty subject', 'org-1', ''],
      ['whitespace org', '  ', 'user-1'],
      ['null org', null, 'user-1'],
      ['undefined subject', 'org-1', undefined],
      ['numeric org', 42, 'user-1'],
      ['object subject', 'org-1', {}],
    ])('%s throws before any HTTP call', async (_name, org, subject) => {
      const err = await buildClient().isActiveOrganizationMember(org, subject).catch((e) => e);
      expect(err).toBeInstanceOf(CoreOrganizationsError);
      expect(err.statusCode).toBe(400);
      expect(axios.get).not.toHaveBeenCalled();
    });
  });
});
