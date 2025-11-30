// path: src/utils/logger.ts
import winston from 'winston';
import path from 'path';
import fs from 'fs';

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Utility function to escape values for normalized format
const escapeValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return 'null';
  }
  
  const str = String(value);
  
  // If value contains spaces, pipes, or equals, URL encode it
  if (/[\s|=]/.test(str)) {
    return encodeURIComponent(str);
  }
  
  return str;
};

// Flatten nested objects into dot notation
const flattenObject = (obj: Record<string, unknown>, prefix = ''): Record<string, unknown> => {
  const flattened: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof Error)) {
      Object.assign(flattened, flattenObject(value as Record<string, unknown>, newKey));
    } else {
      flattened[newKey] = value;
    }
  }
  
  return flattened;
};

// Normalized format function
const createNormalizedFormat = () => {
  return winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    winston.format.printf((info) => {
      const { timestamp, level, message, service, environment, pid, stack, ...meta } = info;
      
      // Start with core fields
      const parts = [
        `timestamp=${timestamp}`,
        `level=${level.toUpperCase()}`,
        `service=${escapeValue(service)}`,
        `env=${escapeValue(environment)}`,
        `pid=${pid}`
      ];
      
      // Flatten and sort metadata
      const flatMeta = flattenObject(meta);
      const sortedKeys = Object.keys(flatMeta).sort();
      
      for (const key of sortedKeys) {
        const value = flatMeta[key];
        if (value !== undefined) {
          // Handle special formatting for known fields
          if (key === 'duration' || key === 'durationMs') {
            parts.push(`${key}=${value}ms`);
          } else if (key === 'stack' && value) {
            // Stack traces get special treatment - keep them readable
            parts.push(`hasStack=true`);
          } else {
            parts.push(`${key}=${escapeValue(value)}`);
          }
        }
      }
      
      // Construct the log line
      let logLine = `[${parts.join(' ')}] | ${message}`;
      
      // Append stack trace on new lines if present
      if (stack) {
        logLine += `\n${stack}`;
      }
      
      return logLine;
    })
  );
};

// Base logger configuration
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: createNormalizedFormat(),
  defaultMeta: { 
    service: 'server',
    environment: process.env.NODE_ENV || 'development',
    pid: process.pid
  },
  transports: [
    // Error logs
    new winston.transports.File({ 
      filename: path.join(logsDir, 'error.log'), 
      level: 'error',
      maxsize: 50 * 1024 * 1024, // 50MB
      maxFiles: 5,
      tailable: true
    }),
    
    // Combined logs
    new winston.transports.File({ 
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 100 * 1024 * 1024, // 100MB
      maxFiles: 10,
      tailable: true
    }),
    
    // Console transport - same format everywhere
    new winston.transports.Console({
      level: process.env.NODE_ENV === 'production' ? 'info' : (process.env.LOG_LEVEL || 'debug')
    })
  ],
  
  // Handle uncaught exceptions and rejections
  exceptionHandlers: [
    new winston.transports.File({ 
      filename: path.join(logsDir, 'exceptions.log'),
      maxsize: 50 * 1024 * 1024,
      maxFiles: 3,
      format: createNormalizedFormat()
    })
  ],
  
  rejectionHandlers: [
    new winston.transports.File({ 
      filename: path.join(logsDir, 'rejections.log'),
      maxsize: 50 * 1024 * 1024,
      maxFiles: 3,
      format: createNormalizedFormat()
    })
  ]
});

// Enhanced logging methods with type safety
interface LogContext {
  [key: string]: unknown;
  correlationId?: string;
  userId?: string;
  requestId?: string;
  integration?: string;
  workflow?: string;
  function?: string;
  duration?: number;
  durationMs?: number;
}

interface EnhancedLogger extends winston.Logger {
  logWithContext: (level: string, message: string, context?: LogContext) => void;
  integration: (integration: string, message: string, context?: LogContext) => void;
  workflow: (workflow: string, message: string, context?: LogContext) => void;
  performance: (operation: string, duration: number, context?: LogContext) => void;
  security: (event: string, context?: LogContext) => void;
}

// Add enhanced methods
const enhancedLogger = logger as EnhancedLogger;

enhancedLogger.logWithContext = (level: string, message: string, context: LogContext = {}) => {
  logger.log(level, message, context);
};

enhancedLogger.integration = (integration: string, message: string, context: LogContext = {}) => {
  logger.info(message, { 
    ...context, 
    integration, 
    component: 'integration' 
  });
};

enhancedLogger.workflow = (workflow: string, message: string, context: LogContext = {}) => {
  logger.info(message, { 
    ...context, 
    workflow, 
    component: 'workflow' 
  });
};

enhancedLogger.performance = (operation: string, duration: number, context: LogContext = {}) => {
  logger.info(`Operation completed: ${operation}`, {
    ...context,
    component: 'performance',
    operation,
    duration,
    durationMs: duration,
    performance: true
  });
};

enhancedLogger.security = (event: string, context: LogContext = {}) => {
  logger.warn(`Security event: ${event}`, {
    ...context,
    component: 'security',
    securityEvent: event,
    security: true
  });
};

// Utility function to parse normalized log lines (for tooling/testing)
interface ParsedLogLine {
  timestamp: string;
  level: string;
  service: string;
  env: string;
  pid: number;
  message: string;
  context: Record<string, string>;
  stack?: string;
}

export const parseLogLine = (logLine: string): ParsedLogLine | null => {
  try {
    const parts = logLine.split(' | ');
    const headerPart = parts[0];
    
    if (!headerPart || !headerPart.startsWith('[') || !headerPart.endsWith(']')) {
      return null;
    }
    
    const kvPairs = headerPart.slice(1, -1).split(' ');
    const parsed: Record<string, string> = {};
    
    for (const pair of kvPairs) {
      const [key, ...valueParts] = pair.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=');
        parsed[key] = value.includes('%') ? decodeURIComponent(value) : value;
      }
    }
    
    const messageWithStack = parts.slice(1).join(' | ');
    const [message, ...stackParts] = messageWithStack.split('\n');
    
    const result: ParsedLogLine = {
      timestamp: parsed.timestamp || '',
      level: parsed.level || '',
      service: parsed.service || '',
      env: parsed.env || '',
      pid: parseInt(parsed.pid || '0', 10),
      message: message || '',
      context: Object.fromEntries(
        Object.entries(parsed).filter(([key]) => 
          !['timestamp', 'level', 'service', 'env', 'pid'].includes(key)
        )
      )
    };
    
    if (stackParts.length > 0) {
      result.stack = stackParts.join('\n');
    }
    
    return result;
  } catch (error) {
    return null;
  }
};

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down logger...');
  logger.end();
});

process.on('SIGTERM', () => {
  logger.info('Shutting down logger...');
  logger.end();
});

export default enhancedLogger;
export type { LogContext, EnhancedLogger, ParsedLogLine };