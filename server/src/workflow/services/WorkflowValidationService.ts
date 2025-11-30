// workflow/services/WorkflowValidationService.ts
import logger from '../../utils/logger';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface WorkflowValidationData {
  name?: string;
  description?: string;
  trigger_type?: string;
  workflow_data?: any;
  is_active?: boolean;
  tenant_id?: string;
}

export class WorkflowValidationService {
  // Reserved workflow names that cannot be used
  private static readonly RESERVED_NAMES = [
    'main', 'error', 'fail', 'system', 'user',
    'Main', 'Error', 'Fail', 'System', 'User',
    'MAIN', 'ERROR', 'FAIL', 'SYSTEM', 'USER'
  ];

  // Related names that should also be reserved (case-insensitive)
  private static readonly RESERVED_NAME_PATTERNS = [
    /^main$/i,
    /^error$/i,
    /^fail$/i,
    /^system$/i,
    /^user$/i,
  ];

  constructor() {}

  /**
   * Check if a workflow name is reserved
   */
  isReservedName(name: string): boolean {
    if (!name || typeof name !== 'string') return false;
    const normalizedName = name.trim().toLowerCase();
    
    // Check exact match with reserved names
    if (WorkflowValidationService.RESERVED_NAMES.some(reserved => reserved.toLowerCase() === normalizedName)) {
      return true;
    }
    
    // Check patterns
    return WorkflowValidationService.RESERVED_NAME_PATTERNS.some(pattern => pattern.test(name));
  }

  async validateWorkflowData(data: WorkflowValidationData): Promise<ValidationResult> {
    const errors: string[] = [];

    // Validate required fields
    if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
      errors.push('Workflow name is required and must be a non-empty string');
    }

    // Check for reserved names
    if (data.name && this.isReservedName(data.name)) {
      errors.push(`Workflow name "${data.name}" is reserved and cannot be used. Reserved names: main, error, fail, system, user (case-insensitive)`);
    }

    if (data.name && data.name.length > 255) {
      errors.push('Workflow name must be 255 characters or less');
    }

    if (data.description && typeof data.description !== 'string') {
      errors.push('Description must be a string');
    }

    if (data.description && data.description.length > 1000) {
      errors.push('Description must be 1000 characters or less');
    }

    if (data.trigger_type && typeof data.trigger_type !== 'string') {
      errors.push('Trigger type must be a string');
    }

    if (data.trigger_type && !this.isValidTriggerType(data.trigger_type)) {
      errors.push('Invalid trigger type. Must be one of: webhook, schedule, event, manual');
    }

    if (data.is_active !== undefined && typeof data.is_active !== 'boolean') {
      errors.push('is_active must be a boolean value');
    }

    if (data.workflow_data && typeof data.workflow_data !== 'object') {
      errors.push('Workflow data must be a valid object');
    }

    // Validate workflow data structure if provided
    if (data.workflow_data) {
      const workflowDataErrors = this.validateWorkflowStructure(data.workflow_data);
      errors.push(...workflowDataErrors);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  private isValidTriggerType(triggerType: string): boolean {
    const validTypes = ['webhook', 'schedule', 'event', 'manual'];
    return validTypes.includes(triggerType);
  }

  private validateWorkflowStructure(workflowData: any): string[] {
    const errors: string[] = [];

    if (!workflowData.nodes || !Array.isArray(workflowData.nodes)) {
      errors.push('Workflow data must contain a nodes array');
    }

    if (!workflowData.edges || !Array.isArray(workflowData.edges)) {
      errors.push('Workflow data must contain an edges array');
    }

    if (workflowData.nodes && Array.isArray(workflowData.nodes)) {
      workflowData.nodes.forEach((node: any, index: number) => {
        if (!node.id || typeof node.id !== 'string') {
          errors.push(`Node ${index} must have a valid id`);
        }

        if (!node.type || typeof node.type !== 'string') {
          errors.push(`Node ${index} must have a valid type`);
        }

        if (!node.position || typeof node.position !== 'object') {
          errors.push(`Node ${index} must have a valid position object`);
        }

        if (node.position && (typeof node.position.x !== 'number' || typeof node.position.y !== 'number')) {
          errors.push(`Node ${index} position must have valid x and y coordinates`);
        }
      });
    }

    if (workflowData.edges && Array.isArray(workflowData.edges)) {
      workflowData.edges.forEach((edge: any, index: number) => {
        if (!edge.id || typeof edge.id !== 'string') {
          errors.push(`Edge ${index} must have a valid id`);
        }

        if (!edge.source || typeof edge.source !== 'string') {
          errors.push(`Edge ${index} must have a valid source`);
        }

        if (!edge.target || typeof edge.target !== 'string') {
          errors.push(`Edge ${index} must have a valid target`);
        }
      });
    }

    return errors;
  }

  async validateTriggerData(data: any): Promise<ValidationResult> {
    const errors: string[] = [];

    if (!data.trigger_type || typeof data.trigger_type !== 'string') {
      errors.push('Trigger type is required and must be a string');
    }

    if (data.trigger_type && !this.isValidTriggerType(data.trigger_type)) {
      errors.push('Invalid trigger type. Must be one of: webhook, schedule, event, manual');
    }

    if (!data.workflow_id || typeof data.workflow_id !== 'string') {
      errors.push('Workflow ID is required and must be a string');
    }

    if (data.is_active !== undefined && typeof data.is_active !== 'boolean') {
      errors.push('is_active must be a boolean value');
    }

    if (data.config && typeof data.config !== 'object') {
      errors.push('Config must be a valid object');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  async validateExecutionData(data: any): Promise<ValidationResult> {
    const errors: string[] = [];

    if (!data.workflow_id || typeof data.workflow_id !== 'string') {
      errors.push('Workflow ID is required and must be a string');
    }

    if (!data.status || typeof data.status !== 'string') {
      errors.push('Status is required and must be a string');
    }

    if (data.status && !this.isValidExecutionStatus(data.status)) {
      errors.push('Invalid execution status. Must be one of: pending, running, completed, failed, cancelled');
    }

    if (data.input_data && typeof data.input_data !== 'object') {
      errors.push('Input data must be a valid object');
    }

    if (data.output_data && typeof data.output_data !== 'object') {
      errors.push('Output data must be a valid object');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  private isValidExecutionStatus(status: string): boolean {
    const validStatuses = ['pending', 'running', 'completed', 'failed', 'cancelled'];
    return validStatuses.includes(status);
  }
}

export default WorkflowValidationService;
