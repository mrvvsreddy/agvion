// path: src/integrations/agent_knowledge/index.ts
// 
// Available functions for LLM usage:
// - agent_knowledge.search (recommended) - AWS Bedrock vector search with query
// - agent_knowledge.retrieve - Same as search, with optional query
// - agent_knowledge.searchContent - Exact text matching
// 
// Parameters: { query: string, tableName: string, topK?: number }
// Note: tableName/tableId can be provided in config or credentials for workflow compatibility
// 
// Uses AWS Bedrock embeddings for semantic search
// Requires: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_EMBEDDING_MODEL

import { Integration, createDataIntegration } from '../../types/integrations';
import { retrieveVectors, inspectTable, getChunk, searchContent } from './integration';

export default {
  register(): Integration {
    const functions = new Map();

    // Primary retrieve function - for similarity search with query
    functions.set('retrieve', createDataIntegration(
      'retrieve',
      retrieveVectors,
      'Retrieve agent knowledge vectors by table with optional similarity search'
    ));

    // Search alias - maps to retrieveVectors for LLM compatibility
    functions.set('search', createDataIntegration(
      'search',
      retrieveVectors,
      'Search knowledge base using similarity search (alias for retrieve)'
    ));

    // Content search - for exact text matching
    functions.set('searchContent', createDataIntegration(
      'searchContent',
      searchContent,
      'Search content by exact phrase matching across chunks'
    ));

    // Legacy function names for backward compatibility
    functions.set('knowledge.retrieve', createDataIntegration(
      'knowledge.retrieve',
      retrieveVectors,
      'Retrieve agent knowledge vectors by table'
    ));

    functions.set('knowledge.search', createDataIntegration(
      'knowledge.search',
      retrieveVectors,
      'Search knowledge base using similarity search (legacy alias)'
    ));

    functions.set('knowledge.inspect', createDataIntegration(
      'knowledge.inspect',
      inspectTable,
      'Inspect knowledge table stats'
    ));

    functions.set('knowledge.getChunk', createDataIntegration(
      'knowledge.getChunk',
      getChunk,
      'Get vectors for a specific chunk index'
    ));

    functions.set('knowledge.searchContent', createDataIntegration(
      'knowledge.searchContent',
      searchContent,
      'Search content by phrase and list matching chunks'
    ));

    return {
      name: 'agent_knowledge',
      functions
    };
  }
};


