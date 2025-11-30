// auth/config/sessionConfig.ts
import RedisService from '../services/RedisService';
import logger from '../../utils/logger';

export const createSessionConfig = () => {
  // Deprecated: express-session removed. Keep function to avoid import breakages.
  logger.warn('createSessionConfig is deprecated and no longer used.');
  return (req: any, res: any, next: any) => next();
};

export const initializeAuthServices = async (): Promise<void> => {
  try {
    // Initialize Redis connection
    const redisService = RedisService.getInstance();
    await redisService.connect();
    
    // Test Redis connection
    const isRedisConnected = await redisService.ping();
    if (!isRedisConnected) {
      throw new Error('Redis connection failed');
    }
    
    logger.info('Redis service initialized successfully');

    // Test email service connection
    const emailService = require('../services/EmailService').default.getInstance();
    const isEmailServiceReady = await emailService.testConnection();
    if (!isEmailServiceReady) {
      logger.warn('Email service connection test failed - emails may not work');
    } else {
      logger.info('Email service initialized successfully');
    }

    // Initialize other services
    const authService = require('../services/AuthService').default.getInstance();
    const passwordService = require('../services/PasswordService').default.getInstance();

    logger.info('All authentication services initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize authentication services', { error });
    throw error;
  }
};

export const cleanupAuthServices = async (): Promise<void> => {
  try {
    const redisService = RedisService.getInstance();
    await redisService.disconnect();
    logger.info('Authentication services cleaned up successfully');
  } catch (error) {
    logger.error('Failed to cleanup authentication services', { error });
    throw error;
  }
};
