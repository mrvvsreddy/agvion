// path: src/integrations/agent_knowledge/integration.ts

import { ExecutionContext, IntegrationResult } from '../../types/context';
import { createDataIntegration } from '../../types/integrations';
import logger from '../../utils/logger';
import SupabaseService from '../../database/config/supabase';
import AgentTablesRepositoryDefault, { AgentTablesRepository as AgentTablesRepositoryClass } from '../../database/repositories/AgentTablesColumnsRepository';
import AgentVectorDataRepositoryDefault, { AgentVectorDataRepository as AgentVectorDataRepositoryClass } from '../../database/repositories/AgentVectorDataRepository';
import { awsEmbeddingService } from './aws-embedding-service';

type AgentTablesRepository = AgentTablesRepositoryClass;
type AgentVectorDataRepository = AgentVectorDataRepositoryClass;

const agentTablesRepo: AgentTablesRepository = AgentTablesRepositoryDefault;
const vectorRepo: AgentVectorDataRepository = AgentVectorDataRepositoryDefault;

/**
 * Extract tool credentials from workflow configuration and execution context
 * Enhanced to check multiple credential sources including stored context credentials
 */
function extractToolCredentials(context: any, config: any): any {
  // Priority 1: Direct credentials from workflow tool configuration (highest priority)
  if (config.credentials && typeof config.credentials === 'object') {
    return config.credentials;
  }
  
  // Priority 2: Check stored tool credentials in execution context
  if (context.variables?.toolCredentials?.agent_knowledge) {
    return context.variables.toolCredentials.agent_knowledge;
  }
  
  // Priority 3: Check execution context credentials
  if (context.credentials && typeof context.credentials === 'object') {
    return context.credentials;
  }
  
  // Priority 4: Legacy - Try to find tool configuration in nodeData
  const nodeData = (context as any).nodeData;
  if (nodeData && typeof nodeData === 'object') {
    // Look for tool configuration in nodeData
    const smartAgentNode = nodeData['Smart Agent With Memory'] || nodeData[config.name] || nodeData[config.id];
    if (smartAgentNode?.agentConfig?.tools) {
      const knowledgeTool = smartAgentNode.agentConfig.tools.find((tool: any) => 
        tool.integrationName === 'agent-knowledge' || tool.integrationName === 'agent_knowledge'
      );
      if (knowledgeTool?.credentials) {
        return knowledgeTool.credentials;
      }
    }
  }
  
  return null;
}

/**
 * Extract table identifiers from workflow credentials and multiple fallback locations
 * Enhanced to check stored credentials and provide better fallbacks
 */
function extractTableIdentifiers(context: any, config: any): { tableId?: string; tableName?: string } {
  // Priority 1: Workflow tool credentials (highest priority)
  let tableId = config.credentials?.tableId as string | undefined;
  let tableName = config.credentials?.tableName as string | undefined;
  
  // Priority 2: Direct config properties (from LLM parameters)
  if (!tableId && config.tableId) {
    tableId = config.tableId;
  }
  if (!tableName && config.tableName) {
    tableName = config.tableName;
  }
  
  // Priority 3: Tool credentials from context (enhanced extraction)
  if (!tableId || !tableName) {
    const toolCredentials = extractToolCredentials(context, config);
    if (!tableId && toolCredentials?.tableId) {
      tableId = toolCredentials.tableId;
    }
    if (!tableName && toolCredentials?.tableName) {
      tableName = toolCredentials.tableName;
    }
  }
  
  // Priority 4: Context-level credentials (legacy support)
  if (!tableId && (context as any).credentials?.tableId) {
    tableId = (context as any).credentials.tableId;
  }
  if (!tableName && (context as any).credentials?.tableName) {
    tableName = (context as any).credentials.tableName;
  }
  
  // Priority 5: Check execution context variables for stored credentials
  if (!tableId || !tableName) {
    const storedCredentials = context.variables?.toolCredentials?.agent_knowledge;
    if (storedCredentials) {
      if (!tableId && storedCredentials.tableId) {
        tableId = storedCredentials.tableId;
      }
      if (!tableName && storedCredentials.tableName) {
        tableName = storedCredentials.tableName;
      }
    }
  }
  
  // Priority 6: No fallbacks - tableName or tableId must be provided in workflow configuration
  
  return { 
    ...(tableId && { tableId }), 
    ...(tableName && { tableName }) 
  };
}

