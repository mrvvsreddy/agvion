// path: src/scripts/agentKnowledgeSearch.ts

import agentKnowledge from '../integrations/agent_knowledge';
import { IntegrationExecutor } from '../types/integrations';

function getArg(name: string, fallback?: string): string | undefined {
  const eqPref = `--${name}=`;
  for (let i = 0; i < process.argv.length; i++) {
    const a = process.argv[i] ?? '';
    if (a.startsWith(eqPref)) {
      return a.slice(eqPref.length);
    }
    if (a === `--${name}` && i + 1 < process.argv.length) {
      const val = process.argv[i + 1] ?? '';
      if (!val.startsWith('--')) return val;
    }
  }
  return fallback;
}

async function main() {
  let agentId: string = getArg('agentId') || process.env.AGENT_ID || '';
  let tenantId: string = getArg('tenantId') || process.env.TENANT_ID || '';
  let tableId: string | undefined = getArg('tableId') || process.env.TABLE_ID;
  let tableName: string | undefined = getArg('tableName') || process.env.TABLE_NAME;
  let query: string = getArg('query') || process.env.QUERY || 'WhatsApp Business Automation';

  // Positional fallback: script agentId tenantId tableIdOrName query...
  const extra = process.argv.slice(2).filter(a => typeof a === 'string' && !a.startsWith('--')) as string[];
  if ((!agentId || !tenantId || (!tableId && !tableName)) && extra.length >= 3) {
    const posAgent = extra[0] || '';
    const posTenant = extra[1] || '';
    const posTable = extra[2] || '';
    const posQuery = extra.slice(3);
    if (!agentId && posAgent) agentId = posAgent;
    if (!tenantId && posTenant) tenantId = posTenant;
    const candidate = posTable || '';
    if (!tableId && !tableName && candidate && candidate !== '***') {
      if (/^[0-9a-fA-F-]{20,}$/.test(candidate)) tableId = candidate; else tableName = candidate;
    }
    if (!query && posQuery.length > 0) query = posQuery.join(' ');
  }

  if (!agentId || !tenantId || (!tableId && !tableName)) {
    console.error('Usage: ts-node src/scripts/agentKnowledgeSearch.ts --agentId AGENT --tenantId TENANT (--tableId TABLE_ID | --tableName NAME) --query "phrase"');
    console.error('Or set env vars: AGENT_ID, TENANT_ID and TABLE_ID or TABLE_NAME, QUERY');
    process.exit(1);
  }

  const integration = agentKnowledge.register();
  const entry = integration.functions.get('knowledge.searchContent');
  if (!entry) {
    throw new Error('knowledge.searchContent function not found');
  }

  const context = {
    executionId: `exec-${Date.now()}`,
    agentId,
    workflowId: 'manual',
    variables: {},
    stepResults: {}
  };

  const resultCtx = await IntegrationExecutor.execute(entry, context as any, {
    agentId,
    tenantId,
    tableId,
    tableName,
    query,
    limit: Number(getArg('limit') || 1000)
  });

  const step = (resultCtx.stepResults as any)['knowledge.searchContent'];
  console.log(JSON.stringify(step.json, null, 2));
}

main().catch(err => {
  console.error('Search failed:', err?.message || err);
  process.exit(1);
});


