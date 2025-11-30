// auth/middleware/authMiddleware.ts
import { Request, Response, NextFunction } from 'express';
import AuthService from '../services/AuthService';
import logger from '../../utils/logger';
import TenantsRepository from '../../database/repositories/TenantsRepository';
import RedisService from '../services/RedisService';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    tenantId: string;
    sessionToken: string;
  };
}

/**
 * Middleware to authenticate session tokens
 */
export const authenticateToken = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Priority 1: Cookie `session` or `__Host-session`
    // Priority 2: Authorization: "Session <token>" or "Bearer <token>"
    let sessionToken: string | undefined;
    const cookies = (req as any).cookies;
    if (cookies) {
      // Try session cookie first, then __Host-session
      sessionToken = cookies['session'] || cookies['__Host-session'];
    }
    
    // If no cookie, try Authorization header
    if (!sessionToken) {
      const authHeader = req.headers.authorization;
      if (authHeader) {
        const parts = authHeader.split(' ');
        if (parts.length === 2 && (parts[0] === 'Session' || parts[0] === 'Bearer')) {
          sessionToken = parts[1];
        }
      }
    }

    if (!sessionToken) {
      res.status(401).json({ 
        success: false, 
        message: 'Session token required' 
      });
      return;
    }

    // Basic format validation: base64url 43 chars (if we switch to base64url)
    // Accept hex tokens for backward compatibility
    if (sessionToken && !(sessionToken.length === 43 && /^[A-Za-z0-9_-]{43}$/.test(sessionToken)) && !/^[a-f0-9]{64}$/i.test(sessionToken)) {
      res.status(401).json({ 
        success: false, 
        message: 'Invalid session token format' 
      });
      return;
    }

    const authService = AuthService.getInstance();
    const validation = await authService.validateSession(sessionToken);

    if (!validation.success) {
      res.status(401).json({ 
        success: false, 
        message: validation.message || 'Invalid or expired session' 
      });
      return;
    }

    // Attach user data to request
    req.user = {
      id: validation.user!.id,
      email: validation.user!.email,
      tenantId: validation.user!.tenantId,
      sessionToken
    };

    next();
  } catch (error) {
    logger.error('Authentication middleware error', { error });
    res.status(500).json({ 
      success: false, 
      message: 'Authentication error' 
    });
  }
};

/**
 * Middleware to check if user has required role
 */
// Role-based middleware removed per spec

/**
 * Middleware to check if user belongs to specific tenant
 */
export const requireTenant = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ 
      success: false, 
      message: 'Authentication required' 
    });
    return;
  }

  const requestedTenantId = req.params.tenantId || req.body.tenantId || req.query.tenantId;

  if (requestedTenantId && requestedTenantId !== req.user.tenantId) {
    res.status(403).json({ 
      success: false, 
      message: 'Access denied for this tenant' 
    });
    return;
  }

  next();
};

/**
 * Middleware to check if user's email is verified
 */
export const requireEmailVerification = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
      return;
    }

    const user = await TenantsRepository.findTenantById(req.user.id);

    if (!user) {
      res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
      return;
    }

    if (!user.email_verified) {
      res.status(403).json({ 
        success: false, 
        message: 'Email verification required' 
      });
      return;
    }

    next();
  } catch (error) {
    logger.error('Email verification middleware error', { error });
    res.status(500).json({ 
      success: false, 
      message: 'Email verification check failed' 
    });
  }
};

/**
 * Optional authentication middleware - doesn't fail if no token
 */
export const optionalAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    let sessionToken: string | undefined;
    const cookies = (req as any).cookies;
    if (cookies) {
      // Try session cookie first, then __Host-session
      sessionToken = cookies['session'] || cookies['__Host-session'];
    }
    
    // If no cookie, try Authorization header
    if (!sessionToken) {
      const authHeader = req.headers.authorization;
      if (authHeader) {
        const parts = authHeader.split(' ');
        if (parts.length === 2 && (parts[0] === 'Session' || parts[0] === 'Bearer')) {
          sessionToken = parts[1];
        }
      }
    }

    if (!sessionToken) {
      next();
      return;
    }

    // Validate format if present
    if (sessionToken && !(sessionToken.length === 43 && /^[A-Za-z0-9_-]{43}$/.test(sessionToken)) && !/^[a-f0-9]{64}$/i.test(sessionToken)) {
      return next();
    }

    const authService = AuthService.getInstance();
    const validation = await authService.validateSession(sessionToken);

    if (validation.success) {
      req.user = {
        id: validation.user!.id,
        email: validation.user!.email,
        tenantId: validation.user!.tenantId,
        sessionToken
      };
    }

    next();
  } catch (error) {
    logger.error('Optional authentication middleware error', { error });
    next(); // Continue even if there's an error
  }
};

/**
 * Middleware to refresh session TTL
 */
export const refreshSession = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (req.user) {
      const authService = AuthService.getInstance();
      await authService.validateSession(req.user.sessionToken); // This will refresh the TTL
    }
    next();
  } catch (error) {
    logger.error('Session refresh middleware error', { error });
    next(); // Continue even if session refresh fails
  }
};

/**
 * Middleware to log authentication events
 */
export const logAuthEvents = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const originalSend = res.send;
  
  res.send = function(data) {
    if (req.user) {
      logger.info('Authenticated request', {
        userId: req.user.id,
        email: req.user.email,
        tenantId: req.user.tenantId,
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });
    }
    
    return originalSend.call(this, data);
  };
  
  next();
};

/**
 * Middleware to check rate limits
 */
export const rateLimitAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const redisService = RedisService.getInstance();
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
    const key = `auth_rate_limit:${clientIp}`;
    
    const attempts = await redisService.incrementRateLimit(key, 900); // 15 minutes window
    
    if (attempts > 10) { // Max 10 auth attempts per 15 minutes
      res.status(429).json({
        success: false,
        message: 'Too many authentication attempts. Please try again later.',
        retryAfter: 900 // 15 minutes
      });
      return;
    }
    
    next();
  } catch (error) {
    logger.error('Rate limit middleware error', { error });
    next(); // Continue even if rate limiting fails
  }
};

/**
 * Middleware to validate tenant access
 */
export const validateTenantAccess = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
      return;
    }

    const tenantId = req.params.tenantId || req.body.tenantId || req.query.tenantId;
    
    if (tenantId && tenantId !== req.user.tenantId) {
      res.status(403).json({ 
        success: false, 
        message: 'Access denied for this tenant' 
      });
      return;
    }

    next();
  } catch (error) {
    logger.error('Tenant access validation error', { error });
    res.status(500).json({ 
      success: false, 
      message: 'Tenant access validation failed' 
    });
  }
};
