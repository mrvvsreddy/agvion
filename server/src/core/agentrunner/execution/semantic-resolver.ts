
import logger from '../../../utils/logger';
import { 
  GraphNode,
  ResolvedNodeInputs
} from './types';
import { TypeSafeExecutionContext } from './node-data-manager';

// Universal data reference patterns - supporting multiple formats
const UNIVERSAL_REFERENCE_PATTERNS = {
  // Standard semantic references
  JSON_DOT: /^\$json\.([^.]+)\.([^.]+)$/,
  JSON_DOT_PATH: /^\$json\.([^.]+)\.([^.]+)\.(.+)$/,
  // Bracketed node name: $json.[Node Name].field
  JSON_BRACKET_NODE_DOT: /^\$json\.\[([^\]]+)\]\.([^.]+)$/,
  JSON_BRACKET_NODE_PATH: /^\$json\.\[([^\]]+)\]\.([^.]+)\.(.+)$/,
  // Mixed array+dot notation: $json["Node"].field
  JSON_ARRAY_MIXED: /^\$json\[["']([^"']+)["']\]\.([^.]+)$/,
  
  // Missing $ prefix variations
  JSON_DOT_NO_PREFIX: /^json\.([^.]+)\.([^.]+)$/,
  JSON_DOT_PATH_NO_PREFIX: /^json\.([^.]+)\.([^.]+)\.(.+)$/,
  
  // Array notation
  JSON_ARRAY: /^\$json\[["']([^"']+)["']\]\[["']([^"']+)["']\]$/,
  JSON_ARRAY_PATH: /^\$json\[["']([^"']+)["']\]\[["']([^"']+)["']\]\[["']([^"']+)["']\]$/,
  
  // Template notation
  TEMPLATE_DOT: /^\{\{([^.]+)\.([^.]+)\}\}$/,
  TEMPLATE_PATH: /^\{\{([^.]+)\.([^.]+)\.([^.]+)\}\}$/,
  // Template with explicit json prefix
  TEMPLATE_JSON_DOT: /^\{\{\s*json\.([^.]+)\.([^.]+)\s*\}\}$/,
  TEMPLATE_JSON_PATH: /^\{\{\s*json\.([^.]+)\.([^.]+)\.([^.]+)\s*\}\}$/,
  TEMPLATE_JSON_ARRAY_MIXED: /^\{\{\s*json\[["']([^"']+)["']\]\.([^.]+)\s*\}\}$/,
  TEMPLATE_JSON_ARRAY_BOTH: /^\{\{\s*json\[["']([^"']+)["']\]\[["']([^"']+)["']\]\s*\}\}$/,
  // Template with explicit $json prefix
  TEMPLATE_DOLLAR_JSON_DOT: /^\{\{\s*\$json\.([^.]+)\.([^.]+)\s*\}\}$/,
  TEMPLATE_DOLLAR_JSON_PATH: /^\{\{\s*\$json\.([^.]+)\.([^.]+)\.([^.]+)\s*\}\}$/,
  TEMPLATE_DOLLAR_JSON_ARRAY_MIXED: /^\{\{\s*\$json\[["']([^"']+)["']\]\.([^.]+)\s*\}\}$/,
  TEMPLATE_DOLLAR_JSON_ARRAY_BOTH: /^\{\{\s*\$json\[["']([^"']+)["']\]\[["']([^"']+)["']\]\s*\}\}$/,
  // Template with explicit $json and bracketed node name: {{$json.[Node Name].field}}
  TEMPLATE_DOLLAR_JSON_BRACKET_NODE_DOT: /^\{\{\s*\$json\.\[([^\]]+)\]\.([^.]+)\s*\}\}$/,
  TEMPLATE_DOLLAR_JSON_BRACKET_NODE_PATH: /^\{\{\s*\$json\.\[([^\]]+)\]\.([^.]+)\.(.+)\s*\}\}$/,
  
  // Variable notation
  VARIABLE_DOT: /^\$([^.]+)\.([^.]+)$/,
  VARIABLE_PATH: /^\$([^.]+)\.([^.]+)\.([^.]+)$/,
  
  // Legacy formats
  LEGACY_DOT: /^([^.]+)\.([^.]+)$/,
  LEGACY_PATH: /^([^.]+)\.([^.]+)\.([^.]+)$/,
} as const;

// Enhanced pattern detection for smart reference identification
const SMART_REFERENCE_INDICATORS = {
  // Fields that commonly expect dynamic data
  DYNAMIC_FIELDS: [
    'message', 'text', 'content', 'body', 'recipient', 'sender', 'email', 'phone',
    'name', 'title', 'description', 'url', 'link', 'file', 'attachment', 'data',
    'input', 'output', 'result', 'response', 'value', 'query', 'search', 'filter'
  ],
  
  // Patterns that suggest data references
  REFERENCE_PATTERNS: [
    /^[a-zA-Z][a-zA-Z0-9_-]*\.[a-zA-Z][a-zA-Z0-9_-]*$/, // node.field
    /^[a-zA-Z][a-zA-Z0-9_-]*\.[a-zA-Z][a-zA-Z0-9_-]*\.[a-zA-Z][a-zA-Z0-9_-]*$/, // node.field.subfield
    /^json\.[a-zA-Z][a-zA-Z0-9_-]*\.[a-zA-Z][a-zA-Z0-9_-]*$/, // json.node.field
    /^\$[a-zA-Z][a-zA-Z0-9_-]*\.[a-zA-Z][a-zA-Z0-9_-]*$/, // $node.field
  ]
};

interface PathNavigationResult<T = unknown> {
  readonly success: boolean;
  readonly value: T | null;
  readonly error?: string;
}

// Enhanced resolution context for tracking resolution depth and circular references
interface ResolutionContext {
  readonly depth: number;
  readonly maxDepth: number;
  readonly resolvedReferences: Set<string>;
  readonly executionContext: TypeSafeExecutionContext;
  readonly fieldContext?: string; // Field name for context-aware resolution
}

