// auth/routes/authRoutes.ts
import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import crypto from 'crypto';
import AuthService from '../services/AuthService';
import { authenticateToken, AuthenticatedRequest } from '../middleware/authMiddleware';
import RedisService from '../services/RedisService';
import logger from '../../utils/logger';

// Cookie helper utilities
const setSessionCookie = (res: Response, sessionToken: string, rememberMe: boolean = false, req?: Request): void => {
  const isProduction = process.env.NODE_ENV === 'production';
  const isSecureContext = isProduction || (req?.secure === true);
  const cookieName = isProduction ? '__Host-session' : 'session';

  const cookieOptions = {
    httpOnly: true,
    secure: isSecureContext,
    sameSite: 'strict' as const,
    path: '/',
    maxAge: (rememberMe ? 30 : 1) * 24 * 60 * 60 * 1000,
    // Don't set domain in development to allow localhost
    ...(isProduction ? {} : { domain: undefined })
  };

  const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex').substring(0, 16);
  logger.debug('Setting cookie with options', {
    name: cookieName,
    tokenHash,
    options: cookieOptions,
    isProduction
  });

  res.cookie(cookieName, sessionToken, cookieOptions);

  // Verify cookie was set
  logger.debug('Cookie set, checking response headers...');
};

const clearSessionCookie = (res: Response): void => {
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieName = isProduction ? '__Host-session' : 'session';

  res.clearCookie(cookieName, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/',
    // Don't set domain in development to allow localhost
    ...(isProduction ? {} : { domain: undefined })
  });
};

// IP extraction utility
const extractClientIp = (req: Request): string => {
  // If behind trusted proxy, check X-Forwarded-For
  if (req.app.get('trust proxy')) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const ips = typeof forwarded === 'string'
        ? forwarded.split(',').map(ip => ip.trim())
        : forwarded;
      return ips[0] || req.socket.remoteAddress || '0.0.0.0';
    }
  }
  return req.socket.remoteAddress || '0.0.0.0';
};

const router = Router();
const authService = AuthService.getInstance();
const redisService = RedisService.getInstance();

// Password requirements (static data)
const PASSWORD_REQUIREMENTS = {
  minLength: 8,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true
};

// Rate limiting middleware
const loginRateLimit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const ip = extractClientIp(req);
    const email = req.body.email?.toLowerCase();

    const [ipCount, emailCount] = await Promise.all([
      redisService.incrementRateLimit(`login:ip:${ip}`, 900), // 15 minutes
      email ? redisService.incrementRateLimit(`login:email:${email}`, 900) : 0
    ]);

    if (ipCount > 10) {
      res.status(429).json({
        success: false,
        message: 'Too many login attempts from this IP. Please try again later.'
      });
      return;
    }

    if (email && emailCount > 5) {
      res.status(429).json({
        success: false,
        message: 'Too many login attempts for this account. Please try again later.'
      });
      return;
    }

    next();
  } catch (error) {
    logger.error('Rate limit check failed', { error });
    next(); // Fail open for availability
  }
};

// Validation middleware
const validateSignup = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8, max: 128 }).withMessage('Password must be 8-128 characters'),
  body('firstName').trim().isLength({ min: 1 }).withMessage('First name is required'),
  body('tenantId').optional().matches(/^[A-Za-z0-9]{13}$/).withMessage('Tenant ID must be 13 alphanumeric characters')
];

const validateLogin = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
  body('rememberMe').optional().isBoolean().withMessage('Remember me must be boolean')
];

const validateEmailVerification = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('code').isLength({ min: 6, max: 6 }).isNumeric().withMessage('Valid 6-digit code is required')
];

const validatePasswordReset = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required')
];

const validatePasswordResetConfirm = [
  body('token').notEmpty().withMessage('Reset token is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
];

const validateResendCode = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required')
];

// New validations for two-step signup
const validatePreSignup = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('name').trim().isLength({ min: 1 }).withMessage('Name is required')
];

const validateCompleteSignup = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8, max: 128 }).withMessage('Password must be 8-128 characters')
  // tenantId is now optional - server will generate 13-character alphanumeric ID
];

// Helper function to handle validation errors
const handleValidationErrors = (req: Request, res: Response): boolean => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
    return false;
  }
  return true;
};

/**
 * @route   POST /auth/signup
 * @desc    Register a new user
 * @access  Public
 */
