import RedisService from '../auth/services/RedisService';

// Unified Redis client for all services
export const redisClient = RedisService.getInstance();

export default redisClient;