/**
 * Check if a string is a tool name reference (integration.function format)
 * These should NOT be processed as semantic references
 */
function isToolNameReference(value: string): boolean {
  if (typeof value !== 'string') return false;

  // Known integrations to improve accuracy
  const knownIntegrations = [
    'agent-memory', 'openai', 'whatsapp', 'webhook'
  ];

  const toolNamePattern = /^[a-zA-Z][a-zA-Z0-9_-]*\.[a-zA-Z][a-zA-Z0-9_-]*$/;

  if (toolNamePattern.test(value)) {
    const parts = value.split('.');
    if (parts.length === 2) {
      const integration = parts[0] ?? '';
      const func = parts[1] ?? '';

      // If integration is known, treat as tool
      if (knownIntegrations.includes(integration)) {
        return true;
      }

      // Additional sanity checks
      if (
        integration && func &&
        integration.length > 0 && integration.length <= 50 &&
        func.length > 0 && func.length <= 50
      ) {
        return true;
      }
    }
  }

  return false;
}

// Enhanced semantic reference detection
const isSemanticReference = (value: string): boolean => {
  if (typeof value !== 'string') return false;

  // IMPORTANT: Tool names should NEVER be processed as semantic references
  if (isToolNameReference(value)) {
    logger.debug('Skipping tool name reference', { value });
    return false;
  }

  // Check all universal patterns
  for (const [name, pattern] of Object.entries(UNIVERSAL_REFERENCE_PATTERNS)) {
    if (pattern.test(value)) {
      logger.debug('Semantic reference detected', { value, pattern: name });
      return true;
    }
  }

  // Check smart indicators for context-aware detection
  const smart = isSmartReference(value);
  if (smart) {
    logger.debug('Smart semantic reference detected', { value });
  }
  return smart;
};

// Smart reference detection based on context and patterns
function isSmartReference(value: string, fieldContext?: string): boolean {
  if (typeof value !== 'string') return false;
  
  // If field context suggests dynamic data, be more aggressive
  if (fieldContext && SMART_REFERENCE_INDICATORS.DYNAMIC_FIELDS.some(field => 
    fieldContext.toLowerCase().includes(field.toLowerCase())
  )) {
    return SMART_REFERENCE_INDICATORS.REFERENCE_PATTERNS.some(pattern => pattern.test(value));
  }
  
  // Default to conservative detection
  return value.startsWith('$json.') || value.startsWith('json.') || value.startsWith('{{') || value.startsWith('$');
}

// Deep resolution of semantic references with proper recursion handling
async function deepResolveSemanticReferences(
  config: unknown,
  resolutionContext: ResolutionContext
): Promise<unknown> {
  if (resolutionContext.depth >= resolutionContext.maxDepth) {
    logger.warn('Maximum resolution depth reached', {
      executionId: resolutionContext.executionContext.executionId,
      depth: resolutionContext.depth,
      maxDepth: resolutionContext.maxDepth
    });
    return config;
  }

  const newContext: ResolutionContext = {
    ...resolutionContext,
    depth: resolutionContext.depth + 1
  };

  if (typeof config === 'string') {
    return resolveUniversalExpression(config, resolutionContext.executionContext);
  } 

  if (Array.isArray(config)) {
    // Special handling for tool arrays - don't process tool names as semantic references
    if (resolutionContext.fieldContext === 'tools') {
      logger.debug('Skipping semantic resolution for tools array', {
        executionId: resolutionContext.executionContext.executionId,
        toolsCount: config.length
      });
      return config; // Return tools array unchanged
    }
    
    const resolvedArray: unknown[] = [];
    for (const item of config) {
      const resolvedItem = await deepResolveSemanticReferences(item, newContext);
      resolvedArray.push(resolvedItem);
    }
    return resolvedArray;
  } 

  if (config && typeof config === 'object' && config !== null) {
    const resolvedObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      // Pass field context for smart resolution
      const fieldContext: ResolutionContext = {
        ...newContext,
        fieldContext: key
      };
      
      const resolvedValue = await deepResolveSemanticReferences(value, fieldContext);
      resolvedObj[key] = resolvedValue;
    }
    return resolvedObj;
  }

  return config;
}

/**
 * Universal expression resolution supporting multiple query formats
 * If the entire expression is a single reference, return the RAW value (object/array/number/boolean/string).
 * If the expression mixes text with references, return a string with interpolated values.
 */
