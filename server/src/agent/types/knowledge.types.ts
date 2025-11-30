// agent/types/knowledge.types.ts

/**
 * Document stored in agent_table_rows
 */
export interface KnowledgeDocument {
  id: string;
  table_id: string;
  agent_id: string;
  row_data: {
    file_name: string;
    file_type: '.pdf' | '.doc' | '.docx' | '.html' | '.txt' | '.md' | '.markdown';
    original_content: string;  // Full extracted text for editing
    content_length: number;
    chunk_count: number;
    is_editable: boolean;
    processed_at: string;
    metadata: {
      sizeBytes: number;
      pageCount?: number;
      wordCount?: number;
      extractionMethod: 'pdf' | 'docx' | 'html' | 'text' | 'markdown' | 'fallback';
      // Backward compatibility marker
      type?: 'knowledge_file';
    };
  };
  created_at: string;
  updated_at: string;
}

/**
 * Chunk stored in agent_vector_data
 */
export interface VectorChunk {
  id: string;
  tenant_id: string;
  agent_id: string;
  table_id: string;
  parent_file_id: string;  // Links to agent_table_rows.id
  file_name: string;        // Denormalized for fast filtering
  file_type: string;        // Denormalized for filtering
  chunk_index: number;
  content: string;          // Chunk text
  embedding: number[] | null;      // 1024-dimensional vector (nullable if embeddings disabled)
  is_active: boolean;       // Soft delete support
  metadata: {
    fileName: string;       // Keep for backward compatibility
    fileType: string;
    chunkIndex: number;
    totalChunks?: number;
    editedAt?: string;
  };
  created_at: string;
  updated_at: string;
}

/**
 * Search result with similarity score
 */
export interface SearchResult {
  chunk_id: string;
  chunk_text: string;
  similarity: number;
  file_id: string;
  file_name: string;
  file_type: string;
  chunk_index: number;
  metadata: Record<string, any>;
}


