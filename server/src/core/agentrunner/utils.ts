/**
 * Enhanced utility functions for workflow execution with TypeScript support
 */

/**
 * Safely get nested property from object using dot notation
 * Returns undefined if any part of the path is undefined/null
 */
function safeGetProperty(obj: any, path: string): any {
    if (!obj || typeof obj !== 'object') {
      return undefined;
    }
    
    return path.split('.').reduce((current, key) => {
      if (current === null || current === undefined) {
        return undefined;
      }
      return current[key];
    }, obj);
  }
  
  /**
   * Enhanced interpolate string with fallback support and type safety
   * Supports fallback syntax like {{var1 || var2 || var3}}
   * Supports default values like {{var1 || "default value"}}
   */
  function interpolateString(template: string, variables: Record<string, any>): string {
    if (typeof template !== 'string') {
      return String(template);
    }
    
    return template.replace(/\{\{([^}]+)\}\}/g, (match, expression) => {
      const trimmed = expression.trim();
      
      try {
        // Handle fallback syntax: split by ||
        const fallbackOptions = trimmed.split('||').map((opt: string) => opt.trim());
        
        for (const option of fallbackOptions) {
          // Handle string literals in quotes
          if ((option.startsWith('"') && option.endsWith('"')) || 
              (option.startsWith("'") && option.endsWith("'"))) {
            return option.slice(1, -1); // Remove quotes
          }
          
          // Handle numeric literals
          if (/^\d+(\.\d+)?$/.test(option)) {
            return option;
          }
          
          // Handle boolean literals
          if (option === 'true') return 'true';
          if (option === 'false') return 'false';
          
          // Try to get variable value
          try {
            const value = safeGetProperty(variables, option);
            
            // Return first non-empty value
            if (value !== undefined && value !== null && value !== '') {
              return String(value);
            }
          } catch (error) {
            console.warn(`Error accessing variable "${option}":`, error);
            continue; // Try next fallback
          }
        }
        
        // If no fallback worked, return empty string
        console.warn(`No valid value found for variable expression "${trimmed}"`);
        return '';
      } catch (error) {
        console.error(`Error processing expression "${trimmed}":`, error);
        return '';
      }
    });
  }
  
  /**
   * Type-safe recursive variable interpolation
   * Handles strings, arrays, and nested objects with proper typing
   */
  export function interpolateVariables<T = any>(obj: T, variables: Record<string, any>): T {
    // Ensure variables is an object
    if (!variables || typeof variables !== 'object') {
      console.warn('Variables parameter is not an object, using empty object');
      variables = {};
    }
    
    if (obj === null || obj === undefined) {
      return obj;
    }
    
    if (typeof obj === 'string') {
      return interpolateString(obj, variables) as T;
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => interpolateVariables(item, variables)) as T;
    }
    
    if (typeof obj === 'object' && obj !== null) {
      const result: any = {};
      
      for (const [key, value] of Object.entries(obj)) {
        try {
          result[key] = interpolateVariables(value, variables);
        } catch (error) {
          console.error(`Error interpolating key "${key}":`, error);
          result[key] = value; // Keep original value on error
        }
      }
      
      return result as T;
    }
    
    // Return primitive values as-is
    return obj;
  }
  
  /**
   * Enhanced context creation with flattened variables, step results, and type safety
   * This ensures all possible variable access patterns work
   */
  export function createSafeContext(context: any): Record<string, any> {
    const safeContext: Record<string, any> = {};
    
    if (!context || typeof context !== 'object') {
      return safeContext;
    }
    
    // Copy all original variables
    try {
      for (const [key, value] of Object.entries(context)) {
        safeContext[key] = value;
      }
    } catch (error) {
      console.error('Error creating safe context:', error);
    }
    
    // Enhanced flattening with type awareness
    function flattenObject(obj: any, prefix: string = '', maxDepth: number = 5, currentDepth: number = 0): void {
      if (!obj || typeof obj !== 'object' || currentDepth >= maxDepth) return;
      
      for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        
        try {
          if (value !== null && typeof value === 'object' && !Array.isArray(value) && 
              !(value instanceof Date) && !(value instanceof RegExp)) {
            // Store nested object reference
            safeContext[fullKey] = value;
            // Recursively flatten with depth control
            flattenObject(value, fullKey, maxDepth, currentDepth + 1);
          } else {
            // Store primitive value, arrays, dates, etc.
            safeContext[fullKey] = value;
          }
        } catch (error) {
          console.warn(`Error flattening property "${fullKey}":`, error);
          safeContext[fullKey] = value; // Store as-is on error
        }
      }
    }
    
    // Flatten the main context
    flattenObject(context);
    
    // Enhanced step results handling with multiple access patterns
    if (context.stepResults && typeof context.stepResults === 'object') {
      // Initialize namespaces
      safeContext.actions = safeContext.actions || {};
      safeContext.steps = safeContext.steps || {};
      safeContext.results = safeContext.results || {};
      
      for (const [stepId, stepResult] of Object.entries(context.stepResults)) {
        if (stepResult && typeof stepResult === 'object') {
          try {
            // Add to multiple namespaces for flexibility
            safeContext.actions[stepId] = stepResult;
            safeContext.steps[stepId] = stepResult;
            safeContext.results[stepId] = stepResult;
            
            // Flatten step results with different prefixes
            flattenObject(stepResult, `actions.${stepId}`);
            flattenObject(stepResult, `steps.${stepId}`);
            flattenObject(stepResult, `results.${stepId}`);
            
            // Direct step access (for {{stepId.property}})
            safeContext[stepId] = stepResult;
            flattenObject(stepResult, stepId);
          } catch (error) {
            console.error(`Error processing step result "${stepId}":`, error);
          }
        }
      }
    }
    
    // Enhanced WhatsApp-specific context handling
    if (context.variables) {
      // Merge variables into root for direct access
      try {
        for (const [key, value] of Object.entries(context.variables)) {
          if (!safeContext[key]) { // Don't override existing values
            safeContext[key] = value;
          }
        }
        
        // Special handling for WhatsApp trigger data
        if (context.variables.whatsAppTriggerContext) {
          const whatsAppContext = context.variables.whatsAppTriggerContext;
          
          // Add WhatsApp-specific shortcuts
          if (whatsAppContext.primaryMessage) {
            safeContext.incomingMessage = whatsAppContext.primaryMessage;
            safeContext.lastMessage = whatsAppContext.primaryMessage;
          }
          
          if (whatsAppContext.messages && whatsAppContext.messages.length > 0) {
            safeContext.messages = whatsAppContext.messages;
          }
        }
      } catch (error) {
        console.error('Error processing context variables:', error);
      }
    }
    
    // Ensure common properties exist with safe defaults
    ensureDefaultProperties(safeContext);
    
    return safeContext;
  }
  
  /**
   * Ensure default properties exist to prevent undefined access
   */
  function ensureDefaultProperties(context: Record<string, any>): void {
    const defaults = {
      message: {},
      user: {},
      metadata: {},
      sender: '',
      from: '',
      to: '',
      messageText: '',
      messageId: '',
      timestamp: new Date().toISOString()
    };
    
    for (const [key, defaultValue] of Object.entries(defaults)) {
      if (context[key] === undefined || context[key] === null) {
        context[key] = defaultValue;
      }
    }
  }
  
  /**
   * Enhanced validation with fallback support and better error reporting
   */
  export function validateRequiredVariables(
    template: any, 
    variables: Record<string, any>, 
    requiredVars: string[] = []
  ): { valid: boolean; missingVars: string[]; availableVars: string[]; warnings: string[] } {
    const extractedVars = extractVariableNames(template);
    const allRequiredVars = [...new Set([...requiredVars, ...extractedVars])];
    const warnings: string[] = [];
    const availableVars = Object.keys(variables);
    
    const missingVars = allRequiredVars.filter(varExpression => {
      // For fallback variables (||), check if ANY option is available
      const fallbackOptions = varExpression.split('||').map(opt => opt.trim());
      
      const hasValidOption = fallbackOptions.some(option => {
        // Skip string literals
        if ((option.startsWith('"') && option.endsWith('"')) || 
            (option.startsWith("'") && option.endsWith("'"))) {
          return true;
        }
        
        // Skip numeric literals
        if (/^\d+(\.\d+)?$/.test(option)) {
          return true;
        }
        
        // Skip boolean literals
        if (option === 'true' || option === 'false') {
          return true;
        }
        
        const value = safeGetProperty(variables, option);
        return value !== undefined && value !== null && value !== '';
      });
      
      if (!hasValidOption && fallbackOptions.length > 1) {
        warnings.push(`None of the fallback options for "${varExpression}" are available`);
      }
      
      return !hasValidOption;
    });
    
    return {
      valid: missingVars.length === 0,
      missingVars,
      availableVars,
      warnings
    };
  }
  
  /**
   * Enhanced variable name extraction with fallback syntax support
   */
  export function extractVariableNames(obj: any): string[] {
    const variables = new Set<string>();
    
    const extractFromString = (str: string): void => {
      const matches = str.match(/\{\{([^}]+)\}\}/g);
      if (matches) {
        matches.forEach(match => {
          const varExpression = match.replace(/[{}]/g, '').trim();
          variables.add(varExpression);
          
          // Also add individual fallback options for analysis
          const fallbackOptions = varExpression.split('||').map(opt => opt.trim());
          fallbackOptions.forEach(option => {
            // Skip string literals
            if (!((option.startsWith('"') && option.endsWith('"')) || 
                  (option.startsWith("'") && option.endsWith("'")))) {
              variables.add(option);
            }
          });
        });
      }
    };
    
    const extractRecursive = (item: any): void => {
      if (typeof item === 'string') {
        extractFromString(item);
      } else if (Array.isArray(item)) {
        item.forEach(extractRecursive);
      } else if (item && typeof item === 'object') {
        Object.values(item).forEach(extractRecursive);
      }
    };
    
    extractRecursive(obj);
    return Array.from(variables);
  }
  
  /**
   * Enhanced debug utility with better formatting and analysis
   */
  export function debugInterpolation(template: any, variables: Record<string, any>, label?: string): void {
    console.log(`=== Variable Interpolation Debug${label ? ` (${label})` : ''} ===`);
    console.log('Template:', JSON.stringify(template, null, 2));
    console.log('Available variables count:', Object.keys(variables).length);
    console.log('Available variable keys:', Object.keys(variables).slice(0, 20)); // Limit output
    
    const extractedVars = extractVariableNames(template);
    console.log('Required variables:', extractedVars);
    
    const validation = validateRequiredVariables(template, variables);
    if (!validation.valid) {
      console.warn('❌ Missing variables:', validation.missingVars);
    } else {
      console.log('✅ All variables available');
    }
    
    if (validation.warnings.length > 0) {
      console.warn('⚠️  Warnings:', validation.warnings);
    }
    
    // Show variable values for debugging
    if (extractedVars.length > 0) {
      console.log('Variable values:');
      extractedVars.slice(0, 10).forEach(varName => {
        const value = safeGetProperty(variables, varName);
        console.log(`  ${varName}: ${typeof value} = ${JSON.stringify(value)?.substring(0, 100)}`);
      });
    }
    
    console.log('=============================================');
  }
  
  /**
   * Type-safe interpolation with validation
   */
  export function safeInterpolate<T>(
    template: T, 
    variables: Record<string, any>, 
    options: {
      validate?: boolean;
      debug?: boolean;
      label?: string;
      throwOnMissing?: boolean;
    } = {}
  ): T {
    const { validate = false, debug = false, label, throwOnMissing = false } = options;
    
    if (debug) {
      debugInterpolation(template, variables, label);
    }
    
    if (validate) {
      const validation = validateRequiredVariables(template, variables);
      if (!validation.valid) {
        const error = `Missing required variables: ${validation.missingVars.join(', ')}`;
        if (throwOnMissing) {
          throw new Error(error);
        }
        console.warn(error);
      }
    }
    
    return interpolateVariables(template, variables);
  }
  
  /**
   * Utility to merge multiple contexts safely
   */
  export function mergeContexts(...contexts: any[]): Record<string, any> {
    const merged: Record<string, any> = {};
    
    for (const context of contexts) {
      if (context && typeof context === 'object') {
        try {
          const safeContext = createSafeContext(context);
          Object.assign(merged, safeContext);
        } catch (error) {
          console.error('Error merging context:', error);
        }
      }
    }
    
    return merged;
  }
  
  /**
   * Type definitions for better TypeScript support
   */
  export interface VariableValidationResult {
    valid: boolean;
    missingVars: string[];
    availableVars: string[];
    warnings: string[];
  }
  
  export interface InterpolationOptions {
    validate?: boolean;
    debug?: boolean;
    label?: string;
    throwOnMissing?: boolean;
  }
  
  export interface SafeContext extends Record<string, any> {
    // Core properties
    message: any;
    user: any;
    metadata: any;
    
    // WhatsApp specific
    messageText?: string;
    sender?: string;
    from?: string;
    messageId?: string;
    timestamp?: string;
    
    // Step results
    actions?: Record<string, any>;
    steps?: Record<string, any>;
    results?: Record<string, any>;
  }