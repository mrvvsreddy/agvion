import { Router, Request, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../auth/middleware/authMiddleware';
import TableService, { AgentTableInsert, AgentTableUpdate, AgentTableRowInsert, AgentTableRowUpdate } from '../database/services/TableService';
import AgentService from '../agent/services/AgentService';
import { redisClient } from '../redis';
import logger from '../utils/logger';

const router = Router();

// Input validation helpers
const validateCreateTableRequest = (body: unknown): body is { agent_id: string; table_name: string; description?: string | null; columns: any; initialRows?: any[] } => {
  return (
    typeof body === 'object' &&
    body !== null &&
    'agent_id' in body &&
    'table_name' in body &&
    'columns' in body &&
    typeof (body as any).agent_id === 'string' &&
    typeof (body as any).table_name === 'string' &&
    Array.isArray((body as any).columns)
  );
};

const validateColumnRequest = (body: unknown): body is { name: string; type: string; required?: boolean; primary_key?: boolean; default?: any } => {
  return (
    typeof body === 'object' &&
    body !== null &&
    'name' in body &&
    'type' in body &&
    typeof (body as any).name === 'string' &&
    typeof (body as any).type === 'string'
  );
};

const validateUpdateColumnsRequest = (body: unknown): body is { columns: any[] } => {
  return (
    typeof body === 'object' &&
    body !== null &&
    'columns' in body &&
    Array.isArray((body as any).columns)
  );
};

// List agent tables with tenant validation and Redis caching
router.get('/:agentId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    
    if (!agentId) return res.status(400).json({ success: false, message: 'agentId is required' });
    
    // Validate agent belongs to user's tenant using session data
    const userTenantId = req.user?.tenantId;
    if (!userTenantId) {
      return res.status(400).json({ success: false, message: 'User tenant information is missing' });
    }

    const agentValidation = await AgentService.getAgentById(userTenantId, agentId);
    
    if (!agentValidation.success || !agentValidation.agent) {
      logger.warn('GET /api/tables: agent validation failed', { 
        agentId: agentId.substring(0, 8) + '...',
        hasTenantId: !!userTenantId
      });
      return res.status(403).json({ success: false, message: 'Agent not found or access denied' });
    }

    // Try to get from Redis cache first
    const cacheKey = `tables:${agentId}:list`;
    try {
      const cachedData = typeof (redisClient as any).get === 'function' ? await (redisClient as any).get(cacheKey) : null;
      if (cachedData) {
        const tables = JSON.parse(cachedData);
        logger.info('GET /api/tables: served from Redis cache', { agentId, tableCount: tables.length });
        
        // Remove table_id from client response for security
        const clientTables = tables.map((table: any) => ({
          agent_id: table.agent_id,
          table_name: table.table_name,
          description: table.description,
          columns: table.columns,
          created_at: table.created_at,
          updated_at: table.updated_at,
          rowCount: table.rowCount
        }));
        
        return res.json({ success: true, data: clientTables });
      }
    } catch (cacheError) {
      logger.warn('GET /api/tables: failed to read from cache', { 
        agentId, 
        error: cacheError instanceof Error ? cacheError.message : String(cacheError) 
      });
    }

    // If not in cache, get from database
    const includeCounts = String(req.query.includeCounts || 'false') === 'true';
    const tables = await TableService.getAgentTables(agentId, includeCounts);
    
    // Cache the result for 30 minutes
    try {
      if (typeof (redisClient as any).setex === 'function') {
        await (redisClient as any).setex(cacheKey, 1800, JSON.stringify(tables));
      }
      logger.info('GET /api/tables: cached table list in Redis', { agentId, tableCount: tables.length });
    } catch (cacheError) {
      logger.warn('GET /api/tables: failed to cache table list', { 
        agentId, 
        error: cacheError instanceof Error ? cacheError.message : String(cacheError) 
      });
    }
    
    // Remove table_id from client response for security
    const clientTables = tables.map((table: any) => ({
      agent_id: table.agent_id,
      table_name: table.table_name,
      description: table.description,
      columns: table.columns,
      created_at: table.created_at,
      updated_at: table.updated_at,
      rowCount: table.rowCount
    }));
    
    return res.json({ success: true, data: clientTables });
  } catch (error) {
    logger.error('GET /api/tables/:agentId failed', { error });
    return res.status(500).json({ success: false, message: 'Failed to fetch tables' });
  }
});

