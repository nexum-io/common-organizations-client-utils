jest.mock('axios');
const axios = require('axios');
const CoreOrganizationsClient = require('../../src/core-organizations.client');

describe('CoreOrganizationsClient', () => {
  const logger = { warn: jest.fn(), error: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
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
    });
    const body = await client.createOrganization('user-1', { name: 'Acme' });
    expect(body.id).toBe('org-1');
    expect(axios.post).toHaveBeenCalledWith(
      'http://core:8092/api/v1/internal/organizations',
      { name: 'Acme' },
      expect.objectContaining({
        headers: expect.objectContaining({
          'api-key': 'secret',
          'X-User-Subject': 'user-1',
        }),
      })
    );
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
    });
    await expect(client.getOrganization('user-1', 'org-1')).rejects.toBeInstanceOf(
      CoreOrganizationsError
    );
  });
});
