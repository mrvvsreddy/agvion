// path: auth/services/RedisService.ts
import logger from '../../utils/logger';

/**
 * Upstash REST API response envelope
 */
interface UpstashResponse<T = unknown> {
  result: T;
  error?: string;
}

/**
 * Redis service error with context
 */
export class RedisError extends Error {
  constructor(
    message: string,
    public readonly context: {
      command?: string;
      args?: readonly (string | number)[];
      status?: number;
      upstashError?: string;
    }
  ) {
    super(message);
    this.name = 'RedisError';
  }
}

/**
 * Environment configuration with validation
 */
interface RedisConfig {
  readonly restUrl: string;
  readonly restToken: string;
}

function loadRedisConfig(): RedisConfig {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL;
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!restUrl || !restToken) {
    throw new RedisError('Redis configuration missing', {
      upstashError: 'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set'
    });
  }

  // Validate URL format
  try {
    new URL(restUrl);
  } catch {
    throw new RedisError('Invalid Redis REST URL format', { upstashError: restUrl });
  }

  return { restUrl, restToken };
}

/**
 * Upstash Redis client using REST API
 * Singleton pattern ensures single connection pool
 */
export class RedisService {
  private static instance: RedisService | undefined;
  private readonly config: RedisConfig;

  private constructor(config: RedisConfig) {
    this.config = config;
  }

  public static getInstance(): RedisService {
    if (!RedisService.instance) {
      const config = loadRedisConfig();
      RedisService.instance = new RedisService(config);
      logger.info('Redis Service initialized', {
        url: config.restUrl.replace(/\/\/[^@]+@/, '//*****@') // Mask credentials in logs
      });
    }
    return RedisService.instance;
  }

  /**
   * Reset singleton (for testing only)
   */
  public static resetInstance(): void {
    RedisService.instance = undefined;
  }

  // Upstash REST uses stateless HTTP; connect/disconnect are no-ops
  public async connect(): Promise<void> {
    // Verify connectivity on explicit connect
    const isHealthy = await this.ping();
    if (!isHealthy) {
      throw new RedisError('Redis connection failed', { command: 'PING' });
    }
  }

  public async disconnect(): Promise<void> {
    // No persistent connection to close
  }