// Create a new table with tenant validation and background processing
router.post('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    logger.info('POST /api/tables: received request', { 
      hasBody: !!req.body,
      userId: req.user?.id ? req.user.id.substring(0, 8) + '...' : 'missing'
    });

    const body = req.body as { agent_id: string; table_name: string; description?: string | null; columns: any; initialRows?: AgentTableRowInsert[] };

    if (!validateCreateTableRequest(req.body)) {
      logger.warn('POST /api/tables: invalid request body structure', { body: req.body });
      return res.status(400).json({ success: false, message: 'Invalid request body structure' });
    }

    // Get tenant and workspace info from user session (stored in Redis)
    const userTenantId = req.user?.tenantId;
    if (!userTenantId) {
      logger.warn('POST /api/tables: missing tenantId in user context', { userId: req.user?.id });
      return res.status(400).json({ success: false, message: 'User tenant information is missing' });
    }

    // Get agent info to extract workspace_id
    const agentValidation = await AgentService.getAgentById(userTenantId, body.agent_id);
    
    if (!agentValidation.success || !agentValidation.agent) {
      logger.warn('POST /api/tables: agent validation failed', { 
        agentId: body.agent_id.substring(0, 8) + '...',
        hasTenantId: !!userTenantId
      });
      return res.status(403).json({ success: false, message: 'Agent not found or access denied' });
    }

    const workspaceId = agentValidation.agent.workspace_id;
    if (!workspaceId) {
      logger.warn('POST /api/tables: agent has no workspace_id', { 
        agentId: body.agent_id.substring(0, 8) + '...'
      });
      return res.status(400).json({ success: false, message: 'Agent workspace information is missing' });
    }

    // Create table with tenant_id (database requires it)
    const request = {
      tableData: {
        agent_id: body.agent_id,
        tenant_id: userTenantId, // Database requires this field
        table_name: body.table_name,
        description: body.description ?? null,
        columns: body.columns,
      } as AgentTableInsert,
      initialRows: (body.initialRows || []) as readonly AgentTableRowInsert[],
    };

    logger.info('POST /api/tables: calling TableService.createTableWithRows with tenant validation', { 
      request: {
        ...request,
        tableData: {
          ...request.tableData,
          columns: request.tableData.columns // Log the actual columns for debugging
        }
      }
    });
    
    const result = await TableService.createTableWithRows(request);
    
    // Cache table data in Redis for faster access
    try {
      const cacheKey = `table:${result.table.id}:data`;
      const tableData = {
        id: result.table.id,
        agent_id: result.table.agent_id,
        tenant_id: result.table.tenant_id,
        table_name: result.table.table_name,
        description: result.table.description,
        columns: result.table.columns,
        created_at: result.table.created_at,
        updated_at: result.table.updated_at
      };
      
      if (typeof (redisClient as any).setex === 'function') {
        await (redisClient as any).setex(cacheKey, 3600, JSON.stringify(tableData)); // Cache for 1 hour
      }
      logger.info('POST /api/tables: table data cached in Redis', { tableId: result.table.id });
    } catch (cacheError) {
      logger.warn('POST /api/tables: failed to cache table data', { 
        tableId: result.table.id, 
        error: cacheError instanceof Error ? cacheError.message : String(cacheError) 
      });
      // Don't fail the request if caching fails
    }
    
    logger.info('POST /api/tables: table created successfully', { 
      tableId: result.table.id,
      tableName: result.table.table_name,
      agentId: result.table.agent_id,
      tenantId: result.table.tenant_id
    });
    
    // Return result without table_id for client security
    const clientResult = {
      agent_id: result.table.agent_id,
      table_name: result.table.table_name,
      description: result.table.description,
      columns: result.table.columns,
      created_at: result.table.created_at,
      updated_at: result.table.updated_at
    };
    
    return res.status(201).json({ success: true, data: clientResult });
  } catch (error) {
    logger.error('POST /api/tables failed', { 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      body: req.body 
    });
    
    let errorMessage = 'Failed to create table';
    if (error instanceof Error) {
      if (error.message.includes('table name can only contain')) {
        errorMessage = 'Table name can only contain letters, numbers, underscores, and hyphens. Spaces and special characters are not allowed.';
      } else if (error.message.includes('agent_id')) {
        errorMessage = 'Invalid agent ID provided.';
      } else if (error.message.includes('columns')) {
        errorMessage = 'Invalid column configuration provided.';
      } else if (error.message.includes('tenant_id') || error.message.includes('tenantId')) {
        errorMessage = 'Tenant validation failed.';
      } else {
        errorMessage = error.message;
      }
    }
    
    return res.status(500).json({ success: false, message: errorMessage });
  }
});

