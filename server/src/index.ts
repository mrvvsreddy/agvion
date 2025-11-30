// path: server.ts - Clean server with WhatsApp webhook integration
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import 'dotenv/config';
// Import database service and related types
import DatabaseService, { DatabaseStats } from './database/DatabaseService';
import logger from './utils/logger';




// Import authentication system
import { authRoutes, initializeAuthServices, cleanupAuthServices } from './auth';

// Import workspace system
import { workspaceRoutes } from './workspace';

// Import agent system
import { agentRoutes } from './agent';

// Import tables system
import tablesRoutes from './routes/tables';

// Import knowledge system
import { knowledgeRoutes } from './agent/services/knowledge';

// Import webchat system
import { webchatWebhookServer, webchatConnectRouter } from './integrations/webchat';

// Import workflow system
import workflowRoutes from './workflow/routes/workflowRoutes';

// Provide a typed import; if types are missing, a shim will be added
import cookieParser from 'cookie-parser';


const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

// Database service instance
let databaseService: DatabaseService;

// Middleware
app.set('trust proxy', 1);
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: (origin, callback) => {
    const allowedFromEnv = (process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map(o => o.trim())
      .filter(Boolean);
    const allowList = allowedFromEnv.length > 0 ? allowedFromEnv : ['http://localhost:8080'];
    if (!origin || allowList.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// Cookie parsing (for __Host-session tokens)
app.use(cookieParser());

// Rate limiting - but exclude webhook endpoint from general rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});


// Apply rate limiting
app.use('/api/', generalLimiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Explicit security headers (in addition to Helmet defaults)
app.use((req: Request, res: Response, next: NextFunction) => {
  if (!res.get('X-Content-Type-Options')) {
    res.set('X-Content-Type-Options', 'nosniff');
  }
  next();
});

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  logger.info('HTTP Request', {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    service: 'server',
    timestamp: new Date().toISOString()
  });
  next();
});



// Mount authentication routes
app.use('/api/auth', authRoutes);

// Mount workspace routes
app.use('/api/workspace', workspaceRoutes);

// Mount agent routes
app.use('/api/agents', agentRoutes);

// Mount workflow routes
app.use('/api/workflows', workflowRoutes);

// Mount tables routes
app.use('/api/tables', tablesRoutes);
app.use('/api/knowledge', knowledgeRoutes);

// Mount webchat routes (no rate limiting for webchat)
app.use('/webchat', webchatWebhookServer);
app.use('/webchat', webchatConnectRouter);

// Database connection middleware (only for /api routes)
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  if (!databaseService?.isReady) {
    return res.status(503).json({
      error: 'Database service not available',
      message: 'The database service is not initialized or not ready.',
    });
  }
  return next();
});

// Health check endpoint
app.get('/health', async (req: Request, res: Response) => {
  try {
    // Check if database service is available
    if (!databaseService) {
      return res.status(503).json({
        status: 'unhealthy',
        error: 'Database service not initialized',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      });
    }

    const healthCheck = await databaseService.getHealthCheck();

    const overallStatus = healthCheck.status === 'healthy' ? 'healthy' : 'unhealthy';

    return res.status(overallStatus === 'healthy' ? 200 : 503).json({
      status: overallStatus,
      timestamp: healthCheck.timestamp,
      database: healthCheck.database,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: {
        nodeEnv: process.env.NODE_ENV || 'development',
        port: PORT
      }
    });
  } catch (error) {
    logger.error('Health check failed', { error });
    return res.status(503).json({
      status: 'unhealthy',
      error: 'Health check failed',
      timestamp: new Date().toISOString(),
    });
  }
});

// Database stats endpoints
app.get('/api/stats/tenant/:agentId', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;

    if (!agentId || typeof agentId !== 'string') {
      return res.status(400).json({
        error: 'Invalid tenant ID',
        message: 'Tenant ID is required and must be a valid string.',
      });
    }

    const stats = await databaseService.getTenantStats(agentId);

    return res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to get tenant stats', { error, agentId: req.params.agentId });
    return res.status(500).json({
      error: 'Failed to retrieve tenant statistics',
      message: error instanceof Error ? error.message : 'Unknown error occurred',
    });
  }
});

app.get('/api/stats/global', async (req: Request, res: Response) => {
  try {
    const stats = await databaseService.getGlobalStats();

    return res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to get global stats', { error });
    return res.status(500).json({
      error: 'Failed to retrieve global statistics',
      message: error instanceof Error ? error.message : 'Unknown error occurred',
    });
  }
});

// Repository access endpoints
app.get('/api/tenants', async (req: Request, res: Response) => {
  try {
    const { page = '1', limit = '10' } = req.query;

    // Validate pagination parameters
    const pageNum = Number(page);
    const limitNum = Number(limit);

    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({
        error: 'Invalid page parameter',
        message: 'Page must be a positive number.',
      });
    }

    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        error: 'Invalid limit parameter',
        message: 'Limit must be a number between 1 and 100.',
      });
    }

    // Using findAll method with pagination options
    const tenants = await databaseService.tenants.findAll({
      page: pageNum,
      limit: limitNum,
    });

    return res.json({
      success: true,
      data: tenants,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to get tenants', { error });
    return res.status(500).json({
      error: 'Failed to retrieve tenants',
      message: error instanceof Error ? error.message : 'Unknown error occurred',
    });
  }
});

