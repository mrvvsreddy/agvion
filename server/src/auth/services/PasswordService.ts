// auth/services/PasswordService.ts
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import logger from '../../utils/logger';

export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
  strength: 'weak' | 'medium' | 'strong';
}

export class PasswordService {
  private static instance: PasswordService;
  private readonly saltRounds: number = 12;

  private constructor() {
    logger.info('Password Service initialized');
  }

  public static getInstance(): PasswordService {
    if (!PasswordService.instance) {
      PasswordService.instance = new PasswordService();
    }
    return PasswordService.instance;
  }

  /**
   * Hash a password using bcrypt
   */
  public async hashPassword(password: string): Promise<string> {
    try {
      const salt = await bcrypt.genSalt(this.saltRounds);
      const hash = await bcrypt.hash(password, salt);
      return hash;
    } catch (error) {
      logger.error('Failed to hash password', { error });
      throw new Error('Password hashing failed');
    }
  }

  /**
   * Compare a password with its hash
   */
  public async comparePassword(password: string, hash: string): Promise<boolean> {
    try {
      return await bcrypt.compare(password, hash);
    } catch (error) {
      logger.error('Failed to compare password', { error });
      throw new Error('Password comparison failed');
    }
  }

  /**
   * Validate password strength and requirements
   */
  public validatePassword(password: string): PasswordValidationResult {
    const errors: string[] = [];
    let strength: 'weak' | 'medium' | 'strong' = 'weak';

    // Check minimum length
    if (password.length < 8) {
      errors.push('Password must be at least 8 characters long');
    }

    // Check for uppercase letter
    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    // Check for lowercase letter
    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    // Check for number
    if (!/[0-9]/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    // Check for special character
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

    // Check for common passwords
    const commonPasswords = [
      'password', '123456', '123456789', 'qwerty', 'abc123', 'password123',
      'admin', 'letmein', 'welcome', 'monkey', '1234567890', 'password1'
    ];
    
    if (commonPasswords.includes(password.toLowerCase())) {
      errors.push('Password is too common, please choose a more unique password');
    }

    // Check for repeated characters
    if (/(.)\1{2,}/.test(password)) {
      errors.push('Password cannot contain more than 2 consecutive identical characters');
    }

    // Calculate strength
    let score = 0;
    
    if (password.length >= 8) score += 1;
    if (password.length >= 12) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/[a-z]/.test(password)) score += 1;
    if (/[0-9]/.test(password)) score += 1;
    if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) score += 1;
    if (password.length >= 16) score += 1;
    if (!commonPasswords.includes(password.toLowerCase())) score += 1;

    if (score >= 6) {
      strength = 'strong';
    } else if (score >= 4) {
      strength = 'medium';
    }

    return {
      isValid: errors.length === 0,
      errors,
      strength
    };
  }

  /**
   * Generate a secure random password
   */
  public generateSecurePassword(length: number = 16): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()';
    let password = '';
    
    // Ensure at least one character from each required category
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const special = '!@#$%^&*()';
    
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += special[Math.floor(Math.random() * special.length)];
    
    // Fill the rest with random characters
    for (let i = 4; i < length; i++) {
      password += charset[Math.floor(Math.random() * charset.length)];
    }
    
    // Shuffle the password
    return password.split('').sort(() => Math.random() - 0.5).join('');
  }

  /**
   * Generate a secure random token
   */
  public generateSecureToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Generate a verification code (6 digits)
   */
  public generateVerificationCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Generate a password reset token
   */
  public generatePasswordResetToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Check if password has been compromised (basic check)
   */
  public async isPasswordCompromised(password: string): Promise<boolean> {
    // This is a basic implementation. In production, you might want to use
    // services like HaveIBeenPwned API for more comprehensive checking
    
    const commonPasswords = [
      'password', '123456', '123456789', 'qwerty', 'abc123', 'password123',
      'admin', 'letmein', 'welcome', 'monkey', '1234567890', 'password1',
      'iloveyou', 'welcome123', 'monkey123', 'dragon', 'master', 'hello',
      'freedom', 'whatever', 'qazwsx', 'trustno1', '654321', 'jordan23',
      'harley', 'password1', 'jordan', 'jennifer', 'zxcvbnm', 'asdfgh',
      'hunter', 'buster', 'soccer', 'hockey', 'killer', 'george', 'sexy',
      'andrew', 'charlie', 'superman', 'asshole', 'fuckyou', 'dallas',
      'jessica', 'panties', 'pepper', '1234', '696969', 'killer', 'trustno1'
    ];

    return commonPasswords.includes(password.toLowerCase());
  }

  /**
   * Get password strength requirements
   */
  public getPasswordRequirements(): string[] {
    return [
      'At least 8 characters long',
      'Contains at least one uppercase letter (A-Z)',
      'Contains at least one lowercase letter (a-z)',
      'Contains at least one number (0-9)',
      'Contains at least one special character (!@#$%^&*(),.?":{}|<>)',
      'Not a common password',
      'No more than 2 consecutive identical characters'
    ];
  }
}

export default PasswordService;