/**
 * Resolve the target table either by explicit tableId or by name for an agent
 * Enhanced to support tenant-based table resolution
 */
async function resolveAgentTable(agentId: string, tableId?: string, tableName?: string, tenantId?: string) {
  if (tableId) {
    const client = SupabaseService.getInstance().getClient();
    let query = client.from('agent_tables').select('*').eq('id', tableId);
    
    // Add tenant filter if provided
    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }
    
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(`Failed to resolve table by id: ${error.message}`);
    if (!data) throw new Error('Agent table not found');
    return data as any;
  }
  if (tableName) {
    // Use enhanced repository method that includes tenant filtering
    const table = await agentTablesRepo.findByAgentTenantAndName(agentId, tenantId || '', tableName);
    if (!table) throw new Error('Agent table not found by name');
    return table as any;
  }
  throw new Error('Either tableId or tableName must be provided');
}

/**
 * Retrieve vector rows for an agent/table with pagination and similarity search
 * Enhanced to handle various search parameters and provide better LLM compatibility
 */
export async function retrieveVectors(context: ExecutionContext, config: any): Promise<IntegrationResult> {
  const agentId = config.agentId || context.agentId;
  const tenantId = config.tenantId || (context as any).tenantId;
  
  // Extract table identifiers using helper function
  const { tableId, tableName } = extractTableIdentifiers(context, config);
  const toolCredentials = extractToolCredentials(context, config);
  const nodeData = (context as any).nodeData;
  
  const page = Number(config.page ?? 1);
  const limit = Number(config.limit ?? 50);
  const topK = Number(config.topK ?? 10); // Increased default for better search results
  const similarityThreshold = Number(config.similarityThreshold ?? 0.5); // Lowered for more results
  
  // Handle various query parameter names for LLM compatibility
  const query = config.query || config.searchQuery || config.search || config.text || config.userInput;

  if (!agentId || !tenantId) {
    throw new Error('agentId and tenantId are required');
  }

  // Debug logging to understand parameter structure
  logger.debug('Agent knowledge parameter debug', {
    configKeys: Object.keys(config),
    contextKeys: Object.keys(context),
    workflowCredentials: config.credentials,
    contextCredentials: (context as any).credentials,
    nodeDataKeys: nodeData ? Object.keys(nodeData) : null,
    extractedToolCredentials: toolCredentials,
    extractedTableId: tableId,
    extractedTableName: tableName,
    credentialFlow: {
      'step1_workflow_credentials': config.credentials,
      'step2_direct_config': { tableId: config.tableId, tableName: config.tableName },
      'step3_tool_credentials': toolCredentials,
      'step4_context_credentials': (context as any).credentials,
      'step5_env_fallback': process.env.DEFAULT_KNOWLEDGE_TABLE
    },
    allConfigValues: config
  });

  logger.info('Agent knowledge search requested', {
    agentId,
    tenantId,
    tableId,
    tableName,
    hasQuery: !!query,
    queryLength: query ? String(query).length : 0,
    topK,
    similarityThreshold
  });

  // Enhanced error handling with detailed parameter information
  if (!tableId && !tableName) {
    logger.error('Missing table identifier in agent knowledge request', {
      agentId,
      tenantId,
      configKeys: Object.keys(config),
      contextKeys: Object.keys(context),
      workflowCredentials: config.credentials,
      contextCredentials: (context as any).credentials,
      nodeDataKeys: nodeData ? Object.keys(nodeData) : null,
      extractedToolCredentials: toolCredentials,
      extractedTableId: tableId,
      extractedTableName: tableName,
      availableParams: {
        'workflow.credentials.tableId': config.credentials?.tableId,
        'workflow.credentials.tableName': config.credentials?.tableName,
        'config.tableId': config.tableId,
        'config.tableName': config.tableName,
        'toolCredentials.tableId': toolCredentials?.tableId,
        'toolCredentials.tableName': toolCredentials?.tableName,
        'context.credentials.tableId': (context as any).credentials?.tableId,
        'context.credentials.tableName': (context as any).credentials?.tableName,
        'env.DEFAULT_KNOWLEDGE_TABLE': process.env.DEFAULT_KNOWLEDGE_TABLE
      }
    });
    throw new Error(`Either tableId or tableName must be provided in workflow credentials or config. Workflow credentials: ${JSON.stringify(config.credentials)}. Config: ${JSON.stringify({tableId: config.tableId, tableName: config.tableName})}. Tool credentials: ${JSON.stringify(toolCredentials)}`);
  }

  const table = await resolveAgentTable(agentId, tableId, tableName, tenantId);

  // If query is provided, perform similarity search
  if (query && String(query).trim()) {
    const searchResult = await performSimilaritySearch(table, String(query).trim(), topK, similarityThreshold, context);
    
    logger.info('Knowledge search completed', {
      agentId,
      tenantId,
      tableName: table.table_name,
      query: String(query).trim(),
      resultsCount: (searchResult.json as any).totalResults || 0
    });
    
    return searchResult;
  }

  // Otherwise, return paginated results
  const result = await vectorRepo.findByTable(table.id, { page, limit, orderBy: 'created_at', orderDirection: 'desc' });

  logger.info('Knowledge browse completed', {
    agentId,
    tenantId,
    tableName: table.table_name,
    resultsCount: result.data.length,
    totalCount: result.totalCount
  });

  return {
    json: {
      success: true,
      table: { id: table.id, name: table.table_name, columns: table.columns, description: table.description },
      data: result.data,
      pagination: { page: result.page, limit: result.limit, totalCount: result.totalCount, totalPages: result.totalPages },
      operation: 'browse'
    }
  };
}