function resolveUniversalExpression(
  expression: string,
  context: TypeSafeExecutionContext
): unknown {
  try {
    let resolvedExpression: unknown = expression;
    
    // Track resolution statistics for debugging
    let resolutionsCount = 0;
    const originalExpression = expression;

    // Local helper to apply a pattern and count matches consistently
    const applyPattern = (
      expr: string,
      pattern: RegExp,
      resolver: (match: string, ...groups: string[]) => string,
      patternName: string
    ): string => {
      let count = 0;
      const replaced = expr.replace(pattern, (match, ...groups) => {
        try {
          count++;
          const resolved = resolver(match, ...(groups as string[]));
          logger.debug(`Pattern ${patternName} resolved`, {
            match,
            resolved,
            groups
          });
          return resolved;
        } catch (error) {
          logger.warn(`Failed to resolve pattern ${patternName}`, {
            match,
            error: error instanceof Error ? error.message : String(error)
          });
          return match;
        }
      });
      if (count > 0) {
        resolutionsCount += count;
      }
      return replaced;
    };

    // Helper to fetch raw node.field value
    const getRaw = (nodeName?: string, fieldName?: string): unknown => {
      if (!nodeName || !fieldName) {
        return `$json.${nodeName ?? 'unknown'}.${fieldName ?? 'unknown'}`;
      }
      const raw = getNodeFieldRaw(context, nodeName, fieldName);
      if (raw === undefined) {
        // Keep unresolved as original token to be detected by caller
        return `$json.${nodeName}.${fieldName}`;
      }
      return raw;
    };

    // 1) If expression is EXACTLY one of the supported single-reference patterns, return RAW value
    const singleRefMatchers: Array<[RegExp, (m: RegExpMatchArray) => unknown]> = [
      [UNIVERSAL_REFERENCE_PATTERNS.JSON_DOT, (m) => getRaw(m[1] as string, m[2] as string)],
      [UNIVERSAL_REFERENCE_PATTERNS.JSON_DOT_NO_PREFIX, (m) => getRaw(m[1] as string, m[2] as string)],
      [UNIVERSAL_REFERENCE_PATTERNS.JSON_BRACKET_NODE_DOT, (m) => getRaw(m[1] as string, m[2] as string)],
      [UNIVERSAL_REFERENCE_PATTERNS.JSON_ARRAY_MIXED, (m) => getRaw(m[1] as string, m[2] as string)],
      [UNIVERSAL_REFERENCE_PATTERNS.VARIABLE_DOT, (m) => getRaw(m[1] as string, m[2] as string)],
      [UNIVERSAL_REFERENCE_PATTERNS.LEGACY_DOT, (m) => getRaw(m[1] as string, m[2] as string)],
      [UNIVERSAL_REFERENCE_PATTERNS.TEMPLATE_DOT, (m) => getRaw(m[1] as string, m[2] as string)],
      [UNIVERSAL_REFERENCE_PATTERNS.TEMPLATE_JSON_DOT, (m) => getRaw(m[1] as string, m[2] as string)],
      [UNIVERSAL_REFERENCE_PATTERNS.TEMPLATE_DOLLAR_JSON_BRACKET_NODE_DOT, (m) => getRaw(m[1] as string, m[2] as string)],
      [UNIVERSAL_REFERENCE_PATTERNS.TEMPLATE_JSON_ARRAY_MIXED, (m) => getRaw(m[1] as string, m[2] as string)],
      [UNIVERSAL_REFERENCE_PATTERNS.TEMPLATE_JSON_ARRAY_BOTH, (m) => getRaw(m[1] as string, m[2] as string)],
      [UNIVERSAL_REFERENCE_PATTERNS.TEMPLATE_DOLLAR_JSON_DOT, (m) => getRaw(m[1] as string, m[2] as string)],
      [UNIVERSAL_REFERENCE_PATTERNS.TEMPLATE_DOLLAR_JSON_ARRAY_MIXED, (m) => getRaw(m[1] as string, m[2] as string)],
      [UNIVERSAL_REFERENCE_PATTERNS.TEMPLATE_DOLLAR_JSON_ARRAY_BOTH, (m) => getRaw(m[1] as string, m[2] as string)],
    ];
    for (const [re, extractor] of singleRefMatchers) {
      const match = originalExpression.match(re);
      if (match && match[0] === originalExpression) {
        const raw = extractor(match);
        resolutionsCount++;
        return raw;
      }
    }

    // Pattern 1: Standard $json.nodeName.field references
    resolvedExpression = applyPattern(
      resolvedExpression as string,
      UNIVERSAL_REFERENCE_PATTERNS.JSON_DOT,
      (match, nodeName, fieldName) => formatResolvedValue(getRaw(nodeName, fieldName)),
      'standard-json-dot'
    );
  // Pattern 1b: Bracketed node name $json.[Node Name].field
  resolvedExpression = applyPattern(
    resolvedExpression as string,
    UNIVERSAL_REFERENCE_PATTERNS.JSON_BRACKET_NODE_DOT,
    (match, nodeName, fieldName) => formatResolvedValue(getRaw(nodeName, fieldName)),
    'json-bracket-node-dot'
  );
    
    // Pattern 2: Missing $ prefix - json.nodeName.field
    resolvedExpression = applyPattern(
      resolvedExpression as string,
      UNIVERSAL_REFERENCE_PATTERNS.JSON_DOT_NO_PREFIX,
      (match, nodeName, fieldName) => formatResolvedValue(getRaw(nodeName, fieldName)),
      'json-dot-no-prefix'
    );
    
    // Pattern 3: Array notation - $json["nodeName"]["fieldName"]
    resolvedExpression = applyPattern(
      resolvedExpression as string,
      UNIVERSAL_REFERENCE_PATTERNS.JSON_ARRAY,
      (match, nodeName, fieldName) => formatResolvedValue(getRaw(nodeName, fieldName)),
      'json-array'
    );
    // Pattern 3b: Mixed array+dot - $json["nodeName"].fieldName
    resolvedExpression = applyPattern(
      resolvedExpression as string,
      UNIVERSAL_REFERENCE_PATTERNS.JSON_ARRAY_MIXED,
      (match, nodeName, fieldName) => formatResolvedValue(getRaw(nodeName, fieldName)),
      'json-array-mixed'
    );
    
    // Pattern 4: Template notation - {{nodeName.fieldName}}
    resolvedExpression = applyPattern(
      resolvedExpression as string,
      UNIVERSAL_REFERENCE_PATTERNS.TEMPLATE_DOT,
      (match, nodeName, fieldName) => formatResolvedValue(getRaw(nodeName, fieldName)),
      'template-dot'
    );
    // Pattern 4b: Template with explicit json prefix - {{json.nodeName.fieldName}}
    resolvedExpression = applyPattern(
      resolvedExpression as string,
      UNIVERSAL_REFERENCE_PATTERNS.TEMPLATE_JSON_DOT,
      (match, nodeName, fieldName) => formatResolvedValue(getRaw(nodeName, fieldName)),
      'template-json-dot'
    );
    // Pattern 4b.2: Template with explicit $json prefix - {{$json.nodeName.fieldName}}
    resolvedExpression = applyPattern(
      resolvedExpression as string,
      UNIVERSAL_REFERENCE_PATTERNS.TEMPLATE_DOLLAR_JSON_DOT,
      (match, nodeName, fieldName) => formatResolvedValue(getRaw(nodeName, fieldName)),
      'template-$json-dot'
    );
  // Pattern 4b.3: Template with explicit $json and bracketed node name - {{$json.[Node Name].fieldName}}
  resolvedExpression = applyPattern(
    resolvedExpression as string,
    UNIVERSAL_REFERENCE_PATTERNS.TEMPLATE_DOLLAR_JSON_BRACKET_NODE_DOT,
    (match, nodeName, fieldName) => formatResolvedValue(getRaw(nodeName, fieldName)),
    'template-$json-bracket-node-dot'
  );
    // Inline bracketed template occurrences within larger strings (dot)
    resolvedExpression = applyPattern(
      resolvedExpression as string,
      /\{\{\s*\$json\.\[([^\]]+)\]\.([^\s.}]+)\s*\}\}/g,
      (match, nodeName, fieldName) => formatResolvedValue(getRaw(nodeName, fieldName)),
      'template-$json-bracket-node-dot-inline'
    );
    // Inline bracketed template occurrences within larger strings (path)
    resolvedExpression = applyPattern(
      resolvedExpression as string,
      /\{\{\s*\$json\.\[([^\]]+)\]\.([^\s.}]+)\.([^\s}]+)\s*\}\}/g,
      (match, nodeName, fieldName, subField) => resolveNodeFieldPath(context, nodeName, fieldName, subField),
      'template-$json-bracket-node-path-inline'
    );
    // Pattern 4c: Template array+dot - {{json["nodeName"].fieldName}}
    resolvedExpression = applyPattern(
      resolvedExpression as string,
      UNIVERSAL_REFERENCE_PATTERNS.TEMPLATE_JSON_ARRAY_MIXED,
      (match, nodeName, fieldName) => formatResolvedValue(getRaw(nodeName, fieldName)),
      'template-json-array-mixed'
    );
    // Pattern 4c.2: Template array+dot with $json - {{$json["nodeName"].fieldName}}
    resolvedExpression = applyPattern(
      resolvedExpression as string,
      UNIVERSAL_REFERENCE_PATTERNS.TEMPLATE_DOLLAR_JSON_ARRAY_MIXED,
      (match, nodeName, fieldName) => formatResolvedValue(getRaw(nodeName, fieldName)),
      'template-$json-array-mixed'
    );
    // Pattern 4d: Template array both - {{json["nodeName"]["fieldName"]}}
    resolvedExpression = applyPattern(
      resolvedExpression as string,
      UNIVERSAL_REFERENCE_PATTERNS.TEMPLATE_JSON_ARRAY_BOTH,
      (match, nodeName, fieldName) => formatResolvedValue(getRaw(nodeName, fieldName)),
      'template-json-array-both'
    );
    // Pattern 4d.2: Template array both with $json - {{$json["nodeName"]["fieldName"]}}
    resolvedExpression = applyPattern(
      resolvedExpression as string,
      UNIVERSAL_REFERENCE_PATTERNS.TEMPLATE_DOLLAR_JSON_ARRAY_BOTH,
      (match, nodeName, fieldName) => formatResolvedValue(getRaw(nodeName, fieldName)),
      'template-$json-array-both'
    );
    
    // Pattern 5: Variable notation - $nodeName.fieldName
    resolvedExpression = applyPattern(
      resolvedExpression as string,
      UNIVERSAL_REFERENCE_PATTERNS.VARIABLE_DOT,
      (match, nodeName, fieldName) => formatResolvedValue(getRaw(nodeName, fieldName)),
      'variable-dot'
    );
    
    // Pattern 6: Legacy notation - nodeName.fieldName (context-aware)
    resolvedExpression = applyPattern(
      resolvedExpression as string,
      UNIVERSAL_REFERENCE_PATTERNS.LEGACY_DOT,
      (match, nodeName, fieldName) => formatResolvedValue(getRaw(nodeName, fieldName)),
      'legacy-dot'
    );
    
    // Handle deeper nested references
    resolvedExpression = resolveDeepReferences(resolvedExpression as string, context);
    
    // Log resolution results
    if (resolvedExpression !== originalExpression) {
      logger.info('Universal expression resolution completed', {
        executionId: context.executionId,
        originalExpression,
        resolvedExpression,
        patternsMatched: resolutionsCount,
        hasChanges: true
      });
    }
    
    // If unresolved tokens remain anywhere, sanitize instead of throwing
    if (typeof resolvedExpression === 'string' && resolvedExpression.includes('$json.')) {
      logger.warn('Unresolved semantic references detected in expression. Sanitizing.', {
        executionId: context.executionId,
        originalExpression
      });
      resolvedExpression = sanitizeUnresolvedString(resolvedExpression);
    }
    
    return resolvedExpression;
    
  } catch (error) {
    logger.error('Failed to resolve universal expression', {
      executionId: context.executionId,
      expression,
      error: error instanceof Error ? error.message : String(error)
    });
    // Return original expression if resolution fails
    return expression;
  }
}

