jest.mock('@nexum-io/common-observability-logging-package', () => {
  const { AsyncLocalStorage } = require('async_hooks');
  const als = new AsyncLocalStorage();
  return {
    getCorrelationContext: () => als.getStore() || {},
    runWithCorrelation: (context, fn) => als.run({ ...(als.getStore() || {}), ...context }, fn),
  };
}, { virtual: true });

const { runWithCorrelation } = require('@nexum-io/common-observability-logging-package');
const { outboundTraceHeaders } = require('../../src/outbound-trace-headers');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('outboundTraceHeaders', () => {
  test('preserves ALS correlation and mints a child request id per call', () => {
    runWithCorrelation({ correlation_id: 'corr-1' }, () => {
      const first = outboundTraceHeaders();
      const second = outboundTraceHeaders();
      expect(first['x-correlation-id']).toBe('corr-1');
      expect(second['x-correlation-id']).toBe('corr-1');
      expect(first['x-request-id']).toMatch(UUID);
      expect(second['x-request-id']).toMatch(UUID);
      expect(first['x-request-id']).not.toBe(second['x-request-id']);
    });
  });

  test('falls back to a fresh correlation id outside ALS', () => {
    const first = outboundTraceHeaders();
    const second = outboundTraceHeaders();
    expect(first['x-correlation-id']).toMatch(UUID);
    expect(second['x-correlation-id']).toMatch(UUID);
    expect(first['x-correlation-id']).not.toBe(second['x-correlation-id']);
    expect(first['x-request-id']).not.toBe(second['x-request-id']);
  });

  test('falls back when the observability package cannot be loaded', () => {
    jest.isolateModules(() => {
      jest.doMock('@nexum-io/common-observability-logging-package', () => {
        throw new Error('MODULE_NOT_FOUND');
      });
      const { outboundTraceHeaders: isolated } = require('../../src/outbound-trace-headers');
      const headers = isolated();
      expect(headers['x-correlation-id']).toMatch(UUID);
      expect(headers['x-request-id']).toMatch(UUID);
    });
  });
});