/**
 * Perform vector similarity search on embeddings
 * Optimized for large documents with fast semantic search
 */
async function performSimilaritySearch(
  table: any, 
  query: string, 
  topK: number, 
  similarityThreshold: number,
  context: ExecutionContext
): Promise<IntegrationResult> {
  const client = SupabaseService.getInstance().getClient();
  
  try {
    logger.debug('Performing vector similarity search', {
      tableId: table.id,
      tableName: table.table_name,
      query,
      topK,
      similarityThreshold
    });

    // Step 1: Generate embedding for the query
    const queryEmbedding = await generateQueryEmbedding(query);
    
    if (!queryEmbedding) {
      // Fallback to text search if embedding generation fails
      logger.warn('Query embedding generation failed, falling back to text search');
      return await performTextSearchFallback(table, query, topK, context);
    }

    // Step 2: Perform vector similarity search using Supabase's built-in vector operations
    const { data: vectorResults, error: vectorError } = await client
      .from('agent_vector_data')
      .select('id, content, chunk_index, metadata, created_at, updated_at')
      .eq('table_id', table.id)
      .order('embedding <-> ' + JSON.stringify(queryEmbedding), { ascending: true })
      .limit(topK * 2); // Get more results for better filtering

    if (vectorError) {
      logger.warn('Vector search failed, falling back to text search', { error: vectorError.message });
      return await performTextSearchFallback(table, query, topK, context);
    }

    let results = (vectorResults as any[]) || [];

    // Calculate similarity scores (Supabase returns distance, we need similarity)
    results = results.map((item: any, index: number) => ({
      ...item,
      similarity: 1 - (index * 0.05) // Approximate similarity based on order
    }));

    // Filter by similarity threshold
    results = results.filter((item: any) => item.similarity >= similarityThreshold);

    // Step 3: If no vector results, try hybrid search (vector + text)
    if (results.length === 0) {
      logger.debug('No vector results found, trying hybrid search');
      results = await performHybridSearch(client, table, query, queryEmbedding, topK);
    }

    // Step 4: Format and rank results
    const formattedResults = results
      .slice(0, topK)
      .map((item: any, index: number) => ({
        id: item.id,
        content: item.content,
        chunkIndex: item.chunk_index,
        metadata: item.metadata,
        similarity: item.similarity || (1 - (index * 0.1)), // Synthetic similarity if not provided
        createdAt: item.created_at,
        rank: index + 1
      }));

    // Step 5: Create optimized context for LLM
    const contextChunks = formattedResults.map((r, i) => 
      `[Chunk ${r.chunkIndex || i + 1}] ${r.content.substring(0, 500)}${r.content.length > 500 ? '...' : ''}`
    );

    const summary = formattedResults.length > 0 
      ? `Found ${formattedResults.length} semantically relevant knowledge entries for "${query}" (similarity threshold: ${similarityThreshold})`
      : `No relevant knowledge found for "${query}" above similarity threshold ${similarityThreshold}`;

    logger.info('Vector search completed', {
      tableId: table.id,
      tableName: table.table_name,
      query,
      resultsCount: formattedResults.length,
      avgSimilarity: formattedResults.length > 0 
        ? (formattedResults.reduce((sum, r) => sum + r.similarity, 0) / formattedResults.length).toFixed(3)
        : 0,
      searchMethod: 'vector_similarity'
    });

    return {
      json: {
        success: true,
        table: { id: table.id, name: table.table_name },
        query,
        topK,
        similarityThreshold,
        results: formattedResults,
        totalResults: formattedResults.length,
        summary,
        operation: 'vector_search',
        searchMethod: 'vector_similarity',
        // Optimized context for LLM - ready to use
        formattedContext: formattedResults.length > 0 
          ? contextChunks.join('\n\n')
          : 'No relevant information found in knowledge base.',
        // Additional metadata for debugging
        performance: {
          searchType: 'vector_similarity',
          avgSimilarity: formattedResults.length > 0 
            ? formattedResults.reduce((sum, r) => sum + r.similarity, 0) / formattedResults.length
            : 0
        }
      }
    };
  } catch (error) {
    logger.error('Vector search error, falling back to text search', { 
      error: error instanceof Error ? error.message : String(error), 
      tableId: table.id, 
      tableName: table.table_name,
      query 
    });
    
    // Fallback to text search on any error
    return await performTextSearchFallback(table, query, topK, context);
  }
}