app.get('/api/tenants/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({
        error: 'Invalid tenant ID',
        message: 'Tenant ID is required and must be a valid string.',
      });
    }

    const tenant = await databaseService.tenants.findById(id);

    if (!tenant) {
      return res.status(404).json({
        error: 'Tenant not found',
        message: `Tenant with ID ${id} does not exist.`,
      });
    }

    return res.json({
      success: true,
      data: tenant,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to get tenant', { error, agentId: req.params.id });
    return res.status(500).json({
      error: 'Failed to retrieve tenant',
      message: error instanceof Error ? error.message : 'Unknown error occurred',
    });
  }
});

app.get('/api/tenants/:agentId/users', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { page = '1', limit = '10' } = req.query;

    if (!agentId || typeof agentId !== 'string') {
      return res.status(400).json({
        error: 'Invalid tenant ID',
        message: 'Tenant ID is required and must be a valid string.',
      });
    }

    // Validate pagination parameters
    const pageNum = Number(page);
    const limitNum = Number(limit);

    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({
        error: 'Invalid page parameter',
        message: 'Page must be a positive number.',
      });
    }

    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        error: 'Invalid limit parameter',
        message: 'Limit must be a number between 1 and 100.',
      });
    }

    // Using findByTenant method from BaseRepository
    const users = await databaseService.users.findByTenant(agentId, {
      page: pageNum,
      limit: limitNum,
    });

    return res.json({
      success: true,
      data: users,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to get users', { error, agentId: req.params.agentId });
    return res.status(500).json({
      error: 'Failed to retrieve users',
      message: error instanceof Error ? error.message : 'Unknown error occurred',
    });
  }
});

app.get('/api/tenants/:agentId/workflows', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { page = '1', limit = '10' } = req.query;

    if (!agentId || typeof agentId !== 'string') {
      return res.status(400).json({
        error: 'Invalid tenant ID',
        message: 'Tenant ID is required and must be a valid string.',
      });
    }

    // Validate pagination parameters
    const pageNum = Number(page);
    const limitNum = Number(limit);

    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({
        error: 'Invalid page parameter',
        message: 'Page must be a positive number.',
      });
    }

    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        error: 'Invalid limit parameter',
        message: 'Limit must be a number between 1 and 100.',
      });
    }

    // Workflows functionality removed - placeholder response
    const workflows = {
      data: [],
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: 0,
        totalPages: 0
      }
    };

    return res.json({
      success: true,
      data: workflows,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to get workflows', { error, agentId: req.params.agentId });
    return res.status(500).json({
      error: 'Failed to retrieve workflows',
      message: error instanceof Error ? error.message : 'Unknown error occurred',
    });
  }
});

// Maintenance endpoint (protected - you might want to add authentication)
app.post('/api/maintenance', async (req: Request, res: Response) => {
  try {
    // Add authentication check here
    const maintenanceKey = req.headers['x-maintenance-key'];
    if (maintenanceKey !== process.env.MAINTENANCE_KEY) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Valid maintenance key required.',
      });
    }

    const result = await databaseService.performMaintenance();

    return res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Maintenance failed', { error });
    return res.status(500).json({
      error: 'Maintenance operation failed',
      message: error instanceof Error ? error.message : 'Unknown error occurred',
    });
  }
});

// Error handling middleware
app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method
  });

  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not found',
    message: `Route ${req.method} ${req.url} not found`,
  });
});

// Graceful shutdown handler
const gracefulShutdown = async (signal: string): Promise<void> => {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  server.close(async () => {
    logger.info('HTTP server closed');

    try {
      await cleanupAuthServices();
      logger.info('Authentication services cleaned up');
    } catch (error) {
      logger.error('Error during auth cleanup', { error });
    }

    try {
      await databaseService?.closeConnection();
      logger.info('Database connections closed');
    } catch (error) {
      logger.error('Error during database cleanup', { error });
    }

    process.exit(0);
  });

  // Force close after 30 seconds
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 30000);
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
async function startServer(): Promise<void> {
  try {
    // Initialize authentication services first
    await initializeAuthServices();
    logger.info('Authentication services initialized successfully');

    // Initialize database service
    databaseService = DatabaseService.getInstance();
    await databaseService.initialize();

    server.listen(PORT, () => {
      logger.info(`Server started on port ${PORT}`, {
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
      });

      logger.info('Available endpoints:', {
        auth: {
          signup: `POST /api/auth/signup`,
          login: `POST /api/auth/login`,
          workflows: `GET /api/tenants/:agentId/workflows`,
          stats: `GET /api/stats/global`,
          tenantStats: `GET /api/stats/tenant/:agentId`
        }
      });
    });
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception', { error });
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  logger.error('Unhandled Rejection', { reason, promise });
  process.exit(1);
});

// Start the server
startServer();

export default app;