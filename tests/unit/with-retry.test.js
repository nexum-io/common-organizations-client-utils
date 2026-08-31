const { withRetry } = require('../../src/with-retry');

describe('withRetry', () => {
  test('retries then succeeds', async () => {
    let n = 0;
    const result = await withRetry(
      async () => {
        n += 1;
        if (n < 3) {
          const err = new Error('fail');
          err.statusCode = 503;
          throw err;
        }
        return 'ok';
      },
      {
        maxRetries: 3,
        baseDelay: 1,
        shouldRetry: (e) => e.statusCode >= 500,
      }
    );
    expect(result).toBe('ok');
    expect(n).toBe(3);
  });

  test('does not retry non-matching errors', async () => {
    await expect(
      withRetry(
        async () => {
          const err = new Error('nope');
          err.statusCode = 400;
          throw err;
        },
        { maxRetries: 3, baseDelay: 1, shouldRetry: (e) => e.statusCode >= 500 }
      )
    ).rejects.toThrow('nope');
  });
});
