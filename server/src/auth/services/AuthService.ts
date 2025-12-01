// auth/services/AuthService.ts
import TenantsRepository from '../../database/repositories/TenantsRepository';
import WorkspacesRepository from '../../database/repositories/WorkspacesRepository';
import crypto from 'crypto';
import EmailVerificationCodesRepository from '../repositories/EmailVerificationCodesRepository';
import PasswordService from './PasswordService';
import EmailService from './EmailService';
import SessionService from './SessionService';
import { RedisService } from './RedisService';
import logger from '../../utils/logger';

// Type definitions for better type safety
interface TenantAuthData {
  id: string;
  email: string;
  name: string;
  first_name?: string;
  last_name?: string | null;
  password_hash: string;
  email_verified: boolean;
  tenant_id?: string; // Make optional since it might not always be present
  password_reset_token?: string | null;
  password_reset_expires?: Date | null;
  created_at: string;
  updated_at: string;
  last_login?: Date | null;
  role?: string; // Add role field
}

interface PendingSignupData {
  email: string;
  name: string;
  code: string;
  ip: string;
  requestedAt: number;
  requestCount: number;
  userId: string;
}

// Structured error handling
class AuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

// Rate limiting constants
const RATE_LIMITS = {
  SIGNUP_MAX_ATTEMPTS: 3,
  SIGNUP_WINDOW_MINUTES: 15,
  PASSWORD_RESET_MAX_ATTEMPTS: 3,
  PASSWORD_RESET_WINDOW_MINUTES: 60,
  PRE_SIGNUP_MAX_ATTEMPTS: 30,
  PRE_SIGNUP_WINDOW_HOURS: 1,
} as const;

// Utility functions for ID generation
function generateAlphanumericId(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes)
    .map(byte => chars[byte % chars.length])
    .join('');
}

function generateSessionId(): string {
  return generateAlphanumericId(32);
}

function generateTenantId(): string {
  return generateAlphanumericId(13);
}

export interface LoginResult {
  success: boolean;
  user?: {
    id: string;
    email: string;
    firstName: string;
    lastName?: string | undefined;
    role: string;
    tenantId: string;
    emailVerified: boolean;
  };
  sessionToken?: string;
  message?: string;
  requiresEmailVerification?: boolean;
  accountLocked?: boolean;
  lockExpiry?: Date;
  workspaceId?: string;
}

export interface SignupResult {
  success: boolean;
  message: string;
  requiresEmailVerification?: boolean;
  verificationCodeSent?: boolean;
  user?: any;
  sessionToken?: string;
}

export interface VerificationResult {
  success: boolean;
  message: string;
  user?: any;
}

export interface PasswordResetResult {
  success: boolean;
  message: string;
  emailSent?: boolean;
}

export class AuthService {
  private static instance: AuthService;
  private tenantsRepository: typeof TenantsRepository;
  private emailVerificationRepository: typeof EmailVerificationCodesRepository;
  private passwordService: PasswordService;
  private emailService: EmailService;
  private sessionService: SessionService;
  private redisService: RedisService;

  private constructor() {
    this.tenantsRepository = TenantsRepository;
    this.emailVerificationRepository = EmailVerificationCodesRepository;
    this.passwordService = PasswordService.getInstance();
    this.emailService = EmailService.getInstance();
    this.sessionService = SessionService.getInstance();
    this.redisService = RedisService.getInstance();

    logger.info('Auth Service initialized');
  }

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  /**
   * Register a new user
   */
  async signup(userData: {
    email: string;
    password: string;
    firstName: string;
    tenantId: string;
  }): Promise<SignupResult> {
    try {
      // Validate password strength
      const passwordValidation = this.passwordService.validatePassword(userData.password);
      if (!passwordValidation.isValid) {
        return {
          success: false,
          message: `Password requirements not met: ${passwordValidation.errors.join(', ')}`
        };
      }

      // Check if tenant already exists
      const existingTenant = await this.tenantsRepository.findTenantByEmail(userData.email) as TenantAuthData | null;
      if (existingTenant) {
        return {
          success: false,
          message: 'Account with this email already exists'
        };
      }

      // Check rate limiting for email verification
      const hasTooManyAttempts = await this.emailVerificationRepository.hasTooManyRecentAttempts(
        userData.email,
        'signup',
        RATE_LIMITS.SIGNUP_MAX_ATTEMPTS,
        RATE_LIMITS.SIGNUP_WINDOW_MINUTES
      );

      if (hasTooManyAttempts) {
        return {
          success: false,
          message: 'Too many signup attempts. Please try again later.'
        };
      }

      // Hash password
      const passwordHash = await this.passwordService.hashPassword(userData.password);

      // Create tenant auth (use only firstName for name)
      const tenant = await this.tenantsRepository.createTenant({
        id: userData.tenantId,
        name: userData.firstName,
        email: userData.email,
        password_hash: passwordHash,
        email_verified: false
      });

      // Generate verification code
      const verificationCode = this.passwordService.generateVerificationCode();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      await this.emailVerificationRepository.createVerificationCode({
        email: userData.email,
        code: verificationCode,
        type: 'signup',
        expiresAt
      });

      // Send verification email
      try {
        await this.emailService.sendVerificationEmail(
          userData.email,
          verificationCode,
          userData.firstName
        );

        logger.info('Tenant signup successful', { tenantId: (tenant as any).id, email: (tenant as any).email });

        return {
          success: true,
          message: 'Account created successfully. Please check your email for verification code.',
          requiresEmailVerification: true,
          verificationCodeSent: true
        };
      } catch (emailError) {
        logger.error('Failed to send verification email during signup', {
          error: emailError,
          email: userData.email
        });

        return {
          success: true,
          message: 'Account created. Verification email could not be sent.',
          requiresEmailVerification: true,
          verificationCodeSent: false
        };
      }
    } catch (error) {
      logger.error('Signup failed', { error, email: userData.email });
      return {
        success: false,
        message: 'Signup failed. Please try again.'
      };
    }
  }

