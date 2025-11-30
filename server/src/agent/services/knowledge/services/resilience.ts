// knowledge/services/resilience.ts
import { RedisService } from '../../../../auth/services/RedisService';
import logger from '../../../../utils/logger';

// ============= Configuration =============
function parsePositiveInt(val: string | undefined, fallback: number): number {
  if (!val) return fallback;
  const parsed = parseInt(val, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const CONFIG = {
  BATCH_SIZE: parsePositiveInt(process.env.KNOWLEDGE_LIST_BATCH_SIZE, 10),
  CACHE_CIRCUIT_BREAKER_THRESHOLD: parsePositiveInt(process.env.KNOWLEDGE_CACHE_CB_THRESHOLD, 3),
  CACHE_CIRCUIT_MAX_BACKOFF_MS: parsePositiveInt(process.env.KNOWLEDGE_CACHE_CB_MAX_BACKOFF_MS, 30000),
  EMBEDDING_BATCH_SIZE: parsePositiveInt(process.env.KNOWLEDGE_EMBEDDING_BATCH_SIZE, 5),
  DB_BATCH_SIZE: parsePositiveInt(process.env.KNOWLEDGE_DB_BATCH_SIZE, 50),
  CHUNK_SIZE: parsePositiveInt(process.env.KNOWLEDGE_CHUNK_SIZE, 1000),
  CHUNK_OVERLAP: parsePositiveInt(process.env.KNOWLEDGE_CHUNK_OVERLAP, 200),
  LARGE_FILE_STREAM_THRESHOLD_MB: parsePositiveInt(process.env.KNOWLEDGE_LARGE_FILE_STREAM_THRESHOLD_MB, 10),
  UPLOAD_RATE_MAX_PER_MINUTE: parsePositiveInt(process.env.KNOWLEDGE_UPLOAD_RATE_MAX_PER_MINUTE, 5),
  INSERT_THROTTLE_MS: parsePositiveInt(process.env.KNOWLEDGE_INSERT_THROTTLE_MS, 50),
  MAX_FILE_SIZE_MB: parsePositiveInt(process.env.KNOWLEDGE_MAX_FILE_SIZE_MB, 50),
  MAX_TOTAL_SIZE_MB: parsePositiveInt(process.env.KNOWLEDGE_MAX_TOTAL_SIZE_MB, 100)
};

// ============= Error Classification =============
export enum ErrorCategory {
  TRANSIENT = 'transient',
  PERMANENT = 'permanent',
  UNKNOWN = 'unknown'
}

export function categorizeError(error: any): ErrorCategory {
  const status = (error && (error.status || error.statusCode)) || 0;
  const code = (error && error.code) || '';
  const message = (error && error.message) || '';

  if (status >= 400 && status < 500 && status !== 429 && status !== 408) return ErrorCategory.PERMANENT;
  if (code === '23505' || code === 'P2002' || /unique constraint/i.test(message)) return ErrorCategory.PERMANENT;
  if (status === 401 || status === 403 || /unauthorized|forbidden/i.test(message)) return ErrorCategory.PERMANENT;
  if (
    status === 429 || status === 408 || status === 503 || status === 504 || status >= 500 ||
    code === '57014' || /timeout|ECONNRESET|ETIMEDOUT/i.test(message)
  ) return ErrorCategory.TRANSIENT;
  return ErrorCategory.UNKNOWN;
}

// ============= Retry Policy =============
export class RetryPolicy {
  constructor(private opts: {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    backoffFactor: number;
    jitterFactor: number;
    retryableCategories: ErrorCategory[];
  }) {}

  async execute<T>(fn: () => Promise<T>, context: { operation: string; metadata?: any }): Promise<T> {
    let lastError: any;
    for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
      try {
        const result = await fn();
        if (attempt > 0) {
          logger.info('Retry succeeded', { operation: context.operation, attempt, totalAttempts: attempt + 1 });
        }
        return result;
      } catch (error) {
        lastError = error;
        const category = categorizeError(error);
        const willRetry = this.opts.retryableCategories.includes(category) && attempt < this.opts.maxRetries;
        logger.warn('Operation failed, evaluating retry', {
          operation: context.operation,
          attempt: attempt + 1,
          maxRetries: this.opts.maxRetries + 1,
          errorCategory: category,
          willRetry,
          error: error instanceof Error ? error.message : String(error)
        });
        if (!willRetry) throw error;
        const exponentialDelay = this.opts.baseDelayMs * Math.pow(this.opts.backoffFactor, attempt);
        const cappedDelay = Math.min(exponentialDelay, this.opts.maxDelayMs);
        const jitter = cappedDelay * this.opts.jitterFactor * Math.random();
        await new Promise(res => setTimeout(res, cappedDelay + jitter));
      }
    }
    throw lastError;
  }
}

export const RETRY = {
  database: new RetryPolicy({
    maxRetries: 3,
    baseDelayMs: 500,
    maxDelayMs: 5000,
    backoffFactor: 2,
    jitterFactor: 0.1,
    retryableCategories: [ErrorCategory.TRANSIENT]
  }),
  externalApi: new RetryPolicy({
    maxRetries: 5,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    backoffFactor: 2,
    jitterFactor: 0.2,
    retryableCategories: [ErrorCategory.TRANSIENT, ErrorCategory.UNKNOWN]
  }),
  cache: new RetryPolicy({
    maxRetries: 1,
    baseDelayMs: 100,
    maxDelayMs: 500,
    backoffFactor: 2,
    jitterFactor: 0.1,
    retryableCategories: [ErrorCategory.TRANSIENT]
  })
};

// ============= Circuit Breaker =============
export class CircuitBreaker {
  private localCircuitState: Map<string, { status: 'OPEN' | 'CLOSED' | 'HALF_OPEN'; failures: number; lastFailure: number | null }> = new Map();
  private redis: RedisService;
  private threshold: number;
  private resetMs: number;

  constructor(redis: RedisService) {
    this.redis = redis;
    this.threshold = CONFIG.CACHE_CIRCUIT_BREAKER_THRESHOLD;
    this.resetMs = CONFIG.CACHE_CIRCUIT_MAX_BACKOFF_MS;
  }

  async execute<T>(
    breakerKey: string,
    fn: () => Promise<T>,
    fallback?: () => Promise<T>
  ): Promise<T> {
    const key = `circuit_breaker:${breakerKey}`;
    const now = Date.now();

    let state: { status: 'OPEN' | 'CLOSED' | 'HALF_OPEN'; failures: number; lastFailure: number | null };
    let usingLocal = false;
    
    try {
      const redisState = await this.redis.getJson<any>(key);
      state = redisState || { status: 'CLOSED', failures: 0, lastFailure: null };
    } catch (err) {
      logger.warn('Redis unavailable for circuit breaker, using local state', {
        breakerKey,
        error: err instanceof Error ? err.message : String(err)
      });
      state = this.localCircuitState.get(breakerKey) || { status: 'CLOSED', failures: 0, lastFailure: null };
      usingLocal = true;
    }

    if (state.status === 'OPEN') {
      if (state.lastFailure && (now - state.lastFailure) < this.resetMs) {
        if (fallback) return fallback();
        throw new Error('Circuit breaker is OPEN');
      }
      const halfOpenState = { ...state, status: 'HALF_OPEN' as const };
      if (!usingLocal) {
        await this.redis.setJson(key, halfOpenState, Math.ceil(this.resetMs / 1000)).catch(() => {});
      } else {
        this.localCircuitState.set(breakerKey, halfOpenState);
      }
    }

    try {
      const result = await fn();
      const closed = { status: 'CLOSED' as const, failures: 0, lastFailure: null };
      if (!usingLocal) {
        await this.redis.setJson(key, closed, Math.ceil(this.resetMs / 1000)).catch(() => {});
      } else {
        this.localCircuitState.set(breakerKey, closed);
      }
      return result;
    } catch (error) {
      const newFailures = (state.failures || 0) + 1;
      const newState = newFailures >= this.threshold
        ? { status: 'OPEN' as const, failures: newFailures, lastFailure: now }
        : { status: 'CLOSED' as const, failures: newFailures, lastFailure: now };
      if (!usingLocal) {
        await this.redis.setJson(key, newState, Math.ceil(this.resetMs / 1000)).catch(() => {
          this.localCircuitState.set(breakerKey, newState);
        });
      } else {
        this.localCircuitState.set(breakerKey, newState);
      }
      if (fallback) return fallback();
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}

// ============= Cache Manager =============
export class CacheManager {
  shutdown() {
    throw new Error('Method not implemented.');
  }
  private redis: RedisService;
  private breaker: CircuitBreaker;

  constructor() {
    this.redis = RedisService.getInstance();
    this.breaker = new CircuitBreaker(this.redis);
  }

  async get<T>(key: string): Promise<{ hit: boolean; data?: T; severity?: 'low' | 'high' }> {
    const res = await this.breaker.execute<{ hit: boolean; data?: T }>(
      'cache',
      async () => {
        const data = await this.redis.getJson<T>(key);
        return data ? { hit: true, data: data as T } : { hit: false };
      },
      async () => ({ hit: false })
    );
    return res;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.setJson(key, value, ttlSeconds);
    } catch (error) {
      logger.warn('Cache write failed', { key, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async invalidate(pattern: string): Promise<boolean> {
    try {
      await this.redis.deleteKey(pattern);
      logger.debug('Cache invalidated successfully', { pattern: pattern.substring(0, 50) + '...' });
      return true;
    } catch (error) {
      logger.error('CRITICAL: Cache invalidation failed', {
        pattern: pattern.substring(0, 50) + '...',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      return false;
    }
  }
}

// ============= Rate Limiter =============
export class RateLimiter {
  shutdown() {
    throw new Error('Method not implemented.');
  }
  private redis: RedisService;

  constructor() {
    this.redis = RedisService.getInstance();
  }

  async checkLimit(
    key: string,
    maxRequests: number
  ): Promise<{ allowed: boolean; retryAfter?: number }> {
    try {
      const client = (this.redis as any).getClient?.();
      if (!client || typeof client.zadd !== 'function') {
        logger.warn('Redis client missing ZSET methods; skipping rate limiting');
        return { allowed: true };
      }

      const now = Date.now();
      const windowMs = 60000;
      const member = `${now}:${Math.random()}`;
      
      await client.zadd(key, now, member);
      await client.zremrangebyscore(key, 0, now - windowMs);
      const count = await client.zcard(key);
      await client.expire(key, Math.ceil(windowMs / 1000) + 1);
      
      if (Number(count) >= maxRequests) {
        const oldest = await client.zrange(key, 0, 0, 'WITHSCORES');
        let retryAfter = 60;
        if (Array.isArray(oldest) && oldest.length >= 2) {
          const parsedScore = Number(oldest[1]);
          if (!Number.isNaN(parsedScore)) {
            retryAfter = Math.ceil((parsedScore + windowMs - now) / 1000);
          }
        }
        return { allowed: false, retryAfter };
      }
      
      return { allowed: true };
    } catch (error) {
      logger.warn('Rate limiter error, allowing request', {
        error: error instanceof Error ? error.message : String(error)
      });
      return { allowed: true };
    }
  }
}

