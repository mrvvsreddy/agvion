// agent/services/AgentContextLoader.ts
import AgentFlowsRepository from '../../database/repositories/AgentFlowsRepository';
import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 60 });

export interface AgentContext {
  agentId: string;
  workflow: any;
  knowledgeTables: any;
}

export async function loadAgentContext(agentId: string): Promise<AgentContext> {
  // Check cache first
  const cached = cache.get<AgentContext>(agentId);
  if (cached) {
    return cached;
  }

  // Load from database
  const flow = await AgentFlowsRepository.getDefaultActiveFlow(agentId);

  if (!flow) {
    throw new Error(`No active flow found for agent ${agentId}`);
  }

  // Parse workflow_data
  const workflow = typeof flow.workflow_data === 'string'
    ? JSON.parse(flow.workflow_data)
    : flow.workflow_data;

  // Knowledge is now used as a tool inside the AI node (agent_knowledge.retrieve)
  // and not maintained as a separate array; keep the field for compatibility.
  const knowledgeTables = null;

  const context: AgentContext = {
    agentId,
    workflow,
    knowledgeTables
  };

  // Cache the result
  cache.set(agentId, context);

  return context;
}