  /**
   * Pre-signup: validate email, rate-limit, and send verification code. Stores pending signup in Redis.
   */
  public async preSignup(params: { email: string; name: string; ip: string }): Promise<{ success: boolean; message: string }> {
    const email = params.email.toLowerCase().trim();
    const name = params.name.trim();
    try {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return { success: false, message: 'Valid email is required' };
      }
      if (!name || name.length < 1) {
        return { success: false, message: 'Name is required' };
      }

      // If tenant already exists, fail early
      const existingTenant = await this.tenantsRepository.findTenantByEmail(email) as TenantAuthData | null;
      if (existingTenant) {
        return { success: false, message: 'Account with this email already exists' };
      }

      // Composite rate limit: IP + email - stored in Redis with 1 hour TTL
      const rateLimitKey = ['pre_signup', params.ip || 'unknown', email];
      const count = await this.redisService.incrementCompositeRateLimit(rateLimitKey, RATE_LIMITS.PRE_SIGNUP_WINDOW_HOURS * 3600);
      if (count > RATE_LIMITS.PRE_SIGNUP_MAX_ATTEMPTS) {
        return { success: false, message: 'Too many requests. Please try again later.' };
      }

      // Generate code and store pending signup in Redis (1 hour TTL)
      const code = this.passwordService.generateVerificationCode();
      const pendingData: PendingSignupData = {
        email,
        name,
        code,
        ip: params.ip || 'unknown',
        requestedAt: Date.now(),
        requestCount: count,
        userId: `temp_${Date.now()}_${generateAlphanumericId(9)}` // Temporary user ID
      };

      await this.redisService.setPendingSignup(email, pendingData, RATE_LIMITS.PRE_SIGNUP_WINDOW_HOURS * 3600);

      // Send verification email
      await this.emailService.sendVerificationEmail(email, code, name);

      logger.info('Pre-signup successful', {
        emailHash: crypto.createHash('sha256').update(email).digest('hex').slice(0, 16),
        name,
        ip: params.ip,
        requestCount: count
      });

      return { success: true, message: 'Verification code sent' };
    } catch (error) {
      logger.error('Pre-signup error', { error, emailHash: crypto.createHash('sha256').update(email).digest('hex').slice(0, 16) });
      return { success: false, message: 'Internal server error' };
    }
  }

  /**
   * Verify email against pending signup
   */
  public async verifyPendingSignup(email: string, code: string): Promise<{ success: boolean; message: string; name?: string; userId?: string }> {
    try {
      const pending = await this.redisService.getPendingSignup(email);
      if (!pending) {
        return { success: false, message: 'No pending signup found' };
      }
      if (pending.code !== code) {
        return { success: false, message: 'Invalid verification code' };
      }
      return {
        success: true,
        message: 'Email verified',
        name: pending.name,
        userId: pending.userId
      };
    } catch (error) {
      logger.error('Verify pending signup error', { error, email });
      return { success: false, message: 'Internal server error' };
    }
  }

  /**
   * Complete signup: create tenant with email, name, password
   */
  public async completeSignup(params: { email: string; password: string; tenantId?: string }): Promise<SignupResult> {
    try {
      const email = params.email.toLowerCase();
      const pending = await this.redisService.getPendingSignup(email);
      if (!pending) {
        return { success: false, message: 'No pending signup found to complete' } as any;
      }

      // Validate password rules
      const passwordValidation = this.passwordService.validatePassword(params.password);
      if (!passwordValidation.isValid) {
        return {
          success: false,
          message: `Password requirements not met: ${passwordValidation.errors.join(', ')}`
        } as any;
      }

      // Check if tenant already exists
      const existingTenant = await this.tenantsRepository.findTenantByEmail(email) as TenantAuthData | null;
      if (existingTenant) {
        return { success: false, message: 'Account with this email already exists' } as any;
      }

      // Generate 13-character alphanumeric tenant ID
      const tenantId = params.tenantId || generateTenantId();

      // Hash password and create tenant in database (clean data - no lastName, password_reset fields)
      const passwordHash = await this.passwordService.hashPassword(params.password);

      let tenant: TenantAuthData;
      try {
        tenant = await this.tenantsRepository.createTenant({
          id: tenantId,
          name: pending.name,
          email,
          password_hash: passwordHash,
          email_verified: true // Mark as verified since we verified the email
        }) as TenantAuthData;
      } catch (error: any) {
        // Handle duplicate key error (race condition)
        if (error.code === '23505' || error.message?.includes('duplicate key')) {
          return { success: false, message: 'Email already registered' } as any;
        }
        throw error; // Re-throw other errors
      }

      // Create session using SessionService (no workspaceId yet - will be set during onboarding)
      const sessionData = {
        id: tenant.id,
        email: tenant.email,
        tenant_id: tenant.id,
        first_name: pending.name,
        last_name: null,
        email_verified: true,
        role: 'owner'
      };
      const { token: sessionToken } = await this.sessionService.createOrReplaceSession(
        sessionData,
        false,
        undefined,
        undefined,
        null, // No workspace yet
        [] // No workspaces yet
      );

      // Cleanup ALL signup-related data from Redis
      await this.redisService.deletePendingSignup(email);

      // Clean up rate limiting data for this email/IP combination
      await this.redisService.cleanupSignupRateLimit(email, pending.ip);

      const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex').substring(0, 16);
      logger.info('Tenant signup completed with session', {
        tenantId: tenant.id,
        email: tenant.email,
        name: pending.name,
        sessionHash: tokenHash
      });

      return {
        success: true,
        message: 'Signup completed successfully',
        requiresEmailVerification: false,
        verificationCodeSent: false,
        user: {
          id: tenant.id,
          email: tenant.email,
          tenantId: tenant.id
        },
        sessionToken: sessionToken // Return session token for cookie
      } as any;
    } catch (error) {
      logger.error('Complete signup error', { error, email: params.email });
      return { success: false, message: 'Internal server error' } as any;
    }
  }

  /**
   * Verify email with code
   */
  async verifyEmail(email: string, code: string): Promise<VerificationResult> {
    try {
      // Find valid verification code
      const verificationCode = await this.emailVerificationRepository.findValidCode(
        email,
        code,
        'signup'
      );

      if (!verificationCode) {
        // Increment attempts for the email
        const user = await this.tenantsRepository.findTenantByEmail(email) as any;
        if (user) {
          // Find the verification code to increment attempts
          const existingCode = await this.emailVerificationRepository.findValidCode(email, code, 'signup');
          if (existingCode) {
            await this.emailVerificationRepository.incrementAttempts(existingCode.id);
          }
        }

        return {
          success: false,
          message: 'Invalid or expired verification code'
        };
      }

      // Mark code as verified
      await this.emailVerificationRepository.markAsVerified(verificationCode.id);

      // Update tenant email verification status
      const tenant = await this.tenantsRepository.findTenantByEmail(email) as any;
      if (!tenant) {
        return {
          success: false,
          message: 'Tenant not found'
        };
      }

      await this.tenantsRepository.markTenantEmailAsVerified((tenant as any).id);

      // Send welcome email
      try {
        await this.emailService.sendWelcomeEmail(email, (tenant as any).first_name as any);
      } catch (emailError) {
        logger.error('Failed to send welcome email', { error: emailError, email });
      }

      logger.info('Email verification successful', { tenantId: (tenant as any).id, email });

      return {
        success: true,
        message: 'Email verified successfully',
        user: {
          id: (tenant as any).id,
          email: (tenant as any).email,
          firstName: (tenant as any).first_name || (tenant as any).name,
          lastName: (tenant as any).last_name,
          role: 'owner',
          tenantId: (tenant as any).id,
          emailVerified: true
        }
      };
    } catch (error) {
      logger.error('Email verification failed', { error, email });
      return {
        success: false,
        message: 'Email verification failed. Please try again.'
      };
    }
  }

  /**
   * Login user
   */
  async login(email: string, password: string, rememberMe: boolean = false): Promise<LoginResult> {
    try {
      // Always perform password hash comparison to prevent timing attacks
      // Use a dummy hash if user doesn't exist
      const user = await this.tenantsRepository.findTenantByEmail(email) as TenantAuthData | null;
      const dummyHash = '$2b$12$dummy.hash.to.prevent.timing.attacks.and.user.enumeration';
      const passwordHash = user?.password_hash || dummyHash;

      // Verify password (always takes same time regardless of user existence)
      const isPasswordValid = await this.passwordService.comparePassword(password, passwordHash);

      if (!isPasswordValid || !user) {
        return {
          success: false,
          message: 'Invalid email or password'
        };
      }

      // Check if email is verified (only after confirming valid credentials)
      if (!user.email_verified) {
        return {
          success: false,
          message: 'Invalid email or password' // Don't reveal verification status
        };
      }

      // SECURITY FIX #3: Check tenant status before allowing login
      const isTenantActive = await this.tenantsRepository.validateTenantActive(user.id);
      if (!isTenantActive) {
        logger.warn('Login blocked: tenant not active', { userId: user.id });
        return {
          success: false,
          message: 'Account suspended or inactive. Please contact support.'
        };
      }

      // Create/replace session
      const { token: sessionToken } = await this.sessionService.createOrReplaceSession({
        ...user,
        role: 'owner',
        tenant_id: user.id,
        first_name: user.first_name || user.name || '',
        last_name: user.last_name || null
      }, rememberMe, undefined, undefined, (user as any).metadata?.workspaces?.[0]?.id ?? null, (user as any).metadata?.workspaces?.map((w: any) => w.id));

      // Update last login
      await this.tenantsRepository.updateTenantLastLogin(user.id);

      // Clear login rate limits for this email (backend-side safeguard)
      try {
        await this.redisService.cleanupLoginRateLimitForEmail(user.email);
      } catch (e) {
        logger.warn('Failed to clear email login rate limit after successful login', { error: e });
      }

      let workspaceId: string | undefined;
      // SECURITY FIX #2: Cache workspace in Redis (cache-only - DO NOT use for authorization)
      // Note: This is a performance optimization. All authorization MUST validate against Postgres.
      try {
        const workspaces = await WorkspacesRepository.getWorkspacesByTenant(user.id);
        const firstWorkspace = workspaces[0];
        if (firstWorkspace?.id) {
          workspaceId = firstWorkspace.id;
          // Cache only - never trust this for authorization decisions
          await this.redisService.setJson(`workspace:${firstWorkspace.id}`, firstWorkspace, 24 * 60 * 60);
        }
      } catch (e) {
        logger.warn('Failed to write workspace json after login', { error: e });
      }

      logger.info('User login successful', {
        userId: user.id,
        emailHash: crypto.createHash('sha256').update(user.email).digest('hex').slice(0, 16),
        tenantId: user.id,
        rememberMe
      });

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name || user.name,
          lastName: user.last_name || undefined,
          tenantId: user.tenant_id || user.id,
          emailVerified: user.email_verified,
          role: 'owner'
        },
        sessionToken,
        ...(workspaceId ? { workspaceId } : {})
      };
    } catch (error) {
      logger.error('Login failed', { error, emailHash: crypto.createHash('sha256').update(email).digest('hex').slice(0, 16) });
      return {
        success: false,
        message: 'Login failed. Please try again.'
      };
    }
  }

  /**
   * Logout user
   */
  async logout(sessionToken: string): Promise<{ success: boolean; message: string }> {
    try {
      const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex').substring(0, 16);
      await this.sessionService.revoke(sessionToken);

      logger.info('User logout successful', { sessionHash: tokenHash });

      return {
        success: true,
        message: 'Logged out successfully'
      };
    } catch (error) {
      const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex').substring(0, 16);
      logger.error('Logout failed', { error, sessionHash: tokenHash });
      return {
        success: false,
        message: 'Logout failed'
      };
    }
  }

  /**
   * Revoke all sessions for a user (single-session model: just remove mapping and any active session)
   */
  async revokeAllSessions(userId: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.sessionService.revokeAll(userId);
      logger.info('All sessions revoked for user', { userId });
      return { success: true, message: 'All sessions revoked' };
    } catch (error) {
      logger.error('Failed to revoke all sessions', { error, userId });
      return { success: false, message: 'Failed to revoke sessions' };
    }
  }

  /**
   * Validate session and get user data
   */
  async validateSession(sessionToken: string): Promise<{ success: boolean; user?: any; message?: string }> {
    try {
      const session = await this.sessionService.validate(sessionToken);
      if (!session) {
        return {
          success: false,
          message: 'Invalid or expired session'
        };
      }

      // Get fresh tenant data from database
      const user = await this.tenantsRepository.findTenantById(session.userId) as TenantAuthData | null;
      if (!user) {
        // User no longer exists, invalidate session
        await this.redisService.deleteSession(sessionToken);
        return {
          success: false,
          message: 'User not found'
        };
      }

      // SECURITY FIX #5: Verify session tenant matches DB tenant
      if (user.id !== session.userId) {
        logger.error('SECURITY: Session tenant mismatch detected', {
          sessionUserId: session.userId,
          dbUserId: user.id,
          message: 'Session userId does not match database user'
        });
        await this.redisService.deleteSession(sessionToken);
        return {
          success: false,
          message: 'Session tenant mismatch'
        };
      }

      // SECURITY FIX #3: Check email verification and tenant status
      if (!user.email_verified) {
        return {
          success: false,
          message: 'Email verification required'
        };
      }

      // Check tenant status (active, not suspended/banned, trial not expired)
      const isTenantActive = await this.tenantsRepository.validateTenantActive(session.userId);
      if (!isTenantActive) {
        logger.warn('Session validation failed: tenant not active', { userId: session.userId });
        await this.redisService.deleteSession(sessionToken);
        return {
          success: false,
          message: 'Account suspended or inactive'
        };
      }

      // Check workspace status if workspace is set
      if (session.workspaceId) {
        const isWorkspaceActive = await WorkspacesRepository.validateWorkspaceActive(session.workspaceId);
        if (!isWorkspaceActive) {
          logger.warn('Session validation failed: workspace not active', { workspaceId: session.workspaceId });
          return {
            success: false,
            message: 'Workspace inactive or disabled'
          };
        }

        // CRITICAL FIX #2: Verify workspace ownership to prevent cross-tenant access
        const ownsWorkspace = await WorkspacesRepository.validateWorkspaceOwnership(
          session.workspaceId,
          session.userId
        );

        if (!ownsWorkspace) {
          logger.error('SECURITY: Workspace access violation detected', {
            userId: session.userId,
            workspaceId: session.workspaceId,
            message: 'User attempted to access workspace they do not own'
          });
          await this.redisService.deleteSession(sessionToken);
          return {
            success: false,
            message: 'Workspace access violation'
          };
        }
      }

      // Update session with fresh data
      const updatedSessionData = {
        ...session,
        email: user.email,
        tenantId: user.id,
        role: 'owner',
        firstName: user.first_name,
        lastName: user.last_name,
        emailVerified: user.email_verified
      };

      // Ensure mapping is still valid (defense-in-depth)
      const sessionMappingValid = true; // Single-session model: SessionService ensures mapping on create
      if (!sessionMappingValid) {
        return { success: false, message: 'Session mapping invalid' };
      }

      await this.sessionService.refresh(sessionToken, !!session.rememberMe);

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          tenantId: user.id,
          emailVerified: user.email_verified
        }
      };
    } catch (error) {
      const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex').substring(0, 16);
      logger.error('Session validation failed', { error, sessionHash: tokenHash });
      return {
        success: false,
        message: 'Session validation failed'
      };
    }
  }

  /**
   * Request password reset - Secure implementation using Redis
   */
  async requestPasswordReset(email: string, ip: string): Promise<PasswordResetResult> {
    try {
      const normalizedEmail = email.toLowerCase().trim();

      // Always check if user exists first (but don't reveal existence)
      const user = await this.tenantsRepository.findTenantByEmail(normalizedEmail) as TenantAuthData | null;

      // Rate limiting using Redis (IP + email combination)
      const rateLimitKey = ['password_reset', ip, normalizedEmail];
      const attemptCount = await this.redisService.incrementCompositeRateLimit(
        rateLimitKey,
        RATE_LIMITS.PASSWORD_RESET_WINDOW_MINUTES * 60 // Convert to seconds
      );

      if (attemptCount > RATE_LIMITS.PASSWORD_RESET_MAX_ATTEMPTS) {
        return {
          success: false,
          message: 'Too many password reset attempts. Please try again later.'
        };
      }

      // If user doesn't exist, still return success to prevent email enumeration
      if (!user) {
        return {
          success: true,
          message: 'If the email exists, a password reset link has been sent.',
          emailSent: false
        };
      }

      // Generate secure reset token (32 characters)
      const resetToken = generateSessionId(); // 32-character alphanumeric token
      const expiresAt = Date.now() + (60 * 60 * 1000); // 1 hour from now

      // Store reset data in Redis (secure, no user data except email)
      const resetData = {
        email: normalizedEmail,
        token: resetToken,
        expiresAt,
        requestedAt: Date.now(),
        ip,
        attemptCount
      };

      // Store with 1 hour TTL
      await this.redisService.setCache(`password_reset:${resetToken}`, resetData, 3600);

      // Generate secure reset link
      const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/reset-password?token=${resetToken}`;

      // Send reset email
      try {
        await this.emailService.sendPasswordResetEmail(
          normalizedEmail,
          resetLink,
          user.first_name || 'User'
        );

        logger.info('Password reset email sent', {
          emailHash: crypto.createHash('sha256').update(normalizedEmail).digest('hex').slice(0, 16),
          ip,
          attemptCount
        });

        return {
          success: true,
          message: 'Password reset link has been sent to your email.',
          emailSent: true
        };
      } catch (emailError) {
        logger.error('Failed to send password reset email', { error: emailError, email: normalizedEmail });
        return {
          success: false,
          message: 'Failed to send password reset email. Please try again.'
        };
      }
    } catch (error) {
      logger.error('Password reset request failed', { error, email });
      return {
        success: false,
        message: 'Password reset request failed. Please try again.'
      };
    }
  }

  /**
   * Update user metadata (tenant metadata)
   */
  async updateUserMetadata(userId: string, metadata: any): Promise<{ success: boolean; message: string; user?: any }> {
    try {
      // Get current user to merge metadata
      const user = await this.tenantsRepository.findTenantById(userId) as any;
      if (!user) {
        return { success: false, message: 'User not found' };
      }

      const currentMetadata = user.metadata || {};
      const newMetadata = {
        ...currentMetadata,
        ...metadata
      };

      const success = await this.tenantsRepository.updateTenantMetadata(userId, newMetadata);

      if (success) {
        return {
          success: true,
          message: 'User metadata updated successfully',
          user: {
            ...user,
            metadata: newMetadata
          }
        };
      } else {
        return { success: false, message: 'Failed to update user metadata' };
      }
    } catch (error) {
      logger.error('Update user metadata failed', { error, userId });
      return { success: false, message: 'Internal server error' };
    }
  }

  /**
   * Reset password with token - Secure implementation using Redis
   */
  async resetPassword(token: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    try {
      // Validate password strength
      const passwordValidation = this.passwordService.validatePassword(newPassword);
      if (!passwordValidation.isValid) {
        return {
          success: false,
          message: `Password requirements not met: ${passwordValidation.errors.join(', ')}`
        };
      }

      // Get reset data from Redis
      const resetData = await this.redisService.getCache(`password_reset:${token}`) as any;

      if (!resetData) {
        return {
          success: false,
          message: 'Invalid or expired password reset token'
        };
      }

      // Check if token is expired
      if (Date.now() > resetData.expiresAt) {
        // Clean up expired token
        await this.redisService.deleteCache(`password_reset:${token}`);
        return {
          success: false,
          message: 'Password reset token has expired. Please request a new one.'
        };
      }

      // Find user by email
      const user = await this.tenantsRepository.findTenantByEmail(resetData.email) as TenantAuthData | null;

      if (!user) {
        return {
          success: false,
          message: 'User not found. Please request a new password reset.'
        };
      }

      // Hash new password
      const passwordHash = await this.passwordService.hashPassword(newPassword);

      // Update password in database
      await this.tenantsRepository.updateTenantPassword(user.id, passwordHash);

      // Clean up reset token from Redis
      await this.redisService.deleteCache(`password_reset:${token}`);

      // Clean up rate limiting data for this email/IP combination
      try {
        const rateLimitKey = ['password_reset', resetData.ip, resetData.email];
        const compositeKey = String(rateLimitKey.map(String).join(':')).toLowerCase();
        await this.redisService.deleteCache(`rate_limit:${compositeKey}`);
        logger.info('Password reset rate limits cleaned up', { email: resetData.email, ip: resetData.ip });
      } catch (cleanupErr) {
        // Non-fatal error
        logger.warn('Failed to cleanup password reset rate limits', { error: cleanupErr });
      }

      logger.info('Password reset successful', {
        userId: user.id,
        emailHash: crypto.createHash('sha256').update(user.email).digest('hex').slice(0, 16)
      });

      return {
        success: true,
        message: 'Password has been reset successfully'
      };
    } catch (error) {
      logger.error('Password reset failed', { error });
      return {
        success: false,
        message: 'Password reset failed. Please try again.'
      };
    }
  }


  /**
   * Resend verification code
   */
  async resendVerificationCode(email: string): Promise<{ success: boolean; message: string }> {
    try {
      const user = await this.tenantsRepository.findTenantByEmail(email) as TenantAuthData | null;
      if (!user) {
        return {
          success: false,
          message: 'User not found'
        };
      }

      if (user.email_verified) {
        return {
          success: false,
          message: 'Email is already verified'
        };
      }

      // Check rate limiting
      const hasTooManyAttempts = await this.emailVerificationRepository.hasTooManyRecentAttempts(
        email,
        'signup',
        RATE_LIMITS.SIGNUP_MAX_ATTEMPTS,
        RATE_LIMITS.SIGNUP_WINDOW_MINUTES
      );

      if (hasTooManyAttempts) {
        return {
          success: false,
          message: 'Too many verification code requests. Please try again later.'
        };
      }

      // Generate new verification code
      const verificationCode = this.passwordService.generateVerificationCode();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      await this.emailVerificationRepository.createVerificationCode({
        email,
        code: verificationCode,
        type: 'signup',
        expiresAt
      });

      // Send verification email
      try {
        await this.emailService.sendVerificationEmail(
          email,
          verificationCode,
          user.first_name || user.name
        );

        logger.info('Verification code resent', { userId: user.id, email });

        return {
          success: true,
          message: 'Verification code has been sent to your email.'
        };
      } catch (emailError) {
        logger.error('Failed to resend verification email', { error: emailError, email });
        return {
          success: false,
          message: 'Failed to send verification code. Please try again.'
        };
      }
    } catch (error) {
      logger.error('Resend verification code failed', { error, email });
      return {
        success: false,
        message: 'Failed to resend verification code. Please try again.'
      };
    }
  }

  /**
   * Save onboarding data for a tenant
   */
  async saveOnboardingData(
    tenantId: string,
    data: {
      workspace_name: string;
      workflow_type?: string;
      team_size?: string;
      experience_level?: string;
      referral_source?: string;
    },
    sessionToken?: string
  ): Promise<{ success: boolean; message: string; workspaceId?: string }> {
    try {
      // Find tenant
      const tenant = await this.tenantsRepository.findTenantById(tenantId) as any;
      if (!tenant) {
        return {
          success: false,
          message: 'Tenant not found'
        };
      }

      // Store onboarding data in tenant metadata
      const metadata = tenant.metadata || {};
      metadata.onboarding_data = {
        workspace_name: data.workspace_name,
        workflow_type: data.workflow_type || null,
        team_size: data.team_size || null,
        experience_level: data.experience_level || null,
        referral_source: data.referral_source || null,
        completed_at: new Date().toISOString()
      };
      metadata.onboarding_completed = true;
      metadata.onboarding_completed_at = new Date().toISOString();

      // Update tenant metadata
      await this.tenantsRepository.updateTenantMetadata(tenantId, metadata);

      // Create workspace with the exact provided name (no modifications)
      // Check if workspace already exists
      const existingWorkspacesResult = await WorkspacesRepository.findByTenant(tenantId, { page: 1, limit: 1 });

      if (existingWorkspacesResult.totalCount === 0) {
        // Generate slug from workspace name
        const slug = data.workspace_name
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-');

        // Create workspace with the user's exact chosen name
        const workspaceId = crypto.randomUUID();
        const workspace = await WorkspacesRepository.createWorkspace({
          id: workspaceId,
          tenant_id: tenantId,
          email: tenant.email,
          name: data.workspace_name, // Use exact name provided by user
          slug: slug,
          description: null,
          status: 'active',
          metadata: {
            tenantId: tenantId,
            agentIds: [],
            settingsTableId: null,
            usageTableId: null
          }
        });

        // Update tenant counters and metadata with created workspace
        await this.tenantsRepository.updateTenantCounts(tenantId, { workspace_count: 1 });
        const tenantMetadata = {
          ...metadata,
          workspaces: [
            {
              id: workspace.id,
              name: workspace.name,
              slug: workspace.slug,
              status: workspace.status,
              createdAt: workspace.created_at,
              updatedAt: workspace.updated_at,
            }
          ]
        };
        await this.tenantsRepository.updateTenantMetadata(tenantId, tenantMetadata);

        // Cache workspace in Redis (cache-only - DO NOT use for authorization)
        try {
          const enrichedWorkspace = await WorkspacesRepository.findById(workspace.id);
          if (enrichedWorkspace) {
            await this.redisService.setJson(`workspace:${enrichedWorkspace.id}`, enrichedWorkspace, 24 * 60 * 60);
          }
        } catch (cacheError) {
          logger.warn('Failed to write workspace json after onboarding', { error: cacheError });
        }

        // Update user session with workspace ID
        if (sessionToken) {
          try {
            const updated = await this.sessionService.updateSessionWorkspace(sessionToken, workspace.id, [workspace.id]);
            if (updated) {
              logger.info('Session updated with workspace ID', { tenantId, workspaceId: workspace.id });
            } else {
              logger.warn('Failed to update session with workspace ID', { tenantId });
            }
          } catch (sessionError) {
            logger.error('Error updating session with workspace ID', { error: sessionError, tenantId });
          }
        } else {
          logger.warn('No session token provided for workspace update', { tenantId });
        }

        logger.info('Workspace created from onboarding', { tenantId, workspaceName: data.workspace_name, workspaceId: workspace.id });

        return {
          success: true,
          message: 'Onboarding data saved successfully',
          workspaceId: workspace.id
        };
      } else {
        // Workspace already exists, return the first one
        const existingWorkspace = existingWorkspacesResult.data[0];
        return {
          success: true,
          message: 'Onboarding data saved successfully',
          ...(existingWorkspace?.id ? { workspaceId: existingWorkspace.id } : {})
        };
      }

      logger.info('Onboarding data saved successfully', { tenantId });


    } catch (error) {
      logger.error('Failed to save onboarding data', { error, tenantId });
      return {
        success: false,
        message: 'Failed to save onboarding data'
      };
    }
  }

  /**
   * Get onboarding data for a tenant
   */
  async getOnboardingData(tenantId: string): Promise<{
    success: boolean;
    message?: string;
    data?: any;
    completed?: boolean;
  }> {
    try {
      const tenant = await this.tenantsRepository.findTenantById(tenantId) as any;

      if (!tenant || !tenant.metadata || !tenant.metadata.onboarding_data) {
        return {
          success: false,
          message: 'No onboarding data found',
          completed: false
        };
      }

      const onboardingData = tenant.metadata.onboarding_data;

      return {
        success: true,
        data: {
          workspace_name: onboardingData.workspace_name,
          workflow_type: onboardingData.workflow_type,
          team_size: onboardingData.team_size,
          experience_level: onboardingData.experience_level,
          referral_source: onboardingData.referral_source,
          completed_at: onboardingData.completed_at
        },
        completed: true
      };
    } catch (error) {
      logger.error('Failed to get onboarding data', { error, tenantId });
      return {
        success: false,
        message: 'Failed to get onboarding data',
        completed: false
      };
    }
  }

  // ==================== Security & Runtime Validation ====================

  /**
   * SECURITY FIX #8: Primary runtime security gate for agent execution
   * 
   * This method is THE SINGLE SOURCE OF TRUTH for whether an agent can execute.
   * Call this before:
   * - Starting agent jobs
   * - Processing webhook triggers
   * - Running scheduled workflows
   * 
   * @param tenantId - The tenant ID requesting execution
   * @param workspaceId - The workspace ID where execution will occur
   * @returns true if execution is allowed, false otherwise
   */
  async validateForAgentExecution(tenantId: string, workspaceId: string): Promise<boolean> {
    try {
      // 1. Validate tenant is active (checks status + trial expiry)
      const isTenantActive = await this.tenantsRepository.validateTenantActive(tenantId);
      if (!isTenantActive) {
        logger.warn('Agent execution blocked: tenant not active', { tenantId });
        return false;
      }

      // 2. Validate tenant email is verified
      const tenant = await this.tenantsRepository.findTenantById(tenantId);
      if (!tenant || !(tenant as any).email_verified) {
        logger.warn('Agent execution blocked: email not verified', { tenantId });
        return false;
      }

      // 3. Validate workspace exists and is active
      const isWorkspaceActive = await WorkspacesRepository.validateWorkspaceActive(workspaceId);
      if (!isWorkspaceActive) {
        logger.warn('Agent execution blocked: workspace not active', { tenantId, workspaceId });
        return false;
      }

      // 4. Validate workspace ownership (CRITICAL: prevents cross-tenant data leaks)
      const ownsWorkspace = await WorkspacesRepository.validateWorkspaceOwnership(workspaceId, tenantId);
      if (!ownsWorkspace) {
        logger.error('Agent execution blocked: workspace ownership mismatch', { tenantId, workspaceId });
        return false;
      }

      // 5. Check plan limits (when usage tracking is implemented)
      //  const limitsOk = await this.checkPlanLimits(tenantId, 'job');
      // if (!limitsOk) {
      //   logger.warn('Agent execution blocked: plan limits exceeded', { tenantId });
      //   return false;
      // }

      logger.info('Agent execution validated successfully', { tenantId, workspaceId });
      return true;
    } catch (error) {
      logger.error('Error validating agent execution', { error, tenantId, workspaceId });
      return false; // Fail closed on errors
    }
  }

  /**
   * SECURITY FIX #5: Check if tenant has exceeded plan limits
   * 
   * STUB IMPLEMENTATION: This will always return false (limits not enforced) until
   * usage tracking backend is implemented.
   * 
   * TODO: Implement real usage comparison once tenant_usage table exists
   * 
   * @param tenantId - The tenant ID to check
   * @param resource - The resource type to check (e.g., 'agents', 'jobs', 'widgets')
   * @returns true if limit is exceeded, false if within limits or stub
   */
  async checkPlanLimits(tenantId: string, resource: string): Promise<boolean> {
    try {
      // Get tenant limits
      const limits = await this.tenantsRepository.getTenantLimits(tenantId);
      if (!limits) {
        logger.warn('No limits found for tenant, allowing operation', { tenantId, resource });
        return false; // No limits = no restriction
      }

      // TODO: Implement real usage tracking
      // For now, always return false (limits not enforced)
      // 
      // Future implementation should:
      // 1. Query tenant_usage table for current usage
      // 2. Compare against limits[resource]
      // 3. Return true if exceeded, false otherwise
      logger.info('Plan limits check (STUB): allowing operation', { tenantId, resource });
      // SECURITY FIX #6: Explicit fail-open with warning for MVP mode
      logger.warn('Plan limits NOT enforced (MVP mode)', { tenantId, resource });
      return false; // Explicit allow for MVP
    } catch (error) {
      logger.error('Error checking plan limits', { error, tenantId, resource });
      logger.warn('Plan limits check failed, allowing operation (MVP mode)', { tenantId, resource });
      return false; // Explicit allow for MVP - prevents blocking on errors
    }
  }
}

export default AuthService;
