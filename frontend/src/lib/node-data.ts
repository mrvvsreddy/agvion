// Node data registry for workflow nodes
export interface NodeDefinition {
  id: string;
  integrationId: string;
  name: string;
  type: "trigger" | "action";
  category?: string;
  icon?: string;
  description?: string;
  parameters?: Array<{
    name: string;
    label: string;
    type: string;
    required?: boolean;
    default?: any;
    description?: string;
  }>;
}

// Mock node data registry
const nodeRegistry: Record<string, Record<string, NodeDefinition>> = {
  core: {
    start: {
      id: "start",
      integrationId: "core",
      name: "Start",
      type: "trigger",
      category: "Core",
      icon: "▶️",
      description: "Trigger point for the workflow",
    },
    agent: {
      id: "agent",
      integrationId: "core",
      name: "AI Agent",
      type: "action",
      category: "Core",
      icon: "🤖",
      description: "AI-powered agent action",
      parameters: [
        {
          name: "prompt",
          label: "Prompt",
          type: "textarea",
          required: true,
          description: "The prompt for the AI agent",
        },
        {
          name: "model",
          label: "Model",
          type: "select",
          default: "gpt-4",
          description: "AI model to use",
        },
      ],
    },
  },
  http: {
    request: {
      id: "request",
      integrationId: "http",
      name: "HTTP Request",
      type: "action",
      icon: "🌐",
      description: "Make an HTTP request",
      parameters: [
        {
          name: "url",
          label: "URL",
          type: "text",
          required: true,
          description: "The URL to request",
        },
        {
          name: "method",
          label: "Method",
          type: "select",
          default: "GET",
          description: "HTTP method",
        },
      ],
    },
  },
  data: {
    transform: {
      id: "transform",
      integrationId: "data",
      name: "Transform Data",
      type: "action",
      icon: "🔄",
      description: "Transform and manipulate data",
      parameters: [
        {
          name: "expression",
          label: "Expression",
          type: "textarea",
          required: true,
          description: "JavaScript expression to transform data",
        },
      ],
    },
  },
};

export function getNodeData(integrationId: string, nodeId: string): NodeDefinition | null {
  const integration = nodeRegistry[integrationId];
  if (!integration) return null;
  return integration[nodeId] || null;
}

export function getAllNodes(): NodeDefinition[] {
  const allNodes: NodeDefinition[] = [];
  Object.values(nodeRegistry).forEach((integration) => {
    Object.values(integration).forEach((node) => {
      allNodes.push(node);
    });
  });
  return allNodes;
}