  /**
   * Execute Redis command via Upstash REST API with retry logic
   * @see https://upstash.com/docs/redis/features/restapi
   */
  private async call<T = unknown>(
    command: string,
    ...args: readonly (string | number)[]
  ): Promise<T> {
    const maxRetries = 3;
    const baseTimeout = 10000; // 10s base timeout

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // CRITICAL FIX: Upstash expects flat array, not { command: [...] }
        const body = JSON.stringify([command, ...args.map(String)]);

        // Exponential backoff with jitter for timeout
        const timeout = Math.floor(baseTimeout + (attempt * 2000) + Math.random() * 1000);

        const res = await fetch(this.config.restUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.restToken}`,
            'Content-Type': 'application/json'
          },
          body,
          signal: AbortSignal.timeout(timeout)
        });

        const data = (await res.json()) as UpstashResponse<T>;

        if (!res.ok || data.error) {
          throw new RedisError('Upstash command failed', {
            command,
            args,
            status: res.status,
            upstashError: data.error || `HTTP ${res.status}`
          });
        }

        return data.result;
      } catch (error) {
        if (error instanceof RedisError) {
          // Don't retry on application errors
          logger.error('Redis command error', error.context);
          throw error;
        }

        // Check if it's a timeout or network error that we should retry
        const isRetryableError = error instanceof Error && (
          error.name === 'TimeoutError' ||
          error.name === 'AbortError' ||
          error.message.includes('timeout') ||
          error.message.includes('network') ||
          error.message.includes('ECONNRESET') ||
          error.message.includes('ENOTFOUND')
        );

        if (isRetryableError && attempt < maxRetries) {
          const delay = Math.floor(Math.min(1000 * Math.pow(2, attempt - 1), 5000)); // Max 5s delay, ensure integer
          logger.warn(`Redis request failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms`, {
            error: error.message,
            command,
            args
          });
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        logger.error('Redis request failed', { error, command, args, attempt });
        throw new RedisError('Redis request failed', { command, args });
      }
    }

    // This should never be reached due to the loop structure, but TypeScript needs it
    throw new RedisError('Redis request failed after all retries', { command, args });
  }

  // ==================== Session Management ====================

  public async setSession(
    sessionId: string,
    sessionData: unknown,
    ttlSeconds: number = 86400
  ): Promise<void> {
    try {
      await this.call<string>(
        'SETEX',
        `session:${sessionId}`,
        ttlSeconds,
        JSON.stringify(sessionData)
      );
    } catch (error) {
      logger.error('Failed to set session', { error, sessionId });
      throw error;
    }
  }

  public async getSession(sessionId: string): Promise<unknown> {
    try {
      const sessionData = await this.call<string | null>('GET', `session:${sessionId}`);
      return sessionData ? JSON.parse(sessionData) : null;
    } catch (error) {
      logger.error('Failed to get session', { error, sessionId });
      throw error;
    }
  }

  public async deleteSession(sessionId: string): Promise<void> {
    try {
      await this.call<number>('DEL', `session:${sessionId}`);
    } catch (error) {
      logger.error('Failed to delete session', { error, sessionId });
      throw error;
    }
  }

  public async updateSessionTTL(sessionId: string, ttlSeconds: number): Promise<void> {
    try {
      await this.call<number>('EXPIRE', `session:${sessionId}`, ttlSeconds);
    } catch (error) {
      logger.error('Failed to update session TTL', { error, sessionId });
      throw error;
    }
  }

  /**
   * SECURITY FIX #7: Get remaining TTL for a session key
   * Uses PTTL to get milliseconds remaining before expiration
   * @returns TTL in seconds (rounded), or null if key doesn't exist or has no expiry
   */
  public async getSessionTTL(sessionId: string): Promise<number | null> {
    try {
      const ttlMs = await this.call<number>('PTTL', `session:${sessionId}`);
      // PTTL returns -1 if key exists but has no expiry, -2 if key doesn't exist
      if (ttlMs === -1 || ttlMs === -2) {
        return null;
      }
      // Convert milliseconds to seconds (rounded)
      return Math.ceil(ttlMs / 1000);
    } catch (error) {
      logger.error('Failed to get session TTL', { error, sessionId });
      throw error;
    }
  }

  // ==================== User Session Mapping ====================

  /**
   * Map a user to their active session token (single-session enforcement)
   */
  public async setUserSession(
    userId: string,
    sessionToken: string,
    ttlSeconds: number
  ): Promise<void> {
    try {
      await this.call<string>(
        'SETEX',
        `user:session:${userId}`,
        ttlSeconds,
        sessionToken
      );
    } catch (error) {
      logger.error('Failed to set user session index', { error, userId });
      throw error;
    }
  }

  public async getUserSession(userId: string): Promise<string | null> {
    try {
      const token = await this.call<string | null>('GET', `user:session:${userId}`);
      return token ?? null;
    } catch (error) {
      logger.error('Failed to get user session index', { error, userId });
      throw error;
    }
  }

  public async deleteUserSession(userId: string): Promise<void> {
    try {
      await this.call<number>('DEL', `user:session:${userId}`);
    } catch (error) {
      logger.error('Failed to delete user session index', { error, userId });
      throw error;
    }
  }

  /**
   * Replace existing user session with a new one
   * Note: Not atomic due to REST API limitations
   */
  public async replaceUserSession(
    userId: string,
    newToken: string,
    sessionData: unknown,
    ttlSeconds: number
  ): Promise<void> {
    try {
      const oldToken = await this.getUserSession(userId);
      if (oldToken) {
        await this.call<number>('DEL', `session:${oldToken}`);
      }
      await this.call<string>(
        'SETEX',
        `session:${newToken}`,
        ttlSeconds,
        JSON.stringify(sessionData)
      );
      await this.call<string>(
        'SETEX',
        `user:session:${userId}`,
        ttlSeconds,
        newToken
      );
    } catch (error) {
      logger.error('Failed to replace user session', { error, userId });
      throw error;
    }
  }

  // ==================== Rate Limiting ====================

  public async incrementRateLimit(key: string, windowSeconds: number = 60): Promise<number> {
    try {
      const current = await this.call<number>('INCR', `rate_limit:${key}`);
      if (current === 1) {
        await this.call<number>('EXPIRE', `rate_limit:${key}`, windowSeconds);
      }
      return current;
    } catch (error) {
      logger.error('Failed to increment rate limit', { error, key });
      throw error;
    }
  }

  /**
   * Increment a composite rate limit using multiple key parts (e.g., IP+email)
   */
  public async incrementCompositeRateLimit(
    parts: readonly (string | number)[],
    windowSeconds: number = 60
  ): Promise<number> {
    const composite = String(parts.map(String).join(':')).toLowerCase();
    return this.incrementRateLimit(composite, windowSeconds);
  }

  public async getRateLimit(key: string): Promise<number> {
    try {
      const current = await this.call<string | null>('GET', `rate_limit:${key}`);
      return current ? parseInt(current, 10) : 0;
    } catch (error) {
      logger.error('Failed to get rate limit', { error, key });
      throw error;
    }
  }

  // ==================== Cache ====================

  public async setCache(key: string, value: unknown, ttlSeconds: number = 3600): Promise<void> {
    try {
      await this.call<string>(
        'SETEX',
        `cache:${key}`,
        ttlSeconds,
        JSON.stringify(value)
      );
    } catch (error) {
      logger.error('Failed to set cache', { error, key });
      throw error;
    }
  }

  public async getCache(key: string): Promise<unknown> {
    try {
      const cached = await this.call<string | null>('GET', `cache:${key}`);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      logger.error('Failed to get cache', { error, key });
      throw error;
    }
  }

  public async deleteCache(key: string): Promise<void> {
    try {
      await this.call<number>('DEL', `cache:${key}`);
    } catch (error) {
      logger.error('Failed to delete cache', { error, key });
      throw error;
    }
  }

  // ==================== Pending Signup ====================

  public async setPendingSignup(
    email: string,
    data: { email: string; name: string; code: string; ip: string; requestedAt: number; requestCount: number; userId: string },
    ttlSeconds: number = 3600
  ): Promise<void> {
    const key = `pending_signup:${String(email).toLowerCase()}`;
    try {
      await this.call<string>('SETEX', key, ttlSeconds, JSON.stringify(data));
    } catch (error) {
      logger.error('Failed to set pending signup', { error, email });
      throw error;
    }
  }

  public async getPendingSignup(email: string): Promise<
    | { email: string; name: string; code: string; ip: string; requestedAt: number; requestCount: number; userId: string }
    | null
  > {
    const key = `pending_signup:${String(email).toLowerCase()}`;
    try {
      const raw = await this.call<string | null>('GET', key);
      return raw ? (JSON.parse(raw) as any) : null;
    } catch (error) {
      logger.error('Failed to get pending signup', { error, email });
      throw error;
    }
  }

  public async deletePendingSignup(email: string): Promise<void> {
    const key = `pending_signup:${String(email).toLowerCase()}`;
    try {
      await this.call<number>('DEL', key);
    } catch (error) {
      logger.error('Failed to delete pending signup', { error, email });
      throw error;
    }
  }

  public async cleanupSignupRateLimit(email: string, ip: string): Promise<void> {
    const rateLimitKey = ['pre_signup', ip, email];
    const compositeKey = String(rateLimitKey.map(String).join(':')).toLowerCase();
    try {
      await this.call<number>('DEL', `rate_limit:${compositeKey}`);
    } catch (error) {
      logger.error('Failed to cleanup signup rate limit', { error, email, ip });
      throw error;
    }
  }

  public async cleanupLoginRateLimit(email: string, ip: string): Promise<void> {
    try {
      const ipKey = `login:ip:${ip}`;
      const emailKey = `login:email:${String(email).toLowerCase()}`;

      // Delete both IP and email rate limits
      await Promise.all([
        this.call<number>('DEL', `rate_limit:${ipKey}`),
        this.call<number>('DEL', `rate_limit:${emailKey}`)
      ]);

      logger.info('Login rate limits cleaned up', { email, ip });
    } catch (error) {
      logger.error('Failed to cleanup login rate limit', { error, email, ip });
      throw error;
    }
  }

  /**
   * Clear only the email-based login rate limit counter. Useful when IP isn't available in backend service.
   */
  public async cleanupLoginRateLimitForEmail(email: string): Promise<void> {
    try {
      const emailKey = `login:email:${String(email).toLowerCase()}`;
      await this.call<number>('DEL', `rate_limit:${emailKey}`);
      logger.info('Login email rate limit cleaned up', { email });
    } catch (error) {
      logger.error('Failed to cleanup login rate limit for email', { error, email });
      throw error;
    }
  }

  // ==================== Raw JSON Key Helpers (no prefixes) ====================

  public async setJson(key: string, value: unknown, ttlSeconds: number = 86400): Promise<void> {
    try {
      await this.call<string>('SETEX', key, ttlSeconds, JSON.stringify(value));
    } catch (error) {
      logger.error('Failed to set JSON key', { error, key });
      throw error;
    }
  }

  public async getJson<T = unknown>(key: string): Promise<T | null> {
    try {
      const raw = await this.call<string | null>('GET', key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (error) {
      logger.error('Failed to get JSON key', { error, key });
      throw error;
    }
  }

  public async deleteKey(key: string): Promise<void> {
    try {
      await this.call<number>('DEL', key);
    } catch (error) {
      logger.error('Failed to delete key', { error, key });
      throw error;
    }
  }

  // ==================== Advanced Patterns ====================

  /**
   * Set a key only if it doesn't already exist (atomic operation)
   * @returns true if key was set, false if key already exists
   */
  public async setIfNotExists(
    key: string,
    value: string,
    ttlSeconds: number
  ): Promise<boolean> {
    try {
      // Use SET with NX (not exist) and EX (expiry) options
      const result = await this.call<string | null>(
        'SET',
        key,
        value,
        'NX',
        'EX',
        ttlSeconds
      );
      return result === 'OK';
    } catch (error) {
      logger.error('Failed to execute setIfNotExists', { error, key });
      throw error;
    }
  }

  /**
   * Simple string get without JSON parsing
   */
  public async get(key: string): Promise<string | null> {
    try {
      return await this.call<string | null>('GET', key);
    } catch (error) {
      logger.error('Failed to get key', { error, key });
      throw error;
    }
  }

  /**
   * Execute a Lua script via EVAL
   */
  public async evalScript<T = unknown>(
    script: string,
    keys: readonly string[],
    args: readonly (string | number)[]
  ): Promise<T> {
    try {
      // EVAL script numkeys key [key ...] arg [arg ...]
      const numKeys = keys.length;
      const commandArgs = [
        script,
        numKeys.toString(),
        ...keys.map(String),
        ...args.map(String)
      ];
      return await this.call<T>('EVAL', ...commandArgs);
    } catch (error) {
      logger.error('Failed to execute Lua script', { error, script: script.substring(0, 50) });
      throw error;
    }
  }

  /**
   * Health check
   */
  public async ping(): Promise<boolean> {
    try {
      const result = await this.call<string>('PING');
      return result === 'PONG';
    } catch (error) {
      logger.error('Redis ping failed', { error });
      return false;
    }
  }
}

export default RedisService;