// Update columns by agentId + tableName
router.patch('/:agentId/:tableName/columns', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId, tableName } = req.params;
    
    if (!agentId || !tableName) {
      return res.status(400).json({ success: false, message: 'agentId and tableName are required' });
    }

    const { columns } = req.body as { columns: any[] };

    if (!validateUpdateColumnsRequest(req.body)) {
      return res.status(400).json({ success: false, message: 'Invalid request body - columns array is required' });
    }

    const userTenantId = req.user?.tenantId;
    if (!userTenantId) {
      return res.status(400).json({ success: false, message: 'User tenant information is missing' });
    }

    const agentValidation = await AgentService.getAgentById(userTenantId, agentId);
    if (!agentValidation.success || !agentValidation.agent) {
      return res.status(403).json({ success: false, message: 'Agent not found or access denied' });
    }

    const table = await TableService.findByAgentAndName(agentId, tableName);
    if (!table) {
      return res.status(404).json({ success: false, message: 'Table not found' });
    }

    const updated = await TableService.update(table.id, { columns } as AgentTableUpdate);
    return res.json({ success: true, data: { table_name: updated.table_name, columns: updated.columns } });
  } catch (error) {
    logger.error('PATCH /api/tables/:agentId/:tableName/columns failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: 'Failed to update columns' });
  }
});

// Add a single column to a table
router.post('/:agentId/:tableName/columns', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId, tableName } = req.params;
    
    if (!agentId || !tableName) {
      return res.status(400).json({ success: false, message: 'agentId and tableName are required' });
    }

    const column = req.body as { name: string; type: string; required?: boolean; primary_key?: boolean; default?: any };

    if (!validateColumnRequest(req.body)) {
      return res.status(400).json({ success: false, message: 'Invalid request body - name and type are required' });
    }

    const userTenantId = req.user?.tenantId;
    if (!userTenantId) {
      return res.status(400).json({ success: false, message: 'User tenant information is missing' });
    }

    // Validate agent access
    const agentValidation = await AgentService.getAgentById(userTenantId, agentId);
    if (!agentValidation.success || !agentValidation.agent) {
      return res.status(403).json({ success: false, message: 'Agent not found or access denied' });
    }

    const table = await TableService.findByAgentAndName(agentId, tableName);
    if (!table) {
      return res.status(404).json({ success: false, message: 'Table not found' });
    }

    const existingCols = Array.isArray(table.columns) ? table.columns : [];
    if (existingCols.some((c: any) => c?.name === column.name)) {
      return res.status(409).json({ success: false, message: 'Column already exists' });
    }

    const nextCols = [...existingCols, column];
    const updated = await TableService.update(table.id, { columns: nextCols } as AgentTableUpdate);

    return res.status(201).json({ success: true, data: { table_name: updated.table_name, columns: updated.columns } });
  } catch (error) {
    logger.error('POST /api/tables/:agentId/:tableName/columns failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, message: 'Failed to add column' });
  }
});

// Update table meta (name/description/columns) with tenant validation
router.patch('/:tableId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { tableId } = req.params;
    if (!tableId) return res.status(400).json({ success: false, message: 'tableId is required' });
    
    const userTenantId = req.user?.tenantId;
    if (!userTenantId) {
      return res.status(400).json({ success: false, message: 'User tenant information is missing' });
    }

    // Verify table exists and belongs to tenant's agent
    const table = await TableService.findById(tableId);
    if (!table) {
      return res.status(404).json({ success: false, message: 'Table not found' });
    }

    // Verify agent belongs to tenant
    const agentValidation = await AgentService.getAgentById(userTenantId, table.agent_id);
    if (!agentValidation.success || !agentValidation.agent) {
      return res.status(403).json({ success: false, message: 'Access denied - table does not belong to your tenant' });
    }

    const update = req.body as Partial<AgentTableUpdate>;
    const updated = await TableService.update(tableId, update as AgentTableUpdate);
    return res.json({ success: true, data: updated });
  } catch (error) {
    logger.error('PATCH /api/tables/:tableId failed', { error });
    return res.status(500).json({ success: false, message: 'Failed to update table' });
  }
});

