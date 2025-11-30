// path: src/integrations/agent_knowledge/__tests__/agent_knowledge.search.test.ts

import integration from '../index';
import { IntegrationExecutor } from '../../../types/integrations';

// Reuse and adapt mocks from integration test by re-mocking supabase
jest.mock('../../../database/config/supabase', () => {
  const rows = [
    {
      id: 'row-1',
      tenant_id: 'tenantA12345',
      agent_id: 'whatsappagent',
      chunk_index: 0,
      content: '... WhatsApp Business Automation ...',
      embedding: [0.1, -0.2, 0.3],
      metadata: {},
      created_at: '2025-10-01T14:46:53.084Z',
      updated_at: '2025-10-01T14:46:53.084Z',
      table_id: '4c8b0c44-102c-4c1e-8857-33d5ff90e649'
    },
    {
      id: 'row-2',
      tenant_id: 'tenantA12345',
      agent_id: 'whatsappagent',
      chunk_index: 1,
      content: 'Services include WhatsApp Business Automation and more.',
      embedding: [0.2, -0.1, 0.05],
      metadata: {},
      created_at: '2025-10-01T14:47:00.000Z',
      updated_at: '2025-10-01T14:47:00.000Z',
      table_id: '4c8b0c44-102c-4c1e-8857-33d5ff90e649'
    }
  ];

  const table = {
    id: '4c8b0c44-102c-4c1e-8857-33d5ff90e649',
    agent_id: 'whatsappagent',
    table_name: 'mywebsitedata',
    description: null,
    columns: {},
    created_at: '2025-10-01T14:46:00.000Z',
    updated_at: '2025-10-01T14:46:00.000Z'
  };

  const mockFrom = (tableName: string) => {
    const state: any = { selectFields: '*', opts: {} };
    const api: any = {
      select(sel?: any) { state.selectFields = sel || '*'; return this; },
      eq() { return this; },
      ilike(col?: string, pattern?: string) {
        // Return filtered rows containing WhatsApp phrase
        const phrase = String(pattern || '').replace(/%/g, '').toLowerCase();
        const data = rows.filter(r => r.content.toLowerCase().includes(phrase));
        return {
          order: () => ({ limit: () => Promise.resolve({ data, error: null }) })
        } as any;
      },
      maybeSingle() { return Promise.resolve({ data: table, error: null }); }
    };
    return api;
  };

  const client = { from: mockFrom } as any;

  return {
    __esModule: true,
    default: class {
      static instance: any;
      static getInstance() { return this.instance ?? (this.instance = new this()); }
      getClient() { return client; }
    }
  };
});

jest.mock('../../../database/repositories/AgentTablesColumnsRepository', () => ({
  __esModule: true,
  default: new (class { async findByAgentAndName() { return { id: '4c8b0c44-102c-4c1e-8857-33d5ff90e649', table_name: 'mywebsitedata', columns: {} }; } })(),
  AgentTablesRepository: class {}
}));

const baseContext = {
  executionId: 'exec-2',
  agentId: 'whatsappagent',
  workflowId: 'wf-1',
  variables: {},
  stepResults: {}
};

describe('agent_knowledge searchContent', () => {
  const integ = integration.register();

  test('finds all chunks related to WhatsApp Business Automation', async () => {
    const entry = integ.functions.get('knowledge.searchContent')!;
    const updated = await IntegrationExecutor.execute(entry, baseContext as any, {
      agentId: 'whatsappagent',
      tenantId: 'tenantA12345',
      tableId: '4c8b0c44-102c-4c1e-8857-33d5ff90e649',
      query: 'WhatsApp Business Automation'
    });
    const step = (updated.stepResults as any)['knowledge.searchContent'];
    expect(step.json.success).toBe(true);
    expect(step.json.chunkIndexes).toEqual([0, 1]);
    expect(step.json.rows.length).toBe(2);
  });
});


