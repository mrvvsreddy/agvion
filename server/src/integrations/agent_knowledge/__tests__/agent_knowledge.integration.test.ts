// path: src/integrations/agent_knowledge/__tests__/agent_knowledge.integration.test.ts

import integration from '../index';
import { IntegrationExecutor } from '../../../types/integrations';

// Mocks
jest.mock('../../../database/config/supabase', () => {
  const rows = [
    {
      id: '41ffd04d-7cc4-4036-b746-e5dc6cef5c63',
      tenant_id: 'tenantA12345',
      agent_id: 'whatsappagent',
      chunk_index: 0,
      content: 'A.G.V.I.O.N ...',
      embedding: [0.1, -0.2, 0.3],
      metadata: {
        filename: 'document.txt',
        table_name: 'mywebsitedata',
        chunk_number: 1,
        total_chunks: 20
      },
      created_at: '2025-10-01T14:46:53.084Z',
      updated_at: '2025-10-01T14:46:53.084Z',
      table_id: '4c8b0c44-102c-4c1e-8857-33d5ff90e649'
    }
  ];
  // Add a second matching row for search coverage
  rows.push({
    id: 'row-2',
    tenant_id: 'tenantA12345',
    agent_id: 'whatsappagent',
    chunk_index: 1,
    content: 'Services include WhatsApp Business Automation and more.',
    embedding: [0.2, -0.1, 0.05],
    metadata: { filename: 'document.txt', table_name: 'mywebsitedata', chunk_number: 2, total_chunks: 20 },
    created_at: '2025-10-01T14:47:00.000Z',
    updated_at: '2025-10-01T14:47:00.000Z',
    table_id: '4c8b0c44-102c-4c1e-8857-33d5ff90e649'
  });

  const table = {
    id: '4c8b0c44-102c-4c1e-8857-33d5ff90e649',
    agent_id: 'whatsappagent',
    table_name: 'mywebsitedata',
    description: null,
    columns: { content: 'text', embedding: 'vector', metadata: 'jsonb' },
    created_at: '2025-10-01T14:46:00.000Z',
    updated_at: '2025-10-01T14:46:00.000Z'
  };

  // Minimal client chainable API mock
  const mockFrom = (tableName: string) => {
    // Simple chain state
    const state: any = { opts: {}, filters: [] };

    const terminalOk = () => ({ data: rows, error: null });
    const terminalCount = () => ({ count: rows.length, error: null });

    const api: any = {
      select(_sel?: any, opts?: any) {
        state.opts = opts || {};
        state.selectFields = _sel;
        // For head count path, allow continuing the chain to .eq(...)
        return this;
      },
      eq(col?: string, val?: any) {
        // If in head count mode, return a promise resolving to count
        if (state.opts && state.opts.head) {
          return Promise.resolve(terminalCount());
        }
        state.filters.push(['eq', [col, val]]);
        // For simple select of chunk_index, return rows immediately
        if (tableName === 'agent_vector_data' && state.selectFields === 'chunk_index') {
          return Promise.resolve({ data: rows.map(r => ({ chunk_index: r.chunk_index })), error: null });
        }
        return this;
      },
      ilike(col?: string, pattern?: string) {
        state.filters.push(['ilike', [col, pattern]]);
        return this;
      },
      order() { return this; },
      range() { return Promise.resolve(terminalOk()); },
      limit() { 
        // In inspectTable path we select 'updated_at' then limit(1).maybeSingle()
        if (state.selectFields === 'updated_at') {
          return this;
        }
        // Otherwise behave as terminal returning rows (used by getChunk)
        return Promise.resolve(terminalOk());
      },
      maybeSingle() {
        if (tableName === 'agent_tables') {
          return Promise.resolve({ data: table, error: null });
        }
        return Promise.resolve({ data: rows[0], error: null });
      },
      single() { return Promise.resolve({ data: table, error: null }); }
    };

    return api;
  };

  const client = { from: mockFrom };

  return {
    __esModule: true,
    default: class {
      static instance: any;
      static getInstance() { return this.instance ?? (this.instance = new this()); }
      getClient() { return client as any; }
    }
  };
});

// Mock repositories to use the Supabase client paths rather than own logic
jest.mock('../../../database/repositories/AgentTablesColumnsRepository', () => ({
  __esModule: true,
  default: new (class { async findByAgentAndName() { return { id: '4c8...', table_name: 'mywebsitedata', columns: {} }; } })(),
  AgentTablesRepository: class {}
}));

jest.mock('../../../database/repositories/AgentVectorDataRepository', () => ({
  __esModule: true,
  default: new (class { async findByTable() { return { data: [{}], totalCount: 1, page: 1, limit: 50, totalPages: 1 }; } })(),
  AgentVectorDataRepository: class {}
}));

const baseContext = {
  executionId: 'exec-1',
  agentId: 'whatsappagent',
  workflowId: 'wf-1',
  variables: {},
  stepResults: {}
};

describe('agent_knowledge integration', () => {
  const integ = integration.register();

  test('knowledge.retrieve returns rows with pagination', async () => {
    const entry = integ.functions.get('knowledge.retrieve')!;
    const updated = await IntegrationExecutor.execute(entry, baseContext as any, {
      agentId: 'whatsappagent',
      tenantId: 'tenantA12345',
      tableId: '4c8b0c44-102c-4c1e-8857-33d5ff90e649',
      page: 1,
      limit: 50
    });
    const step = (updated.stepResults as any)['knowledge.retrieve'];
    expect(step.json.success).toBe(true);
    expect(step.json.pagination.totalCount).toBeGreaterThanOrEqual(1);
  });

  test('knowledge.inspect returns stats', async () => {
    const entry = integ.functions.get('knowledge.inspect')!;
    const updated = await IntegrationExecutor.execute(entry, baseContext as any, {
      agentId: 'whatsappagent',
      tenantId: 'tenantA12345',
      tableId: '4c8b0c44-102c-4c1e-8857-33d5ff90e649'
    });
    const step = (updated.stepResults as any)['knowledge.inspect'];
    expect(step.json.stats.totalVectors).toBeGreaterThanOrEqual(1);
    expect(step.json.stats.distinctChunks).toBeGreaterThanOrEqual(1);
  });

  test('knowledge.getChunk returns rows for a chunk', async () => {
    const entry = integ.functions.get('knowledge.getChunk')!;
    const updated = await IntegrationExecutor.execute(entry, baseContext as any, {
      agentId: 'whatsappagent',
      tenantId: 'tenantA12345',
      tableId: '4c8b0c44-102c-4c1e-8857-33d5ff90e649',
      chunkIndex: 0
    });
    const step = (updated.stepResults as any)['knowledge.getChunk'];
    expect(step.json.rows.length).toBeGreaterThanOrEqual(1);
  });
});