// Delete table with rows and tenant validation
router.delete('/:tableId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { tableId } = req.params;
    if (!tableId) return res.status(400).json({ success: false, message: 'tableId is required' });
    
    const userTenantId = req.user?.tenantId;
    if (!userTenantId) {
      return res.status(400).json({ success: false, message: 'User tenant information is missing' });
    }

    // Verify table exists and belongs to tenant's agent
    const table = await TableService.findById(tableId);
    if (!table) {
      return res.status(404).json({ success: false, message: 'Table not found' });
    }

    // Verify agent belongs to tenant
    const agentValidation = await AgentService.getAgentById(userTenantId, table.agent_id);
    if (!agentValidation.success || !agentValidation.agent) {
      return res.status(403).json({ success: false, message: 'Access denied - table does not belong to your tenant' });
    }

    await TableService.deleteTableWithRows(tableId);
    return res.json({ success: true });
  } catch (error) {
    logger.error('DELETE /api/tables/:tableId failed', { error });
    return res.status(500).json({ success: false, message: 'Failed to delete table' });
  }
});

// List rows by table with tenant validation
router.get('/:tableId/rows', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { tableId } = req.params;
    if (!tableId) return res.status(400).json({ success: false, message: 'tableId is required' });
    
    const userTenantId = req.user?.tenantId;
    if (!userTenantId) {
      return res.status(400).json({ success: false, message: 'User tenant information is missing' });
    }

    // Verify table exists and belongs to tenant's agent
    const table = await TableService.findById(tableId);
    if (!table) {
      return res.status(404).json({ success: false, message: 'Table not found' });
    }

    // Verify agent belongs to tenant
    const agentValidation = await AgentService.getAgentById(userTenantId, table.agent_id);
    if (!agentValidation.success || !agentValidation.agent) {
      return res.status(403).json({ success: false, message: 'Access denied - table does not belong to your tenant' });
    }

    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 50);
    const rows = await TableService.getTableRows(tableId, { page, limit });
    return res.json({ success: true, data: rows });
  } catch (error) {
    logger.error('GET /api/tables/:tableId/rows failed', { error });
    return res.status(500).json({ success: false, message: 'Failed to fetch rows' });
  }
});

// Insert a row by credentials (secure)
router.post('/:agentId/:tableName/rows', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId, tableName } = req.params;
    const { tenantId } = req.user || {};
    if (!agentId) return res.status(400).json({ success: false, message: 'agentId missing' });
    if (!tenantId) return res.status(400).json({ success: false, message: 'tenantId missing' });
    if (!tableName) return res.status(400).json({ success: false, message: 'tableName missing' });
    const row = req.body as AgentTableRowInsert;
    const inserted = await TableService.insertRowByCredentials({ agentId, tenantId }, tableName, row);
    return res.status(201).json({ success: true, data: inserted });
  } catch (error) {
    logger.error('POST /api/tables/:agentId/:tableName/rows failed', { error });
    return res.status(500).json({ success: false, message: 'Failed to insert row' });
  }
});

// Update a row by credentials
router.patch('/:agentId/:tableName/rows/:rowId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId, tableName, rowId } = req.params;
    const { tenantId } = req.user || {};
    if (!agentId) return res.status(400).json({ success: false, message: 'agentId missing' });
    if (!tenantId) return res.status(400).json({ success: false, message: 'tenantId missing' });
    if (!tableName) return res.status(400).json({ success: false, message: 'tableName missing' });
    if (!rowId) return res.status(400).json({ success: false, message: 'rowId missing' });
    const update = req.body as AgentTableRowUpdate;
    const updated = await TableService.updateRowByCredentials({ agentId, tenantId }, tableName, rowId, update);
    return res.json({ success: true, data: updated });
  } catch (error) {
    logger.error('PATCH /api/tables/:agentId/:tableName/rows/:rowId failed', { error });
    return res.status(500).json({ success: false, message: 'Failed to update row' });
  }
});

// Delete a row by credentials
router.delete('/:agentId/:tableName/rows/:rowId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId, tableName, rowId } = req.params;
    const { tenantId } = req.user || {};
    if (!agentId) return res.status(400).json({ success: false, message: 'agentId missing' });
    if (!tenantId) return res.status(400).json({ success: false, message: 'tenantId missing' });
    if (!tableName) return res.status(400).json({ success: false, message: 'tableName missing' });
    if (!rowId) return res.status(400).json({ success: false, message: 'rowId missing' });
    const ok = await TableService.deleteRowByCredentials({ agentId, tenantId }, tableName, rowId);
    return res.json({ success: ok });
  } catch (error) {
    logger.error('DELETE /api/tables/:agentId/:tableName/rows/:rowId failed', { error });
    return res.status(500).json({ success: false, message: 'Failed to delete row' });
  }
});

export default router;


