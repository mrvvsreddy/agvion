// knowledge/routes/knowledgeRoutes.ts
import { Router, Request, Response } from 'express';
import { IncomingMessage } from 'http';
import formidable from 'formidable';
import { authenticateToken, AuthenticatedRequest } from '../../../../auth/middleware/authMiddleware';
import KnowledgeService from '../services/KnowledgeService';
import { toHttp } from '../errors/KnowledgeErrors';
import logger from '../../../../utils/logger';
import SupabaseService from '../../../../database/config/supabase';
import KnowledgeSvc from '../services/KnowledgeService';

const router = Router();

/**
 * Create a new knowledge base
 * POST /api/knowledge
 */
router.post('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, type, agentId } = req.body;
    const sessionToken = req.user?.sessionToken;
    const tenantId = req.user?.tenantId;

    logger.info('POST /api/knowledge: received request', { 
      hasBody: !!req.body,
      userId: req.user?.id ? req.user.id.substring(0, 8) + '...' : 'missing',
      hasTenantId: !!tenantId,
      hasAgentId: !!agentId
    });

    // Validate input
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Knowledge base name is required'
      });
    }

    if (!agentId || typeof agentId !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Agent ID is required'
      });
    }

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'User tenant information is missing'
      });
    }

    if (!sessionToken) {
      return res.status(400).json({
        success: false,
        message: 'Session token is required'
      });
    }

    // Default to knowledge type
    const knowledgeType = 'knowledge';

    const result = await KnowledgeService.createKnowledgeBase({
      name: name.trim(),
      type: knowledgeType,
      sessionToken: sessionToken,
      agentId,
      tenantId
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.status(201).json(result);
  } catch (error) {
    logger.error('Error creating knowledge base', { error, userId: req.user?.id });
    const { status, body } = toHttp(error);
    return res.status(status).json(body);
  }
});

/**
 * List files (manifest) for a knowledge base
 * GET /api/knowledge/:id/files?agentId=xxx
 */
router.get('/:id/files', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const agentId = req.query.agentId as string;
    const tenantId = req.user?.tenantId as string | undefined;

    if (!id || !agentId) {
      return res.status(400).json({ error: 'KnowledgeBase ID and agentId are required' });
    }

    const client = SupabaseService.getInstance().getClient();
    let query = client
      .from('agent_table_rows')
      .select('id, row_data, created_at')
      .eq('table_id', id)
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false });
    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }
    const { data, error } = await query;
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    const files = (data || [])
      .map((r: any) => ({
        id: r.id,
        fileName: r.row_data?.fileName || r.row_data?.file_name,
        sizeBytes: r.row_data?.sizeBytes,
        uploadedAt: r.row_data?.uploadedAt || r.created_at,
        chunkCount: r.row_data?.chunk_count || 0
      }))
      .filter((f: any) => !!f.fileName);
    return res.json({ files });
  } catch (error) {
    logger.error('Error fetching knowledge files', { error, knowledgeBaseId: req.params.id, userId: req.user?.id });
    const { status, body } = toHttp(error);
    return res.status(status).json(body);
  }
});

/**
 * Get all knowledge bases for the authenticated user
 * GET /api/knowledge?agentId=xxx
 */
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sessionToken = req.user?.sessionToken;
    const tenantId = req.user?.tenantId;
    const agentId = req.query.agentId as string;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'User tenant information is missing'
      });
    }

    if (!agentId) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID is required'
      });
    }

    const result = await KnowledgeService.getKnowledgeBases({
      sessionToken: sessionToken!,
      tenantId: tenantId!,
      agentId
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.status(200).json(result);
  } catch (error) {
    logger.error('Error fetching knowledge bases', { error, userId: req.user?.id });
    const { status, body } = toHttp(error);
    return res.status(status).json(body);
  }
});

/**
 * Get a specific knowledge base by ID
 * GET /api/knowledge/:id?agentId=xxx
 */
router.get('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const sessionToken = req.user?.sessionToken;
    const tenantId = req.user?.tenantId;
    const agentId = req.query.agentId as string;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Knowledge base ID is required'
      });
    }

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'User tenant information is missing'
      });
    }

    if (!agentId) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID is required'
      });
    }

    const result = await KnowledgeService.getKnowledgeBase({
      knowledgeBaseId: id,
      sessionToken: sessionToken!,
      tenantId: tenantId!,
      agentId
    });

    if (!result.success) {
      return res.status(404).json(result);
    }

    return res.status(200).json(result);
  } catch (error) {
    logger.error('Error fetching knowledge base', { error, knowledgeBaseId: req.params.id, userId: req.user?.id });
    const { status, body } = toHttp(error);
    return res.status(status).json(body);
  }
});

/**
 * Update a knowledge base
 * PUT /api/knowledge/:id?agentId=xxx
 */