/**
 * Resolve a specific pattern with the given resolver function
 */
function resolvePattern(
  expression: string,
  pattern: RegExp,
  resolver: (match: string, ...groups: string[]) => string,
  patternName: string
): string {
  return expression.replace(pattern, (match, ...groups) => {
    try {
      const resolved = resolver(match, ...groups);
      logger.debug(`Pattern ${patternName} resolved`, {
        match,
        resolved,
        groups
      });
      return resolved;
    } catch (error) {
      logger.warn(`Failed to resolve pattern ${patternName}`, {
        match,
        error: error instanceof Error ? error.message : String(error)
      });
      return match; // Keep original if resolution fails
    }
  });
}

/**
 * Sanitize unresolved placeholders from a string by replacing them with empty strings.
 * Be conservative to avoid over-replacing normal text.
 */
function sanitizeUnresolvedString(input: string): string {
  if (typeof input !== 'string') return input as unknown as string;
  let out = input;
  // Remove template braces like {{...}}
  out = out.replace(/\{\{[^}]+\}\}/g, '');
  // Remove $json.* style tokens (stop at whitespace, quote, or closing brace)
  out = out.replace(/\$json\.[^\s"'\}]+/g, '');
  // Remove bracketed $json.[Node Name].field tokens
  out = out.replace(/\$json\.\[[^\]]+\]\.[^\s"'\}]+/g, '');
  // Also remove bare json.* tokens
  out = out.replace(/\bjson\.[^\s"'\}]+/g, '');
  // Trim and collapse whitespace
  out = out.replace(/\s{2,}/g, ' ').trim();
  return out;
}

/**
 * Recursively sanitize an object/array by replacing unresolved string tokens with empty strings.
 */
function sanitizeUnresolvedInObject(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeUnresolvedString(value);
  }
  if (Array.isArray(value)) {
    return value.map(v => sanitizeUnresolvedInObject(v));
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = sanitizeUnresolvedInObject(v);
    }
    return out;
  }
  return value;
}

/**
 * Resolve deep nested references (e.g., $json.nodeName.field.subfield.deeper)
 */
function resolveDeepReferences(expression: string, context: TypeSafeExecutionContext): string {
  // Handle 3-level deep references
  expression = resolvePattern(
    expression,
    UNIVERSAL_REFERENCE_PATTERNS.JSON_DOT_PATH,
    (match, nodeName, fieldName, subField) => resolveNodeFieldPath(context, nodeName, fieldName, subField),
    'deep-json-dot'
  );
  // Handle 3-level deep references with bracketed node name
  expression = resolvePattern(
    expression,
    UNIVERSAL_REFERENCE_PATTERNS.JSON_BRACKET_NODE_PATH,
    (match, nodeName, fieldName, subField) => resolveNodeFieldPath(context, nodeName, fieldName, subField),
    'deep-json-bracket-node-dot'
  );
  
  // Handle 4-level deep references
  expression = expression.replace(/\$json\.([^.]+)\.([^.]+)\.([^.]+)\.([^.]+)/g, (match, nodeName, fieldName, subField, deepField) => {
    return resolveNodeFieldPath(context, nodeName, fieldName, subField, deepField);
  });
  // Handle inline $json.[Node].field and $json.[Node].field.path inside larger strings
  expression = resolvePattern(
    expression,
    /\$json\.\[([^\]]+)\]\.([^\s.}]+)/g,
    (match, nodeName, fieldName) => resolveNodeField(context, nodeName, fieldName),
    'inline-json-bracket-node-dot'
  );
  expression = resolvePattern(
    expression,
    /\$json\.\[([^\]]+)\]\.([^\s.}]+)\.([^\s}]+)/g,
    (match, nodeName, fieldName, subField) => resolveNodeFieldPath(context, nodeName, fieldName, subField),
    'inline-json-bracket-node-path'
  );
  
  return expression;
}

