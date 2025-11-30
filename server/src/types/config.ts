// types/config.ts
export interface ServerConfig {
    port: number;
    webhookPath?: string;
    host?: string;
    bodyLimit?: string;
    timeout?: number;
  }
  
  export interface RateLimitConfig {
    windowMs: number;
    max: number;
    message?: string;
    standardHeaders?: boolean;
    legacyHeaders?: boolean;
  }
  
  export interface DatabaseConfig {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
    ssl?: boolean;
    connectionTimeout?: number;
    maxConnections?: number;
  }
  
  export interface LoggingConfig {
    level: 'error' | 'warn' | 'info' | 'debug';
    format: string;
    directory?: string;
    maxFileSize?: string;
    maxFiles?: number;
  }
  
  export interface WhatsAppConfig {
    apiUrl: string;
    version: string;
    timeout?: number;
    retries?: number;
  }
  
  export interface OpenAIConfig {
    apiUrl: string;
    model: string;
    maxTokens?: number;
    temperature?: number;
    timeout?: number;
  }
  
  export interface AppConfig {
    server: ServerConfig;
    rateLimit: RateLimitConfig;
    database?: DatabaseConfig;
    logging?: LoggingConfig; // Make optional
    whatsapp?: WhatsAppConfig;
    openai?: OpenAIConfig;
    cache?: {
      ttl: number;
      checkPeriod: number;
    };
    security?: {
      helmet?: Record<string, any>;
      cors?: {
        origin: string[];
        credentials: boolean;
      };
    };
  }