/**
 * Generate embedding for query using AWS Bedrock models
 * This matches the embedding model used for document chunks (AWS embedding model)
 */
async function generateQueryEmbedding(query: string): Promise<number[] | null> {
  try {
    if (!awsEmbeddingService.isConfigured()) {
      logger.warn('AWS embedding service not configured, falling back to text search');
      return null;
    }

    logger.debug('Generating query embedding using AWS service', {
      query,
      config: awsEmbeddingService.getConfig()
    });

    const embedding = await awsEmbeddingService.generateEmbedding(query);

    if (!embedding) {
      logger.warn('AWS embedding service returned null, falling back to text search');
      return null;
    }

    logger.debug('Query embedding generated successfully with AWS service', {
      query,
      embeddingLength: embedding.length,
      config: awsEmbeddingService.getConfig()
    });

    return embedding;
    
  } catch (error) {
    logger.error('Failed to generate query embedding with AWS service', { 
      error: error instanceof Error ? error.message : String(error),
      query 
    });
    return null;
  }
}

/**
 * Perform hybrid search combining vector and text search using Supabase
 */
async function performHybridSearch(
  client: any,
  table: any,
  query: string,
  queryEmbedding: number[],
  topK: number
): Promise<any[]> {
  try {
    // Combine vector search with text search for better coverage
    const [vectorResults, textResults] = await Promise.all([
      // Vector search with Supabase vector operations
      client
        .from('agent_vector_data')
        .select('id, content, chunk_index, metadata, created_at, updated_at')
        .eq('table_id', table.id)
        .order('embedding <-> ' + JSON.stringify(queryEmbedding), { ascending: true })
        .limit(Math.ceil(topK / 2)),
      // Text search as backup
      client
        .from('agent_vector_data')
        .select('id, content, chunk_index, metadata, created_at, updated_at')
        .eq('table_id', table.id)
        .ilike('content', `%${query}%`)
        .limit(Math.ceil(topK / 2))
    ]);

    const combined = new Map();
    
    // Add vector results with higher priority and calculated similarity
    if (vectorResults.data) {
      vectorResults.data.forEach((item: any, index: number) => {
        combined.set(item.id, { 
          ...item, 
          searchType: 'vector', 
          priority: 1,
          similarity: 1 - (index * 0.1) // Higher similarity for vector results
        });
      });
    }
    
    // Add text results with lower priority (only if not already included)
    if (textResults.data) {
      textResults.data.forEach((item: any, index: number) => {
        if (!combined.has(item.id)) {
          combined.set(item.id, { 
            ...item, 
            searchType: 'text', 
            priority: 2, 
            similarity: 0.6 - (index * 0.05) // Lower similarity for text results
          });
        }
      });
    }

    return Array.from(combined.values())
      .sort((a, b) => a.priority - b.priority || (b.similarity || 0) - (a.similarity || 0));
      
  } catch (error) {
    logger.error('Hybrid search failed', { error });
    return [];
  }
}

