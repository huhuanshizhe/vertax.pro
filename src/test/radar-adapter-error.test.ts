import { describe, it, expect } from 'vitest';
import { RateLimiter, AdapterError } from '@/lib/radar/adapters/types';

describe('AdapterError', () => {
  it('creates error with correct properties', () => {
    const err = new AdapterError({
      message: 'API key invalid',
      category: 'AUTH',
      adapterCode: 'hunter',
      statusCode: 401,
    });

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AdapterError);
    expect(err.name).toBe('AdapterError');
    expect(err.message).toBe('API key invalid');
    expect(err.category).toBe('AUTH');
    expect(err.adapterCode).toBe('hunter');
    expect(err.statusCode).toBe(401);
    expect(err.retryable).toBe(false);
  });

  it('marks rate limit and network errors as retryable', () => {
    const rateLimitErr = new AdapterError({
      message: 'Rate limited',
      category: 'RATE_LIMIT',
      adapterCode: 'ted',
    });
    expect(rateLimitErr.retryable).toBe(true);

    const networkErr = new AdapterError({
      message: 'Connection timeout',
      category: 'NETWORK',
      adapterCode: 'ungm',
    });
    expect(networkErr.retryable).toBe(true);

    const authErr = new AdapterError({
      message: 'Unauthorized',
      category: 'AUTH',
      adapterCode: 'sam_gov',
    });
    expect(authErr.retryable).toBe(false);
  });

  it('preserves cause', () => {
    const cause = new Error('original error');
    const err = new AdapterError({
      message: 'Wrapped',
      category: 'UPSTREAM',
      adapterCode: 'ai_search',
      cause,
    });
    expect((err as Error & { cause: unknown }).cause).toBe(cause);
  });
});

describe('RateLimiter', () => {
  it('allows requests within limit', () => {
    const limiter = new RateLimiter(3, 1000);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });

  it('refills tokens after window', async () => {
    const limiter = new RateLimiter(2, 50); // 50ms window
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);

    // Wait for refill
    await new Promise(r => setTimeout(r, 60));
    expect(limiter.tryAcquire()).toBe(true);
  });

  it('acquire resolves when token available', async () => {
    const limiter = new RateLimiter(5, 1000);
    await expect(limiter.acquire()).resolves.toBeUndefined();
  });
});
