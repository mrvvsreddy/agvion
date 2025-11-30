// knowledge/services/InputSanitizer.ts
/**
 * Shared input sanitization utilities to prevent injection attacks
 * and ensure data consistency across services
 */

export class InputSanitizer {
  /**
   * Sanitize string input by removing control characters and limiting length
   */
  static sanitizeString(input: string, maxLength: number = 255): string {
    if (!input || typeof input !== 'string') {
      return '';
    }
    // Remove null bytes and control characters
    return input
      .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
      .trim()
      .substring(0, maxLength);
  }

  /**
   * Sanitize filename by removing invalid characters
   */
  static sanitizeFilename(filename: string): string {
    if (!filename || typeof filename !== 'string') {
      return '';
    }
    return filename
      .replace(/[\x00-\x1f\x7f<>:"|?*\\/]/g, '')
      .trim()
      .substring(0, 255);
  }

  /**
   * Validate UUID format
   */
  static isValidUUID(id: string): boolean {
    if (!id || typeof id !== 'string') {
      return false;
    }
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  }

  /**
   * Validate alphanumeric ID format (for agent/tenant IDs)
   */
  static isValidAlphanumericId(id: string): boolean {
    if (!id || typeof id !== 'string') {
      return false;
    }
    return /^[A-Za-z0-9\-_]{1,64}$/.test(id);
  }
}