/**
 * Fallback text search when vector search is not available
 */
async function performTextSearchFallback(
  table: any,
  query: string,
  topK: number,
  context: ExecutionContext
): Promise<IntegrationResult> {
  const client = SupabaseService.getInstance().getClient();
  
  logger.info('Performing text search fallback', {
    tableId: table.id,
    tableName: table.table_name,
    query,
    topK
  });

  // Enhanced text search with word-based fallback
  const { data: exactResults, error: exactError } = await client
    .from('agent_vector_data')
    .select('*')
    .eq('table_id', table.id)
    .ilike('content', `%${query}%`)
    .order('created_at', { ascending: false })
    .limit(topK * 2);

  if (exactError) {
    throw new Error(`Text search failed: ${exactError.message}`);
  }

  let results = (exactResults as any[]) || [];

  // If no exact matches, try word-based search
  if (results.length === 0) {
    const words = query.toLowerCase().split(/\s+/).filter(word => word.length > 2);
    if (words.length > 0) {
      const wordSearchPromises = words.map(word => 
        client
          .from('agent_vector_data')
          .select('*')
          .eq('table_id', table.id)
          .ilike('content', `%${word}%`)
          .limit(3)
      );

      const wordResults = await Promise.all(wordSearchPromises);
      const combinedResults = new Map();
      
      wordResults.forEach(result => {
        if (result.data) {
          result.data.forEach((item: any) => {
            if (!combinedResults.has(item.id)) {
              combinedResults.set(item.id, item);
            }
          });
        }
      });

      results = Array.from(combinedResults.values());
    }
  }

  // Format results with text-based scoring
  const formattedResults = results
    .slice(0, topK)
    .map((item: any, index: number) => ({
      id: item.id,
      content: item.content,
      chunkIndex: item.chunk_index,
      metadata: item.metadata,
      similarity: 1 - (index * 0.1), // Synthetic similarity for text search
      createdAt: item.created_at,
      rank: index + 1,
      searchType: 'text_fallback'
    }));

  const contextChunks = formattedResults.map((r, i) => 
    `[Chunk ${r.chunkIndex || i + 1}] ${r.content.substring(0, 500)}${r.content.length > 500 ? '...' : ''}`
  );

  const summary = formattedResults.length > 0 
    ? `Found ${formattedResults.length} text-matched knowledge entries for "${query}"`
    : `No knowledge entries found for "${query}"`;

  return {
    json: {
      success: true,
      table: { id: table.id, name: table.table_name },
      query,
      results: formattedResults,
      totalResults: formattedResults.length,
      summary,
      operation: 'text_search_fallback',
      searchMethod: 'text_fallback',
      formattedContext: formattedResults.length > 0 
        ? contextChunks.join('\n\n')
        : 'No relevant information found in knowledge base.',
      performance: {
        searchType: 'text_fallback',
        avgSimilarity: formattedResults.length > 0 
          ? formattedResults.reduce((sum, r) => sum + r.similarity, 0) / formattedResults.length
          : 0
      }
    }
  };
}

/**
 * Inspect table: counts, distinct chunks, latest timestamps
 */
export async function inspectTable(context: ExecutionContext, config: any): Promise<IntegrationResult> {
  const agentId = config.agentId || context.agentId;
  const tenantId = config.tenantId || (context as any).tenantId;
  
  // Extract table identifiers using helper function
  const { tableId, tableName } = extractTableIdentifiers(context, config);

  if (!agentId || !tenantId) {
    throw new Error('agentId and tenantId are required');
  }

  const table = await resolveAgentTable(agentId, tableId, tableName, tenantId);

  const client = SupabaseService.getInstance().getClient();

  // total vectors
  const { count: totalVectors, error: countErr } = await client
    .from('agent_vector_data')
    .select('*', { count: 'exact', head: true })
    .eq('table_id', table.id);
  if (countErr) throw new Error(`Failed to count vectors: ${countErr.message}`);

  // distinct chunks count
  const { data: chunkRows, error: chunkErr } = await client
    .from('agent_vector_data')
    .select('chunk_index')
    .eq('table_id', table.id);
  if (chunkErr) throw new Error(`Failed to read chunk indexes: ${chunkErr.message}`);
  const distinctChunks = new Set<number>();
  for (const row of (chunkRows as any[])) {
    if (typeof row.chunk_index === 'number') distinctChunks.add(row.chunk_index);
  }

  // last updated
  const { data: latestRow, error: latestErr } = await client
    .from('agent_vector_data')
    .select('updated_at')
    .eq('table_id', table.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestErr) throw new Error(`Failed to read latest update: ${latestErr.message}`);

  return {
    json: {
      success: true,
      table: { id: table.id, name: table.table_name, columns: table.columns, description: table.description },
      stats: {
        totalVectors: totalVectors || 0,
        distinctChunks: distinctChunks.size,
        lastUpdatedAt: (latestRow as any)?.updated_at || null
      }
    }
  };
}