/**
 * Resolve node field with multiple lookup strategies
 */
function resolveNodeField(context: TypeSafeExecutionContext, nodeName: string, fieldName: string): string {
  // Try multiple strategies to find the node data
  let nodeData: any = null;
  
  // Strategy 1: Direct lookup by node name
  nodeData = context.nodeData[nodeName];
  
  // Strategy 2: Look for node name variations (with spaces, hyphens, etc.)
  if (!nodeData) {
    const normalizedNodeName = nodeName.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const [key, data] of Object.entries(context.nodeData)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normalizedKey === normalizedNodeName) {
        nodeData = data;
        break;
      }
    }
  }
  
  // Strategy 3: Look for partial matches
  if (!nodeData) {
    for (const [key, data] of Object.entries(context.nodeData)) {
      if (key.toLowerCase().includes(nodeName.toLowerCase()) || nodeName.toLowerCase().includes(key.toLowerCase())) {
        logger.debug('Using partial node name match for semantic resolution', {
          executionId: context.executionId,
          requestedNodeName: nodeName,
          matchedNodeName: key,
          fieldName,
          availableFields: data ? Object.keys(data) : []
        });
        nodeData = data;
        break;
      }
    }
  }
  
  // Strategy 4: Check variables.json structure for partial matches
  if (!nodeData) {
    const variables = context.variables as Record<string, unknown>;
    if (variables.json && typeof variables.json === 'object') {
      const jsonData = variables.json as Record<string, unknown>;
      for (const [key, data] of Object.entries(jsonData)) {
        if (key.toLowerCase().includes(nodeName.toLowerCase()) || nodeName.toLowerCase().includes(key.toLowerCase())) {
          logger.debug('Using partial node name match in json for semantic resolution', {
            executionId: context.executionId,
            requestedNodeName: nodeName,
            matchedNodeName: key,
            fieldName,
            availableFields: data ? Object.keys(data as Record<string, unknown>) : []
          });
          nodeData = data;
          break;
        }
      }
    }
  }
  
  if (nodeData && nodeData[fieldName] !== undefined) {
    const value = nodeData[fieldName];
    return formatResolvedValue(value);
  }
  
  // If reference not found, log warning and keep original for debugging
  logger.warn(`Node field reference not resolved: ${nodeName}.${fieldName}`, {
    executionId: context.executionId,
    nodeName,
    fieldName,
    availableNodes: Object.keys(context.nodeData),
    nodeDataKeys: nodeData ? Object.keys(nodeData) : [],
    searchStrategiesUsed: 3
  });
  
  return `$json.${nodeName}.${fieldName}`; // Return standard format for debugging
}

/**
 * Raw resolver that returns the underlying value without string formatting.
 */
