// auth/index.ts
export { default as AuthService } from './services/AuthService';
export { default as PasswordService } from './services/PasswordService';
export { default as EmailService } from './services/EmailService';
export { default as RedisService } from './services/RedisService';

export { default as EmailVerificationCodesRepository } from './repositories/EmailVerificationCodesRepository';

export { 
  authenticateToken,
  requireTenant,
  requireEmailVerification,
  optionalAuth,
  refreshSession,
  logAuthEvents,
  rateLimitAuth,
  validateTenantAccess,
  type AuthenticatedRequest
} from './middleware/authMiddleware';

export { default as authRoutes } from './routes/authRoutes';

// Re-export types
export type { LoginResult, SignupResult, VerificationResult, PasswordResetResult } from './services/AuthService';
export type { PasswordValidationResult } from './services/PasswordService';
export type { EmailTemplate } from './services/EmailService';

// Re-export session and lifecycle helpers
export { createSessionConfig, initializeAuthServices, cleanupAuthServices } from './config/sessionConfig';
