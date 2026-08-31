class CoreOrganizationsError extends Error {
  constructor(message, statusCode = 502, errors = [], meta = {}) {
    super(message);
    this.name = 'CoreOrganizationsError';
    this.statusCode = statusCode;
    this.errors = errors;
    this.meta = meta;
  }
}

module.exports = { CoreOrganizationsError };
