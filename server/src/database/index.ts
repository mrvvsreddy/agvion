// database/index.ts
export { default as SupabaseService } from './config/supabase';
export type { Database } from './config/supabase';

// Base Repository
export { BaseRepository } from './repositories/BaseRepository';
export type { PaginationOptions, PaginatedResult } from './repositories/BaseRepository';

// Repositories
export { default as TenantsRepository } from './repositories/TenantsRepository';
export { TenantsRepository as TenantsRepositoryClass } from './repositories/TenantsRepository';

// Conversation Repositories
export { default as ConversationsRepository } from './repositories/ConversationsRepository';
export { default as MessagesRepository } from './repositories/MessagesRepository';
export type { 
  Conversation, 
  CreateConversationData, 
  UpdateConversationData,
  ConversationFilters 
} from './repositories/ConversationsRepository';
export type { 
  Message, 
  CreateMessageData, 
  UpdateMessageData,
  MessageFilters 
} from './repositories/MessagesRepository';

// Services
export { default as ConversationService } from './services/ConversationService';
export type { 
  ConversationWithMessages,
  ConversationSummary,
  CreateConversationWithMessageData,
  ConversationStats,
  ConversationSearchOptions
} from './services/ConversationService';

// Database Service
export { default as DatabaseService } from './DatabaseService';