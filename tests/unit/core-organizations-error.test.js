const { CoreOrganizationsError } = require('../../src/core-organizations-error');

describe('CoreOrganizationsError', () => {
  test('stores statusCode, errors, and meta', () => {
    const err = new CoreOrganizationsError('boom', 409, ['detail'], {
      coreCode: 'owner.last',
      coreMessage: 'last owner',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CoreOrganizationsError');
    expect(err.message).toBe('boom');
    expect(err.statusCode).toBe(409);
    expect(err.errors).toEqual(['detail']);
    expect(err.meta.coreCode).toBe('owner.last');
  });
});