/**
 * Get all vectors for a specific chunk index
 */
export async function getChunk(context: ExecutionContext, config: any): Promise<IntegrationResult> {
  const agentId = config.agentId || context.agentId;
  const tenantId = config.tenantId || (context as any).tenantId;
  
  // Extract table identifiers using helper function
  const { tableId, tableName } = extractTableIdentifiers(context, config);
  
  const chunkIndex = Number(config.chunkIndex);
  const limit = Number(config.limit ?? 100);

  if (!agentId || !tenantId) {
    throw new Error('agentId and tenantId are required');
  }
  if (!Number.isFinite(chunkIndex)) {
    throw new Error('chunkIndex is required and must be a number');
  }

  const table = await resolveAgentTable(agentId, tableId, tableName, tenantId);

  const { data: rows, error } = await SupabaseService.getInstance().getClient()
    .from('agent_vector_data')
    .select('*')
    .eq('table_id', table.id)
    .eq('chunk_index', chunkIndex)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Failed to read chunk ${chunkIndex}: ${error.message}`);

  return {
    json: {
      success: true,
      table: { id: table.id, name: table.table_name },
      chunkIndex,
      rows
    }
  };
}

/**
 * Search content by phrase across all chunks for a table
 */
export async function searchContent(context: ExecutionContext, config: any): Promise<IntegrationResult> {
  const agentId = config.agentId || context.agentId;
  const tenantId = config.tenantId || (context as any).tenantId;
  
  // Extract table identifiers using helper function
  const { tableId, tableName } = extractTableIdentifiers(context, config);
  
  const query: string = config.query;
  const limit: number = Number(config.limit ?? 500);

  if (!agentId || !tenantId) {
    throw new Error('agentId and tenantId are required');
  }
  if (!query || typeof query !== 'string' || !query.trim()) {
    throw new Error('query is required');
  }

  const table = await resolveAgentTable(agentId, tableId, tableName, tenantId);

  const client = SupabaseService.getInstance().getClient();
  const { data, error } = await client
    .from('agent_vector_data')
    .select('*')
    .eq('table_id', table.id)
    .ilike('content', `%${query}%`)
    .order('chunk_index', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Search failed: ${error.message}`);
  }

  const rows = (data as any[]) || [];
  const chunkIndexes = Array.from(new Set(rows.map(r => r.chunk_index))).sort((a, b) => a - b);

  return {
    json: {
      success: true,
      table: { id: table.id, name: table.table_name },
      query,
      chunkIndexes,
      rows
    }
  };
}

// Wire as integration functions for registry usage where needed
export const retrieveVectorsIntegration = createDataIntegration(
  'knowledge.retrieve',
  retrieveVectors,
  'Retrieve vector rows for an agent table with pagination'
);

export const inspectTableIntegration = createDataIntegration(
  'knowledge.inspect',
  inspectTable,
  'Inspect agent knowledge table and return stats'
);

export const getChunkIntegration = createDataIntegration(
  'knowledge.getChunk',
  getChunk,
  'Retrieve vectors for a specific chunk index'
);

export const searchContentIntegration = createDataIntegration(
  'knowledge.searchContent',
  searchContent,
  'Search content by phrase across table chunks'
);

export default {
  retrieveVectors,
  inspectTable,
  getChunk,
  retrieveVectorsIntegration,
  inspectTableIntegration,
  getChunkIntegration,
  searchContent,
  searchContentIntegration
};


