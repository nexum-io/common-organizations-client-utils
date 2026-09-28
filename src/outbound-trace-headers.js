const crypto = require('crypto');

function outboundTraceHeaders() {
  let correlationId = '';
  try {
    const { getCorrelationContext } = require('@nexum-io/common-observability-logging-package');
    const ctx = getCorrelationContext();
    if (typeof ctx.correlation_id === 'string' && ctx.correlation_id.trim() !== '') {
      correlationId = ctx.correlation_id;
    }
  } catch {
    // Optional peer. A missing package must not break the HTTP call.
  }
  if (!correlationId) {
    correlationId = crypto.randomUUID();
  }
  return {
    'x-correlation-id': correlationId,
    'x-request-id': crypto.randomUUID(),
  };
}

module.exports = { outboundTraceHeaders };
