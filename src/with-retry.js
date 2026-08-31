/**
 * Generic retry-with-linear-backoff loop.
 * Backoff is linear: `baseDelay * attemptNumber` (attempt 1 waits baseDelay, …).
 */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {() => Promise<any>} fn
 * @param {{ maxRetries?: number, baseDelay?: number, shouldRetry?: (error: Error) => boolean, onRetry?: (attempt: number, error: Error, delayMs: number) => void }} [options]
 */
async function withRetry(fn, options = {}) {
  const {
    maxRetries = 0,
    baseDelay = 0,
    shouldRetry = () => false,
    onRetry = null,
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= maxRetries || !shouldRetry(error)) {
        throw error;
      }

      const attemptNumber = attempt + 1;
      const delayMs = baseDelay * attemptNumber;
      if (onRetry) {
        onRetry(attemptNumber, error, delayMs);
      }
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}

module.exports = { withRetry, sleep };