router.post('/signup', validateSignup, async (req: Request, res: Response) => {
  try {
    if (!handleValidationErrors(req, res)) return;

    const { email, password, firstName, tenantId } = req.body;

    const result = await authService.signup({
      email,
      password,
      firstName,
      tenantId
    });

    if (result.success) {
      res.status(201).json({
        success: true,
        message: result.message,
        requiresEmailVerification: result.requiresEmailVerification,
        verificationCodeSent: result.verificationCodeSent
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    logger.error('Signup route error', { error });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @route   POST /auth/verify-email
 * @desc    Verify email with code
 * @access  Public
 */
router.post('/verify-email', validateEmailVerification, async (req: Request, res: Response) => {
  try {
    if (!handleValidationErrors(req, res)) return;

    const { email, code } = req.body;

    // First try pending-signup verification; if not present, fall back to existing verifyEmail
    const pendingCheck = await authService.verifyPendingSignup(email, code);
    if (pendingCheck.success) {
      return res.status(200).json({ success: true, message: pendingCheck.message });
    }
    const result = await authService.verifyEmail(email, code);

    if (result.success) {
      return res.status(200).json({
        success: true,
        message: result.message,
        user: result.user
      });
    } else {
      return res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    logger.error('Email verification route error', { error });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @route   POST /auth/pre-signup
 * @desc    Start signup: validate email, rate limit by IP+email, send code
 * @access  Public
 */
router.post('/pre-signup', validatePreSignup, async (req: Request, res: Response) => {
  try {
    if (!handleValidationErrors(req, res)) return;
    const ip = extractClientIp(req);
    const { email, name } = req.body;
    const result = await authService.preSignup({ email, name, ip });
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.status(200).json(result);
  } catch (error) {
    logger.error('Pre-signup route error', { error });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * @route   POST /auth/complete-signup
 * @desc    Complete signup with password, create user
 * @access  Public
 */
router.post('/complete-signup', validateCompleteSignup, async (req: Request, res: Response) => {
  try {
    if (!handleValidationErrors(req, res)) return;
    const { email, password, tenantId } = req.body;

    logger.info('Complete signup request', { email, hasPassword: !!password, tenantId });

    const result = await authService.completeSignup({ email, password, tenantId });

    logger.info('Complete signup result', { success: result.success, message: result.message });

    if (!('success' in result) || !result.success) {
      return res.status(400).json(result);
    }

    // Set secure session cookie if sessionToken is provided
    if (result.sessionToken) {
      const tokenHash = crypto.createHash('sha256').update(result.sessionToken).digest('hex').substring(0, 16);
      logger.debug('Setting session cookie', { tokenHash });
      setSessionCookie(res, result.sessionToken, false, req);
      logger.debug('Cookie set successfully');
    } else {
      logger.warn('No sessionToken provided in result', { result });
    }

    return res.status(201).json({
      success: true,
      message: result.message,
      user: result.user,
      sessionToken: result.sessionToken // Include sessionToken in response for frontend
    });
  } catch (error) {
    logger.error('Complete-signup route error', { error });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * @route   POST /auth/login
 * @desc    Login user
 * @access  Public
 */
router.post('/login', loginRateLimit, validateLogin, async (req: Request, res: Response) => {
  try {
    if (!handleValidationErrors(req, res)) return;

    const { email, password, rememberMe } = req.body;

    const result = await authService.login(email, password, rememberMe);

    if (result.success) {
      // Clear rate limiting data on successful login
      try {
        const ip = extractClientIp(req);
        await redisService.cleanupLoginRateLimit(email, ip);
        logger.info('Login rate limits cleared for IP and email');
      } catch (rateErr) {
        logger.warn('Failed to clear login rate limits', { error: rateErr });
        // Non-fatal; continue
      }

      // Set secure cookie with session token
      setSessionCookie(res, result.sessionToken!, rememberMe, req);

      return res.status(200).json({
        success: true,
        message: 'Login successful',
        user: result.user,
        sessionToken: result.sessionToken, // Include sessionToken in response for frontend
        workspaceId: result.workspaceId
      });
    } else {
      const statusCode = result.accountLocked ? 423 :
        result.requiresEmailVerification ? 403 : 401;

      return res.status(statusCode).json({
        success: false,
        message: result.message,
        requiresEmailVerification: result.requiresEmailVerification,
        accountLocked: result.accountLocked,
        lockExpiry: result.lockExpiry
      });
    }
  } catch (error) {
    logger.error('Login route error', { error });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @route   POST /auth/logout
 * @desc    Logout user
 * @access  Private
 */
router.post('/logout', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await authService.logout(req.user!.sessionToken);

    if (result.success) {
      // Clear session cookie
      clearSessionCookie(res);
      res.status(200).json({
        success: true,
        message: result.message
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    logger.error('Logout route error', { error });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @route   POST /auth/revoke-all
 * @desc    Revoke all sessions for current user
 * @access  Private
 */
router.post('/revoke-all', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await authService.revokeAllSessions(req.user!.id);
    if (result.success) {
      clearSessionCookie(res);
      return res.status(200).json({ success: true, message: result.message });
    }
    return res.status(500).json({ success: false, message: result.message });
  } catch (error) {
    logger.error('Revoke-all route error', { error });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * @route   POST /auth/validate-session
 * @desc    Validate session token
 * @access  Public
 */
router.post('/validate-session', async (req: Request, res: Response) => {
  try {
    const { sessionToken } = req.body;

    if (!sessionToken) {
      return res.status(400).json({
        success: false,
        message: 'Session token is required'
      });
    }

    const result = await authService.validateSession(sessionToken);

    if (result.success) {
      return res.status(200).json({
        success: true,
        user: result.user
      });
    } else {
      return res.status(401).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    logger.error('Session validation route error', { error });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @route   POST /auth/forgot-password
 * @desc    Request password reset
 * @access  Public
 */
router.post('/forgot-password', validatePasswordReset, async (req: Request, res: Response) => {
  try {
    if (!handleValidationErrors(req, res)) return;

    const { email } = req.body;
    const ip = extractClientIp(req);

    const result = await authService.requestPasswordReset(email, ip);

    if (result.success) {
      res.status(200).json({
        success: true,
        message: result.message,
        emailSent: result.emailSent
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    logger.error('Forgot password route error', { error });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @route   POST /auth/reset-password
 * @desc    Reset password with token
 * @access  Public
 */
router.post('/reset-password', validatePasswordResetConfirm, async (req: Request, res: Response) => {
  try {
    if (!handleValidationErrors(req, res)) return;

    const { token, password } = req.body;

    const result = await authService.resetPassword(token, password);

    if (result.success) {
      // Rate limits are cleaned up by AuthService.resetPassword()
      logger.info('Password reset completed successfully');

      res.status(200).json({
        success: true,
        message: result.message
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    logger.error('Reset password route error', { error });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @route   POST /auth/resend-verification
 * @desc    Resend verification code
 * @access  Public
 */
router.post('/resend-verification', validateResendCode, async (req: Request, res: Response) => {
  try {
    if (!handleValidationErrors(req, res)) return;

    const { email } = req.body;

    const result = await authService.resendVerificationCode(email);

    if (result.success) {
      res.status(200).json({
        success: true,
        message: result.message
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    logger.error('Resend verification route error', { error });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @route   GET /auth/me
 * @desc    Get current user info
 * @access  Private
 */
router.get('/me', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user;

    res.status(200).json({
      success: true,
      user: {
        id: user!.id,
        email: user!.email,
        tenantId: user!.tenantId
      }
    });
  } catch (error) {
    logger.error('Get user info route error', { error });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @route   GET /auth/session-status
 * @desc    Check session status
 * @access  Private
 */
router.get('/session-status', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    res.status(200).json({
      success: true,
      message: 'Session is valid',
      user: {
        id: req.user!.id,
        email: req.user!.email,
        tenantId: req.user!.tenantId,
      }
    });
  } catch (error) {
    logger.error('Session status route error', { error });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @route   GET /auth/password-requirements
 * @desc    Get password requirements
 * @access  Public
 */
/**
 * @route   GET /auth/password-requirements
 * @desc    Get password requirements
 * @access  Public
 */
router.get('/password-requirements', (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    requirements: PASSWORD_REQUIREMENTS
  });
});

/**
 * @route   POST /auth/onboarding
 * @desc    Save onboarding data for authenticated user
 * @access  Private
 */
router.post('/onboarding', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { workspace_name, workflow_type, team_size, experience_level, referral_source } = req.body;

    if (!workspace_name) {
      return res.status(400).json({
        success: false,
        message: 'Workspace name is required'
      });
    }

    const result = await authService.saveOnboardingData(req.user!.id, {
      workspace_name,
      workflow_type,
      team_size,
      experience_level,
      referral_source
    }, req.user!.sessionToken);

    if (result.success) {
      return res.status(200).json({
        success: true,
        message: 'Onboarding data saved successfully',
        workspaceId: result.workspaceId
      });
    } else {
      return res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    logger.error('Save onboarding data route error', { error });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @route   GET /auth/onboarding
 * @desc    Get onboarding data for authenticated user
 * @access  Private
 */
router.get('/onboarding', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await authService.getOnboardingData(req.user!.id);

    if (result.success) {
      return res.status(200).json({
        success: true,
        data: result.data,
        completed: result.completed
      });
    } else {
      return res.status(404).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    logger.error('Get onboarding data route error', { error });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

export default router;