function getNodeFieldRaw(context: TypeSafeExecutionContext, nodeName: string, fieldName: string): unknown {
  // Strategy 1: direct
  if (context.nodeData[nodeName] && context.nodeData[nodeName][fieldName] !== undefined) {
    return context.nodeData[nodeName][fieldName];
  }
  // Strategy 1b: fall back across common text aliases when requested field is a text-like field
  if (context.nodeData[nodeName]) {
    const candidate = context.nodeData[nodeName] as Record<string, unknown>;
    const textAliases = ['message', 'text', 'content', 'response', 'output', 'result', 'agentOutput'];
    if (textAliases.includes(fieldName)) {
      for (const key of textAliases) {
        const val = candidate[key];
        if (typeof val === 'string' && val.length > 0) {
          return val;
        }
      }
    }
  }
  // Strategy 2/3 mimic resolveNodeField search
  const normalizedNodeName = nodeName.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const [key, data] of Object.entries(context.nodeData)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalizedKey === normalizedNodeName && (data as any)[fieldName] !== undefined) {
      return (data as any)[fieldName];
    }
  }
  for (const [key, data] of Object.entries(context.nodeData)) {
    if (key.toLowerCase().includes(nodeName.toLowerCase()) || nodeName.toLowerCase().includes(key.toLowerCase())) {
      const record = data as Record<string, unknown>;
      if (record[fieldName] !== undefined) {
        return record[fieldName];
      }
      // Fallback aliasing when field seems text-like
      const textAliases = ['message', 'text', 'content', 'response', 'output', 'result', 'agentOutput'];
      if (textAliases.includes(fieldName)) {
        for (const key2 of textAliases) {
          const val = record[key2];
          if (typeof val === 'string' && val.length > 0) {
            return val;
          }
        }
      }
    }
  }
  return undefined;
}

/**
 * Resolve node field path with nested navigation
 */
function resolveNodeFieldPath(
  context: TypeSafeExecutionContext, 
  nodeName: string, 
  fieldName: string, 
  subField: string,
  deepField?: string
): string {
  const nodeData = resolveNodeField(context, nodeName, fieldName);
  
  // If the first level failed, return the unresolved reference
  if (nodeData.startsWith('$json.')) {
    return nodeData;
  }
  
  try {
    // Parse the resolved value to navigate deeper
    const parsedValue = typeof nodeData === 'string' ? JSON.parse(nodeData) : nodeData;
    
    if (parsedValue && typeof parsedValue === 'object' && parsedValue[subField] !== undefined) {
      const subValue = parsedValue[subField];
      
      if (deepField && typeof subValue === 'object' && subValue[deepField] !== undefined) {
        return formatResolvedValue(subValue[deepField]);
      }
      
      return formatResolvedValue(subValue);
    }
  } catch (error) {
    logger.warn(`Failed to navigate nested path: ${nodeName}.${fieldName}.${subField}`, {
      executionId: context.executionId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
  
  return `$json.${nodeName}.${fieldName}.${subField}`;
}

/**
 * Format resolved value appropriately
 */
function formatResolvedValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  } else if (value === null || value === undefined) {
    return '';
  } else {
    // For objects/arrays, embed as JSON string when interpolating into larger strings
    return JSON.stringify(value);
  }
}

export async function getResolvedNodeInputs(
  node: GraphNode,
  context: TypeSafeExecutionContext
): Promise<ResolvedNodeInputs> {
  const inputs: ResolvedNodeInputs = {};

  if (!node.config || typeof node.config !== 'object') {
    return inputs;
  }

  const resolutionContext: ResolutionContext = {
    depth: 0,
    maxDepth: 10,
    resolvedReferences: new Set(),
    executionContext: context
  };

  const resolvedConfig = await deepResolveSemanticReferences(node.config, resolutionContext);
  inputs.config = (resolvedConfig && typeof resolvedConfig === 'object' && !Array.isArray(resolvedConfig))
    ? resolvedConfig as Record<string, unknown>
    : undefined;
  inputs.dependencies = {};

  const hasUnresolvedReferences = JSON.stringify(inputs.config ?? {}).includes('$json.');
  
  if (hasUnresolvedReferences) {
    logger.warn('Unresolved semantic references in node config - sanitizing instead of aborting', {
      executionId: context.executionId,
      nodeId: node.id
    });
    inputs.config = sanitizeUnresolvedInObject(inputs.config ?? {}) as Record<string, unknown>;
  }

  return inputs;
}

export function resolveSemanticNodeField(
  nodeName: string,
  fieldName: string,
  context: TypeSafeExecutionContext
): unknown {
  const nodeData = context.nodeData[nodeName];
  if (!nodeData || !(fieldName in nodeData)) {
    return null;
  }
  return nodeData[fieldName];
}

export function navigateObjectPath<T = unknown>(
  obj: unknown, 
  path: string
): PathNavigationResult<T> {
  if (!path) {
    return {
      success: true,
      value: obj as T
    };
  }

  if (obj === null || obj === undefined) {
    return {
      success: false,
      value: null,
      error: 'Cannot navigate path on null/undefined object'
    };
  }

  const keys = path.split('.');
  let current: unknown = obj;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!key) {
      continue;
    }
    if (current === null || current === undefined) {
      return {
        success: false,
        value: null,
        error: `Path navigation failed at key '${key}' (step ${i + 1}): current value is null/undefined`
      };
    }
    if (Array.isArray(current) && /^\d+$/.test(key)) {
      const index = parseInt(key, 10);
      if (index >= current.length || index < 0) {
        return {
          success: false,
          value: null,
          error: `Array index ${index} out of bounds (length: ${current.length}) at step ${i + 1}`
        };
      }
      current = current[index];
    } else if (typeof current === 'object' && current !== null) {
      const objCurrent = current as Record<string, unknown>;
      if (!(key in objCurrent)) {
        return {
          success: false,
          value: null,
          error: `Property '${key}' not found at step ${i + 1}. Available properties: [${Object.keys(objCurrent).join(', ')}]`
        };
      }
      current = objCurrent[key];
    } else {
      return {
        success: false,
        value: null,
        error: `Cannot access property '${key}' on non-object value of type '${typeof current}' at step ${i + 1}`
      };
    }
  }
  return {
    success: true,
    value: current as T
  };
}