router.put('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, type } = req.body;
    const sessionToken = req.user?.sessionToken;
    const tenantId = req.user?.tenantId;
    const agentId = req.query.agentId as string;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Knowledge base ID is required'
      });
    }

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'User tenant information is missing'
      });
    }

    if (!agentId) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID is required'
      });
    }

    const result = await KnowledgeService.updateKnowledgeBase({
      knowledgeBaseId: id,
      name,
      type,
      sessionToken: sessionToken!,
      tenantId: tenantId!,
      agentId
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.status(200).json(result);
  } catch (error) {
    logger.error('Error updating knowledge base', { error, knowledgeBaseId: req.params.id, userId: req.user?.id });
    const { status, body } = toHttp(error);
    return res.status(status).json(body);
  }
});

/**
 * Delete a knowledge base
 * DELETE /api/knowledge/:id?agentId=xxx
 */
router.delete('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const sessionToken = req.user?.sessionToken;
    const tenantId = req.user?.tenantId;
    const agentId = req.query.agentId as string;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Knowledge base ID is required'
      });
    }

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'User tenant information is missing'
      });
    }

    if (!agentId) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID is required'
      });
    }

    const result = await KnowledgeService.deleteKnowledgeBase({
      knowledgeBaseId: id,
      sessionToken: sessionToken!,
      tenantId: tenantId!,
      agentId
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.status(200).json(result);
  } catch (error) {
    logger.error('Error deleting knowledge base', { error, knowledgeBaseId: req.params.id, userId: req.user?.id });
    const { status, body } = toHttp(error);
    return res.status(status).json(body);
  }
});

/**
 * Upload files/text to knowledge base
 * POST /api/knowledge/:id/upload?agentId=xxx
 * Supports multipart/form-data with files and/or text content
 */
router.post('/:id/upload', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const sessionToken = req.user?.sessionToken;
    const tenantId = req.user?.tenantId;
    const agentId = req.query.agentId as string;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Knowledge base ID is required'
      });
    }

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'User tenant information is missing'
      });
    }

    if (!agentId) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID is required'
      });
    }

    // Parse multipart form data
    const form = formidable({
      maxFileSize: 50 * 1024 * 1024, // 50MB max file size
      multiples: true,
      keepExtensions: true
    });

    const [fields, files] = await form.parse(req as unknown as IncomingMessage);

    // Extract files
    const fileList = Array.isArray(files.files) ? files.files : (files.files ? [files.files] : []);
    const processedFiles: Array<{
      buffer: Buffer;
      fileName: string;
      mimeType?: string;
    }> = [];

    for (const file of fileList) {
      if (file && file.filepath) {
        const fs = await import('fs/promises');
        const buffer = await fs.readFile(file.filepath);
        const fileData: {
          buffer: Buffer;
          fileName: string;
          mimeType?: string;
        } = {
          buffer,
          fileName: file.originalFilename || file.newFilename
        };
        
        if (file.mimetype) {
          fileData.mimeType = file.mimetype;
        }
        
        processedFiles.push(fileData);
      }
    }

    // Extract text content
    const textContent = Array.isArray(fields.textContent) 
      ? fields.textContent[0] 
      : (fields.textContent as any);

    if (processedFiles.length === 0 && !textContent) {
      return res.status(400).json({
        success: false,
        message: 'No files or text content provided'
      });
    }

    // Upload to knowledge base
    const uploadRequest: {
      knowledgeBaseId: string;
      agentId: string;
      tenantId: string;
      files?: Array<{
        buffer: Buffer;
        fileName: string;
        mimeType?: string;
      }>;
      textContent?: string;
    } = {
      knowledgeBaseId: id,
      agentId,
      tenantId
    };
    
    if (processedFiles.length > 0) {
      uploadRequest.files = processedFiles;
    }
    
    if (textContent) {
      uploadRequest.textContent = textContent;
    }
    
    const result = await KnowledgeService.uploadToKnowledgeBase(uploadRequest);

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.status(200).json(result);
  } catch (error) {
    logger.error('Error uploading to knowledge base', {
      error,
      knowledgeBaseId: req.params.id,
      userId: req.user?.id
    });
    const { status, body } = toHttp(error);
    return res.status(status).json(body);
  }
});

/**
 * NEW: Simple upload endpoint expecting a single file (non-multipart helpers)
 * POST /api/knowledge/upload
 */
