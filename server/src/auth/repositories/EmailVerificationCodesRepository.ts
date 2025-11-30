// auth/repositories/EmailVerificationCodesRepository.ts
import { BaseRepository } from '../../database/repositories/BaseRepository';
import { Database } from '../../database/config/supabase';
import logger from '../../utils/logger';

type EmailVerificationCode = Database['public']['Tables']['email_verification_codes']['Row'];
type EmailVerificationCodeInsert = Database['public']['Tables']['email_verification_codes']['Insert'];
type EmailVerificationCodeUpdate = Database['public']['Tables']['email_verification_codes']['Update'];

export class EmailVerificationCodesRepository extends BaseRepository<EmailVerificationCode, EmailVerificationCodeInsert, EmailVerificationCodeUpdate> {
  constructor() {
    super('email_verification_codes');
  }

  /**
   * Create a new verification code
   */
  async createVerificationCode(data: {
    email: string;
    code: string;
    type: 'signup' | 'password_reset';
    expiresAt: Date;
  }): Promise<EmailVerificationCode> {
    try {
      // First, invalidate any existing codes for this email and type
      await this.invalidateExistingCodes(data.email, data.type);

      const insertData: EmailVerificationCodeInsert = {
        email: data.email,
        code: data.code,
        type: data.type,
        expires_at: data.expiresAt.toISOString(),
        attempts: 0,
        verified: false
      };

      const result = await this.create(insertData);
      logger.info('Verification code created', { 
        email: data.email, 
        type: data.type,
        expiresAt: data.expiresAt.toISOString()
      });

      return result;
    } catch (error) {
      logger.error('Failed to create verification code', { error, email: data.email });
      throw error;
    }
  }

  /**
   * Find a valid verification code
   */
  async findValidCode(email: string, code: string, type: 'signup' | 'password_reset'): Promise<EmailVerificationCode | null> {
    try {
      const { data, error } = await this.client
        .from('email_verification_codes')
        .select('*')
        .eq('email', email)
        .eq('code', code)
        .eq('type', type)
        .eq('verified', false)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        logger.error('Failed to find valid verification code', { error, email, type });
        throw new Error(`Failed to find verification code: ${error.message}`);
      }

      return data;
    } catch (error) {
      logger.error('Error finding valid verification code', { error, email, type });
      throw error;
    }
  }

  /**
   * Mark a verification code as verified
   */
  async markAsVerified(id: string): Promise<boolean> {
    try {
      const result = await this.update(id, { verified: true });
      logger.info('Verification code marked as verified', { id });
      return !!result;
    } catch (error) {
      logger.error('Failed to mark verification code as verified', { error, id });
      throw error;
    }
  }

  /**
   * Increment attempt count for a verification code
   */
  async incrementAttempts(id: string): Promise<number> {
    try {
      const { data, error } = await this.client
        .from('email_verification_codes')
        .select('attempts')
        .eq('id', id)
        .single();

      if (error) {
        logger.error('Failed to get current attempt count', { error, id });
        throw new Error(`Failed to get attempt count: ${error.message}`);
      }

      const newAttempts = (data.attempts || 0) + 1;
      
      await this.update(id, { attempts: newAttempts });
      
      logger.info('Verification code attempts incremented', { id, attempts: newAttempts });
      return newAttempts;
    } catch (error) {
      logger.error('Failed to increment verification code attempts', { error, id });
      throw error;
    }
  }

  /**
   * Invalidate existing codes for an email and type
   */
  async invalidateExistingCodes(email: string, type: 'signup' | 'password_reset'): Promise<void> {
    try {
      const { error } = await this.client
        .from('email_verification_codes')
        .update({ verified: true }) // Mark as verified to invalidate
        .eq('email', email)
        .eq('type', type)
        .eq('verified', false);

      if (error) {
        logger.error('Failed to invalidate existing codes', { error, email, type });
        throw new Error(`Failed to invalidate existing codes: ${error.message}`);
      }

      logger.info('Existing verification codes invalidated', { email, type });
    } catch (error) {
      logger.error('Error invalidating existing codes', { error, email, type });
      throw error;
    }
  }

  /**
   * Clean up expired verification codes
   */
  async cleanupExpiredCodes(): Promise<number> {
    try {
      const { data, error } = await this.client
        .from('email_verification_codes')
        .delete()
        .lt('expires_at', new Date().toISOString())
        .select('id');

      if (error) {
        logger.error('Failed to cleanup expired codes', { error });
        throw new Error(`Failed to cleanup expired codes: ${error.message}`);
      }

      const deletedCount = data?.length || 0;
      logger.info('Expired verification codes cleaned up', { count: deletedCount });
      return deletedCount;
    } catch (error) {
      logger.error('Error cleaning up expired codes', { error });
      throw error;
    }
  }

  /**
   * Get verification code statistics
   */
  async getCodeStats(email: string, type: 'signup' | 'password_reset'): Promise<{
    totalCodes: number;
    verifiedCodes: number;
    expiredCodes: number;
    activeCodes: number;
    lastCodeSent: Date | null;
  }> {
    try {
      const { data, error } = await this.client
        .from('email_verification_codes')
        .select('*')
        .eq('email', email)
        .eq('type', type)
        .order('created_at', { ascending: false });

      if (error) {
        logger.error('Failed to get code stats', { error, email, type });
        throw new Error(`Failed to get code stats: ${error.message}`);
      }

      const codes = data || [];
      const now = new Date();

      const stats = {
        totalCodes: codes.length,
        verifiedCodes: codes.filter(code => code.verified).length,
        expiredCodes: codes.filter(code => new Date(code.expires_at) < now).length,
        activeCodes: codes.filter(code => !code.verified && new Date(code.expires_at) > now).length,
        lastCodeSent: codes.length > 0 ? new Date(codes[0].created_at) : null
      };

      return stats;
    } catch (error) {
      logger.error('Error getting code stats', { error, email, type });
      throw error;
    }
  }

  /**
   * Check if email has too many recent verification attempts
   */
  async hasTooManyRecentAttempts(email: string, type: 'signup' | 'password_reset', maxAttempts: number = 5, timeWindowMinutes: number = 15): Promise<boolean> {
    try {
      const cutoffTime = new Date(Date.now() - timeWindowMinutes * 60 * 1000);

      const { data, error } = await this.client
        .from('email_verification_codes')
        .select('id')
        .eq('email', email)
        .eq('type', type)
        .gte('created_at', cutoffTime.toISOString());

      if (error) {
        logger.error('Failed to check recent attempts', { error, email, type });
        throw new Error(`Failed to check recent attempts: ${error.message}`);
      }

      const recentAttempts = data?.length || 0;
      const hasTooMany = recentAttempts >= maxAttempts;

      if (hasTooMany) {
        logger.warn('Too many recent verification attempts', { 
          email, 
          type, 
          attempts: recentAttempts, 
          maxAttempts,
          timeWindowMinutes 
        });
      }

      return hasTooMany;
    } catch (error) {
      logger.error('Error checking recent attempts', { error, email, type });
      throw error;
    }
  }
}

export default new EmailVerificationCodesRepository();