export function validateSemanticFieldReference(
  reference: string,
  availableNodes: readonly string[] = []
): {
  readonly isValid: boolean;
  readonly referenceType: 'node-field' | 'node-field-path' | 'unknown';
  readonly nodeName?: string;
  readonly fieldName?: string;
  readonly path?: string | undefined;
  readonly errors: readonly string[];
  readonly suggestions: readonly string[];
} {
  const errors: string[] = [];
  const suggestions: string[] = [];

  if (!reference.startsWith('$json.') && !reference.startsWith('json.') && !reference.startsWith('{{') && !reference.startsWith('$')) {
    return {
      isValid: false,
      referenceType: 'unknown',
      errors: ['Reference must use a supported format'],
      suggestions: [
        '$json.nodeName.fieldName',
        'json.nodeName.fieldName',
        '{{nodeName.fieldName}}',
        '$nodeName.fieldName'
      ]
    };
  }

  // Check all universal patterns
  const nodeFieldMatch = reference.match(UNIVERSAL_REFERENCE_PATTERNS.JSON_DOT) ||
                         reference.match(UNIVERSAL_REFERENCE_PATTERNS.JSON_DOT_NO_PREFIX) ||
                         reference.match(UNIVERSAL_REFERENCE_PATTERNS.JSON_BRACKET_NODE_DOT) ||
                         reference.match(UNIVERSAL_REFERENCE_PATTERNS.TEMPLATE_DOT) ||
                         reference.match(UNIVERSAL_REFERENCE_PATTERNS.TEMPLATE_DOLLAR_JSON_BRACKET_NODE_DOT) ||
                         reference.match(UNIVERSAL_REFERENCE_PATTERNS.VARIABLE_DOT) ||
                         reference.match(UNIVERSAL_REFERENCE_PATTERNS.LEGACY_DOT);
                         
  if (nodeFieldMatch) {
    const [, nodeNameRaw, fieldName] = nodeFieldMatch;
    const nodeName = nodeNameRaw ?? '';
    if (availableNodes.length > 0 && nodeName && !availableNodes.includes(nodeName)) {
      errors.push(`Unknown node name: ${nodeName}`);
      suggestions.push(
        ...availableNodes.slice(0, 3).map(node => `$json.${node}.${fieldName}`)
      );
    }
    return {
      isValid: errors.length === 0,
      referenceType: 'node-field',
      nodeName,
      fieldName: fieldName as string,
      path: undefined,
      errors,
      suggestions: suggestions.length > 0 ? suggestions : [
        `$json.${nodeName}.result`,
        `$json.${nodeName}.data`,
        `$json.${nodeName}.output`
      ]
    };
  }

  const nodeFieldPathMatch = reference.match(UNIVERSAL_REFERENCE_PATTERNS.JSON_DOT_PATH) ||
                             reference.match(UNIVERSAL_REFERENCE_PATTERNS.JSON_DOT_PATH_NO_PREFIX) ||
                             reference.match(UNIVERSAL_REFERENCE_PATTERNS.JSON_BRACKET_NODE_PATH) ||
                             reference.match(UNIVERSAL_REFERENCE_PATTERNS.TEMPLATE_PATH) ||
                             reference.match(UNIVERSAL_REFERENCE_PATTERNS.TEMPLATE_DOLLAR_JSON_BRACKET_NODE_PATH) ||
                             reference.match(UNIVERSAL_REFERENCE_PATTERNS.VARIABLE_PATH) ||
                             reference.match(UNIVERSAL_REFERENCE_PATTERNS.LEGACY_PATH);
                             
  if (nodeFieldPathMatch) {
    const [, nodeName, fieldName, path] = nodeFieldPathMatch;
    if (availableNodes.length > 0 && nodeName && !availableNodes.includes(nodeName)) {
      errors.push(`Unknown node name: ${nodeName}`);
      suggestions.push(
        ...availableNodes.slice(0, 3).map(node => `$json.${node}.${fieldName}.${path}`)
      );
    }
    return {
      isValid: errors.length === 0,
      referenceType: 'node-field-path',
      nodeName: nodeName ?? '',
      fieldName: fieldName ?? '',
      path: path ?? undefined,
      errors,
      suggestions
    };
  }

  return {
    isValid: false,
    referenceType: 'unknown',
    errors: ['Unknown reference pattern - only node-based references are supported'],
    suggestions: [
      '$json.nodeName.fieldName',
      'json.nodeName.fieldName',
      '{{nodeName.fieldName}}',
      '$nodeName.fieldName'
    ]
  };
}

export function getAvailableSemanticFields(
  context: TypeSafeExecutionContext
): Record<string, Record<string, string>> {
  const nodeFields: Record<string, Record<string, string>> = {};
  for (const [nodeName, nodeData] of Object.entries(context.nodeData)) {
    nodeFields[nodeName] = {};
    if (nodeData && typeof nodeData === 'object') {
      for (const fieldName of Object.keys(nodeData)) {
        const fieldValue = nodeData[fieldName];
        const fieldType = Array.isArray(fieldValue) ? 'array' : typeof fieldValue;
        nodeFields[nodeName][fieldName] = fieldType;
      }
    }
  }
  return nodeFields;
}

/**
 * Comprehensive data resolution for integration execution
 * This function resolves ALL data references in the input before passing to integrations
 */