router.post('/upload', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId, tenantId, knowledgeBaseId } = req.body || {};

    if (!agentId || !tenantId || !knowledgeBaseId) {
      return res.status(400).json({ error: 'agentId, tenantId, knowledgeBaseId are required' });
    }

    // Use formidable to parse if file is sent as multipart
    if ((req.headers['content-type'] || '').includes('multipart/form-data')) {
      const form = formidable({ maxFileSize: 50 * 1024 * 1024, multiples: false, keepExtensions: true });
      const [fields, files] = await form.parse(req as unknown as IncomingMessage);
      const file = (files.file as any) || (files.files as any);
      if (!file || !file.filepath) {
        return res.status(400).json({ error: 'No file provided' });
      }
      const fs = await import('fs/promises');
      const buffer = await fs.readFile(file.filepath);
      const result = await KnowledgeService.uploadDocument(buffer, file.originalFilename || file.newFilename, file.mimetype, {
        agentId,
        tenantId,
        knowledgeBaseId
      });
      return res.json(result);
    }

    // If someone posts raw body, reject for now
    return res.status(400).json({ error: 'Use multipart/form-data to upload a file' });
  } catch (error) {
    logger.error('Upload failed', { error });
    return res.status(500).json({ error: 'Upload failed' });
  }
});

/**
 * Get full document content for editing
 * GET /api/knowledge/:fileId/content?agentId=xxx
 */
router.get('/:fileId/content', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { fileId } = req.params;
    const agentId = req.query.agentId as string;
    if (!fileId || !agentId) {
      return res.status(400).json({ error: 'fileId and agentId are required' });
    }

    const client = SupabaseService.getInstance().getClient();
    const { data, error } = await client
      .from('agent_table_rows')
      .select('*')
      .eq('id', fileId)
      .eq('agent_id', agentId)
      .single();
    if (error || !data) {
      return res.status(404).json({ error: 'Document not found' });
    }
    const row: any = data as any;
    return res.json({
      fileId: row.id,
      fileName: row.row_data?.file_name,
      fileType: row.row_data?.file_type,
      content: row.row_data?.original_content,
      contentLength: row.row_data?.content_length,
      chunkCount: row.row_data?.chunk_count,
      isEditable: row.row_data?.is_editable,
      metadata: row.row_data?.metadata
    });
  } catch (error) {
    logger.error('Failed to fetch document', { error });
    return res.status(500).json({ error: 'Failed to fetch document' });
  }
});

/**
 * Edit document content
 * PATCH /api/knowledge/:fileId/content
 */
router.patch('/:fileId/content', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { fileId } = req.params;
    const { content, agentId, tenantId } = req.body || {};
    if (!fileId || typeof content !== 'string' || !agentId || !tenantId) {
      return res.status(400).json({ error: 'fileId, content, agentId, tenantId are required' });
    }
    const result = await KnowledgeService.editDocument(fileId, content, { agentId, tenantId });
    return res.json(result);
  } catch (error) {
    logger.error('Edit failed', { error });
    return res.status(500).json({ error: 'Edit failed' });
  }
});

/**
 * Vector search with optional file filtering
 * POST /api/knowledge/search
 */
router.post('/search', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { query, knowledgeBaseId, agentId, tenantId, fileNames, limit, threshold } = req.body || {};
    if (!query || !knowledgeBaseId || !agentId || !tenantId) {
      return res.status(400).json({ error: 'query, knowledgeBaseId, agentId, tenantId are required' });
    }
    const results = await KnowledgeService.searchKnowledgeBase(query, knowledgeBaseId, {
      agentId,
      tenantId,
      fileNames,
      limit,
      threshold
    });
    return res.json({ results });
  } catch (error) {
    logger.error('Search failed', { error });
    return res.status(500).json({ error: 'Search failed' });
  }
});

/**
 * DELETE /api/knowledge/files/:fileId
 * Delete a document and its chunks
 */
router.delete('/files/:fileId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { fileId } = req.params;
    const agentId = (req.body?.agentId as string) || (req.query.agentId as string);
    const tenantId = req.user?.tenantId as string;
    const hard = req.query.hard === 'true' || req.body?.hard === true;
    if (!fileId || !agentId || !tenantId) {
      return res.status(400).json({ error: 'fileId, agentId required' });
    }
    const result = await KnowledgeSvc.deleteDocument(fileId, { agentId, tenantId, hard });
    return res.json(result);
  } catch (error) {
    logger.error('Delete document failed', { error, fileId: req.params.fileId, userId: req.user?.id });
    const { status, body } = toHttp(error);
    return res.status(status).json(body);
  }
});

/**
 * POST /api/knowledge/files/bulk-delete
 * Bulk delete documents
 */
router.post('/files/bulk-delete', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { fileIds = [], hard = false, agentId } = req.body || {};
    const tenantId = req.user?.tenantId as string;
    if (!Array.isArray(fileIds) || fileIds.length === 0 || !agentId || !tenantId) {
      return res.status(400).json({ error: 'fileIds[], agentId required' });
    }
    const result = await KnowledgeSvc.bulkDeleteDocuments(fileIds, { agentId, tenantId, hard });
    return res.json(result);
  } catch (error) {
    logger.error('Bulk delete documents failed', { error, userId: req.user?.id });
    const { status, body } = toHttp(error);
    return res.status(status).json(body);
  }
});

export { router as knowledgeRoutes };