export async function resolveIntegrationInputs(
  inputs: Record<string, unknown>,
  context: TypeSafeExecutionContext,
  includeCredentials: boolean = true
): Promise<{
  resolvedInputs: Record<string, unknown>;
  resolutionStats: {
    totalReferences: number;
    resolvedReferences: number;
    failedReferences: number;
    patternsUsed: string[];
  };
}>{
  const startTime = Date.now();
  let totalReferences = 0;
  let resolvedReferences = 0;
  let failedReferences = 0;
  const patternsUsed = new Set<string>();

  try {
    logger.info('Starting comprehensive integration input resolution', {
      executionId: context.executionId,
      inputKeys: Object.keys(inputs),
      includeCredentials
    });

    // Create resolution context
    const resolutionContext: ResolutionContext = {
      depth: 0,
      maxDepth: 15, // Higher limit for integration inputs
      resolvedReferences: new Set(),
      executionContext: context
    };

    // Resolve main inputs
    const resolvedInputs = await deepResolveSemanticReferences(inputs, resolutionContext) as Record<string, unknown>;

    // If credentials should be included, resolve them as well
    if (includeCredentials && inputs.credentials && typeof inputs.credentials === 'object') {
      const resolvedCredentials = await deepResolveSemanticReferences(
        inputs.credentials, 
        resolutionContext
      ) as Record<string, unknown>;
      
      resolvedInputs.credentials = resolvedCredentials;
    }

    // If unresolved tokens remain anywhere, sanitize instead of throwing
    const unresolved = JSON.stringify(resolvedInputs).includes('$json.');
    if (unresolved) {
      logger.warn('Unresolved semantic references detected in integration inputs - sanitizing', {
        executionId: context.executionId
      });
      const sanitized = sanitizeUnresolvedInObject(resolvedInputs) as Record<string, unknown>;
      // Re-check credentials as well
      if (sanitized.credentials && typeof sanitized.credentials === 'object') {
        sanitized.credentials = sanitizeUnresolvedInObject(sanitized.credentials) as Record<string, unknown>;
      }
      // Return sanitized inputs
      const resolutionStats = {
        totalReferences,
        resolvedReferences,
        failedReferences,
        patternsUsed: Array.from(patternsUsed)
      };
      const duration = Date.now() - startTime;
      logger.info('Integration input resolution completed with sanitization', {
        executionId: context.executionId,
        duration,
        ...resolutionStats
      });
      return {
        resolvedInputs: sanitized,
        resolutionStats
      };
    }

    // Calculate resolution statistics
    const resolutionStats = {
      totalReferences,
      resolvedReferences,
      failedReferences,
      patternsUsed: Array.from(patternsUsed)
    };

    const duration = Date.now() - startTime;
    logger.info('Integration input resolution completed', {
      executionId: context.executionId,
      duration,
      ...resolutionStats
    });

    return {
      resolvedInputs,
      resolutionStats
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Integration input resolution failed', {
      executionId: context.executionId,
      error: errorMessage,
      duration: Date.now() - startTime
    });

    // As a last resort, sanitize inputs instead of propagating error to keep workflow running
    try {
      const sanitized = sanitizeUnresolvedInObject(inputs) as Record<string, unknown>;
      return {
        resolvedInputs: sanitized,
        resolutionStats: {
          totalReferences,
          resolvedReferences,
          failedReferences,
          patternsUsed: Array.from(patternsUsed)
        }
      };
    } catch {
      // Propagate if even sanitization fails
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}

/**
 * Smart detection of data references in integration configurations
 * This function analyzes the configuration to determine if values are likely data references
 */
export function detectDataReferences(
  config: Record<string, unknown>,
  fieldContext?: Record<string, string>
): Array<{
  field: string;
  value: string;
  confidence: 'high' | 'medium' | 'low';
  suggestedPattern: string;
}> {
  const detectedReferences: Array<{
    field: string;
    value: string;
    confidence: 'high' | 'medium' | 'low';
    suggestedPattern: string;
  }> = [];

  for (const [field, value] of Object.entries(config)) {
    if (typeof value !== 'string') continue;

    const confidence = assessReferenceConfidence(value, field, fieldContext);
    if (confidence !== 'low') {
      detectedReferences.push({
        field,
        value,
        confidence,
        suggestedPattern: suggestOptimalPattern(value)
      });
    }
  }

  return detectedReferences;
}

/**
 * Assess the confidence level that a string value is a data reference
 */
function assessReferenceConfidence(
  value: string, 
  fieldName: string, 
  fieldContext?: Record<string, string>
): 'high' | 'medium' | 'low' {
  // High confidence patterns
  if (value.startsWith('$json.') || value.startsWith('json.') || value.startsWith('{{')) {
    return 'high';
  }

  // Medium confidence - looks like a reference but no prefix
  if (/^[a-zA-Z][a-zA-Z0-9_-]*\.[a-zA-Z][a-zA-Z0-9_-]*$/.test(value)) {
    return 'medium';
  }

  // Context-aware confidence
  if (fieldContext && fieldContext[fieldName]) {
    const context = fieldContext[fieldName].toLowerCase();
    if (SMART_REFERENCE_INDICATORS.DYNAMIC_FIELDS.some(dynamicField => 
      context.includes(dynamicField.toLowerCase())
    )) {
      // If field context suggests dynamic data, be more aggressive
      if (/^[a-zA-Z][a-zA-Z0-9_-]*\.[a-zA-Z][a-zA-Z0-9_-]*/.test(value)) {
        return 'medium';
      }
    }
  }

  return 'low';
}

/**
 * Suggest the optimal pattern for a detected reference
 */
function suggestOptimalPattern(value: string): string {
  if (value.startsWith('$json.')) return value; // Already optimal
  
  const match = value.match(/^([a-zA-Z][a-zA-Z0-9_-]*)\.([a-zA-Z][a-zA-Z0-9_-]*)/);
  if (match) {
    const [, nodeName, fieldName] = match;
    return `$json.${nodeName}.${fieldName}`;
  }
  
  return value; // Return original if no pattern detected
}
