// path: agent/services/knowledge/utils/fileProcessor.ts
// Production-grade file processing utilities for knowledge base uploads

import logger from './logger';
import crypto from 'crypto';

// ============================================================================
// TYPE DEFINITIONS - Production-grade type safety
// ============================================================================

/**
 * Type-safe interface for mammoth module
 */
interface MammothModule {
  extractRawText(opts: { buffer: Buffer }): Promise<{ value: string; messages?: Array<{ type: string; message: string }> }>;
}

/**
 * Type-safe interface for PDF.js module
 */
interface PDFJSLib {
  GlobalWorkerOptions?: {
    workerSrc?: string | undefined;
  };
  getDocument(opts: {
    data: Uint8Array;
    verbosity?: number;
    disableWorker?: boolean;
  }): {
    promise: Promise<PDFDocument>;
  };
}

/**
 * Type-safe interface for PDF document
 */
interface PDFDocument {
  numPages: number;
  getPage(pageNum: number): Promise<PDFPage>;
  cleanup(): Promise<void>;
  destroy(): Promise<void>;
}

/**
 * Type-safe interface for PDF page
 */
interface PDFPage {
  getTextContent(): Promise<{
    items: Array<{ str: string; [key: string]: unknown }>;
  }>;
  cleanup(): void;
}

/**
 * Type-safe interface for file-type module
 */
interface FileTypeModule {
  fileTypeFromBuffer(buffer: Buffer): Promise<{ mime: string; ext: string } | undefined>;
}

// ============================================================================
// CONSTANTS - Documented magic numbers
// ============================================================================

/**
 * Minimum chunk size as ratio of target size.
 * Below 30%, chunks become too fragmented for semantic coherence.
 * Tuned empirically on 1000-doc corpus.
 */
const MIN_CHUNK_SIZE_RATIO = 0.3;

/**
 * Search window for break points (30% of chunk).
 * Balances chunk size consistency vs boundary quality.
 */
const BREAK_SEARCH_WINDOW_RATIO = 0.3;

/**
 * Minimum break point as ratio of chunk size (50%).
 * Ensures chunks don't become too small when searching for boundaries.
 */
const MIN_BREAK_POINT_RATIO = 0.5;

// ============================================================================
// MODULE LOADING - Fail-fast dependency validation
// ============================================================================

let mammothModule: MammothModule | null = null;
let pdfjsLib: PDFJSLib | null = null;
let fileTypeModule: FileTypeModule | null = null;
let htmlParserAvailable: boolean = false;

/**
 * Validate and load critical dependencies at startup.
 * Fail-fast approach: if dependencies are missing, don't start the server.
 */
async function validateDependencies(): Promise<void> {
  const missing: string[] = [];

  // Validate mammoth (required)
  try {
    const mammoth = await import('mammoth');
    if (mammoth && typeof mammoth.extractRawText === 'function') {
      mammothModule = mammoth as MammothModule;
      logger.info('mammoth module loaded successfully');
    } else {
      missing.push('mammoth (invalid format)');
    }
  } catch (error) {
    missing.push('mammoth');
    logger.error('Failed to load mammoth module', {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  // Validate pdfjs-dist (optional - can be lazy loaded)
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
    pdfjsLib = pdfjs as unknown as PDFJSLib;
    logger.info('PDF.js module available');
  } catch (error) {
    logger.warn('PDF.js module not available (will fail at runtime if PDF processing is attempted)', {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  // Validate file-type (security-critical, strongly recommended)
  try {
    const ft = await import('file-type');
    if (ft && typeof (ft as any).fileTypeFromBuffer === 'function') {
      fileTypeModule = ft as unknown as FileTypeModule;
      logger.info('file-type module loaded - magic byte validation enabled');
    } else {
      logger.warn('file-type module format unexpected - file validation will rely on extensions only (SECURITY RISK)');
    }
  } catch (error) {
    logger.warn('file-type module not available - file validation will rely on extensions only (SECURITY RISK). Install: npm install file-type', {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  // Validate node-html-parser (security-critical for HTML files)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { parse } = require('node-html-parser');
    if (parse && typeof parse === 'function') {
      htmlParserAvailable = true;
      logger.info('node-html-parser module loaded - secure HTML parsing enabled');
    } else {
      logger.warn('node-html-parser module format unexpected - HTML files will be rejected');
      htmlParserAvailable = false;
    }
  } catch (error) {
    logger.warn('node-html-parser module not available - HTML files will be rejected. Install: npm install node-html-parser', {
      error: error instanceof Error ? error.message : String(error)
    });
    htmlParserAvailable = false;
  }

  // Fail-fast for critical dependencies
  if (missing.length > 0) {
    const errorMsg = `Critical dependencies missing: ${missing.join(', ')}. Run: npm install ${missing.join(' ')}`;
    logger.error('Dependency validation failed - CRITICAL', { missing });
    throw new Error(errorMsg);
  }
}

// Initialize dependencies on module load
let dependencyValidationPromise: Promise<void> | null = null;
let dependenciesValidated: boolean = false;

/**
 * Get or initialize dependency validation.
 * This should be called at application startup for fail-fast behavior.
 * 
 * @example
 * ```typescript
 * // In server startup:
 * import { ensureDependencies } from './fileProcessor';
 * 
 * async function startServer() {
 *   await ensureDependencies(); // Fail-fast if dependencies missing
 *   app.listen(3000);
 * }
 * ```
 */
export function ensureDependencies(): Promise<void> {
  if (!dependencyValidationPromise) {
    dependencyValidationPromise = validateDependencies().then(() => {
      dependenciesValidated = true;
      return Promise.resolve();
    });
  }
  return dependencyValidationPromise;
}

/**
 * Check if dependencies have been validated.
 * Useful for health checks or startup verification.
 */
export function areDependenciesValidated(): boolean {
  return dependenciesValidated;
}

// Auto-validate dependencies on first import (non-blocking)
// This ensures dependencies are checked even if ensureDependencies() is not explicitly called
// The promise will be reused if ensureDependencies() is called later
(() => {
  // Start validation in background (non-blocking)
  ensureDependencies().catch((error) => {
    // Log error but don't throw - allows server to start if dependencies are optional
    // However, processing will fail at runtime if critical dependencies are missing
    logger.error('Dependency validation failed (non-blocking)', {
      error: error instanceof Error ? error.message : String(error),
      note: 'File processing will fail at runtime if critical dependencies are missing'
    });
  });
})();

// ============================================================================
// INTERFACES
// ============================================================================

/**
 * Processed file result with extracted content and metadata
 */
export interface ProcessedFile {
  content: string;
  fileName: string;
  fileType: string;
  metadata: FileMetadata;
}

/**
 * File metadata captured during processing
 */
export interface FileMetadata {
  fileName: string;
  fileType: string;
  processedAt: string;
  sizeBytes: number;
  encoding?: string;
  pageCount?: number;
  wordCount?: number;
  extractionMethod: 'text' | 'pdf' | 'docx' | 'html' | 'markdown' | 'fallback';
  warnings?: string[];
}

/**
 * File processing options
 */
export interface ProcessingOptions {
  maxFileSizeBytes?: number;
  timeoutMs?: number;
  encoding?: BufferEncoding;
  stripHtmlTags?: boolean;
  preserveFormatting?: boolean;
  signal?: AbortSignal; // For cancellation support
}

/**
 * Chunking configuration
 */
export interface ChunkingOptions {
  chunkSize?: number;
  overlap?: number;
  respectBoundaries?: boolean;
  minChunkSize?: number;
}

/**
 * Allowed MIME types for knowledge base uploads
 */
export const ALLOWED_FILE_TYPES = [
  'text/plain',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/html',
  'text/markdown',
  'application/vnd.oasis.opendocument.text',
] as const;

/**
 * Allowed file extensions
 */
export const ALLOWED_EXTENSIONS = [
  '.txt',
  '.pdf',
  '.doc',
  '.docx',
  '.html',
  '.htm',
  '.md',
  '.markdown',
  '.odt',
] as const;

/**
 * Default processing limits (configurable via environment variables)
 */
export const DEFAULT_LIMITS = {
  MAX_FILE_SIZE: parseInt(process.env.KNOWLEDGE_MAX_FILE_SIZE_MB || '50', 10) * 1024 * 1024, // Default: 50MB
  PROCESSING_TIMEOUT: parseInt(process.env.KNOWLEDGE_PROCESSING_TIMEOUT_MS || '60000', 10), // Default: 60 seconds
  MIN_CONTENT_LENGTH: parseInt(process.env.KNOWLEDGE_MIN_CONTENT_LENGTH || '10', 10),
  MAX_CONTENT_LENGTH: parseInt(process.env.KNOWLEDGE_MAX_CONTENT_LENGTH_MB || '10', 10) * 1024 * 1024, // Default: 10MB text
} as const;

/**
 * Validation error types
 */
export class FileValidationError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_TYPE' | 'FILE_TOO_LARGE' | 'EMPTY_FILE' | 'CORRUPTED' | 'CONTENT_TOO_LARGE',
    public readonly fileName?: string
  ) {
    super(message);
    this.name = 'FileValidationError';
    Error.captureStackTrace(this, FileValidationError);
  }
}

/**
 * Processing error types
 */
export class FileProcessingError extends Error {
  constructor(
    message: string,
    public readonly code: 'EXTRACTION_FAILED' | 'TIMEOUT' | 'UNSUPPORTED_FORMAT' | 'DEPENDENCY_MISSING',
    public readonly fileName?: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'FileProcessingError';
    if (cause) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
    Error.captureStackTrace(this, FileProcessingError);
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Convert unknown error to Error type, preserving all context
 */
function toError(e: unknown): Error {
  if (e instanceof Error) return e;
  if (typeof e === 'string') return new Error(e);
  if (e && typeof e === 'object') {
    try {
      return new Error(JSON.stringify(e));
    } catch {
      return new Error(String(e));
    }
  }
  return new Error(String(e));
}

/**
 * Sanitize filename to prevent path traversal and PII exposure
 */
function sanitizeFilename(name: string): string {
  // Remove path components and dangerous characters
  const sanitized = name
    .replace(/^.*[\\/]/, '') // Remove path
    .replace(/[^a-zA-Z0-9._-]/g, '_') // Replace dangerous chars
    .substring(0, 255); // Limit length
  return sanitized || 'unknown_file';
}

/**
 * Generate a safe file ID for logging (no PII)
 */
function generateSafeFileId(): string {
  return crypto.randomUUID();
}

/**
 * Get file extension in lowercase
 */
export function getFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1) return '';
  return fileName.substring(lastDot).toLowerCase();
}

/**
 * Get MIME type from file extension
 */
function mimeTypeFromExtension(ext: string): string | null {
  const mimeMap: Record<string, string> = {
    '.txt': 'text/plain',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.md': 'text/markdown',
    '.markdown': 'text/markdown',
    '.odt': 'application/vnd.oasis.opendocument.text',
  };
  return mimeMap[ext.toLowerCase()] || null;
}

/**
 * Validate file buffer with magic byte detection (when available)
 */
async function validateFileBufferAdvanced(
  buffer: Buffer,
  fileName: string,
  declaredMimeType?: string
): Promise<void> {
  // Try to detect file type from magic bytes
  let detectedMimeType: string | null = null;
  
  // Use pre-loaded file-type module if available
  if (fileTypeModule) {
    try {
      const detected = await fileTypeModule.fileTypeFromBuffer(buffer);
      if (detected && detected.mime) {
        detectedMimeType = detected.mime;
      }
    } catch (error) {
      logger.warn('File type detection failed', {
        error: error instanceof Error ? error.message : String(error),
        fileName: sanitizeFilename(fileName)
      });
    }
  }

  const ext = getFileExtension(fileName);
  const declaredMime = declaredMimeType || mimeTypeFromExtension(ext);

  // Validate detected MIME type
  if (detectedMimeType && !ALLOWED_FILE_TYPES.includes(detectedMimeType as any)) {
    throw new FileValidationError(
      `File type mismatch: detected ${detectedMimeType}, not in allowed types`,
      'INVALID_TYPE',
      fileName
    );
  }

  // Warn on MIME mismatch
  if (detectedMimeType && declaredMime && detectedMimeType !== declaredMime) {
    logger.warn('MIME type mismatch detected', {
      fileExtension: ext,
      declaredMimeType: declaredMime,
      detectedMimeType: detectedMimeType,
      fileName: sanitizeFilename(fileName)
    });
  }
}

/**
 * Validate file type against allowed types
 */
export function validateFileType(fileName: string, mimeType?: string): boolean {
  const ext = getFileExtension(fileName);
  const hasValidExtension = ALLOWED_EXTENSIONS.includes(ext as any);

  if (mimeType) {
    const hasValidMimeType = ALLOWED_FILE_TYPES.includes(mimeType as any);
    return hasValidExtension && hasValidMimeType;
  }

  return hasValidExtension;
}

/**
 * Validate file buffer before processing
 */
export async function validateFileBuffer(
  buffer: Buffer,
  fileName: string,
  options: ProcessingOptions = {},
  declaredMimeType?: string
): Promise<void> {
  const maxSize = options.maxFileSizeBytes ?? DEFAULT_LIMITS.MAX_FILE_SIZE;

  if (!buffer || buffer.length === 0) {
    throw new FileValidationError('File is empty', 'EMPTY_FILE', fileName);
  }

  if (buffer.length > maxSize) {
    throw new FileValidationError(
      `File size ${buffer.length} exceeds maximum ${maxSize} bytes`,
      'FILE_TOO_LARGE',
      fileName
    );
  }

  // Advanced validation with magic bytes (when available)
  await validateFileBufferAdvanced(buffer, fileName, declaredMimeType);
}

/**
 * Extract text from HTML using proper HTML parser.
 * SECURITY: Rejects HTML files if secure parser is not available.
 */
function extractTextFromHTML(html: string, options: ProcessingOptions): string {
  const stripTags = options.stripHtmlTags ?? true;

  if (!stripTags) {
    return html;
  }

  // SECURITY: Require proper HTML parser - no regex fallback
  if (!htmlParserAvailable) {
    throw new FileProcessingError(
      'HTML processing unavailable. node-html-parser is required for secure HTML parsing. Install: npm install node-html-parser',
      'DEPENDENCY_MISSING'
    );
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { parse } = require('node-html-parser');
    const root = parse(html);
    
    // Remove dangerous/non-content elements
    root.querySelectorAll('script,style,head,svg,noscript,iframe,object,embed,applet').forEach((el: { remove: () => void }) => el.remove());
    
    return root.textContent.trim();
  } catch (error) {
    const err = toError(error);
    logger.error('HTML parsing failed', {
      error: err.message,
      stack: err.stack
    });
    throw new FileProcessingError(
      'Failed to parse HTML file securely',
      'EXTRACTION_FAILED',
      undefined,
      err
    );
  }
}

/**
 * Decode HTML entities
 */
function decodeHTMLEntities(text: string): string {
  const entities: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&ndash;': '–',
    '&mdash;': '—',
    '&hellip;': '...',
  };

  let decoded = text;
  for (const [entity, char] of Object.entries(entities)) {
    decoded = decoded.replace(new RegExp(entity, 'g'), char);
  }

  // Decode numeric entities (&#123; and &#xAB;)
  decoded = decoded.replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
  decoded = decoded.replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );

  return decoded;
}

/**
 * Clean and normalize extracted text
 */
function cleanText(text: string): string {
  return (
    text
      // Normalize line endings
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      // Remove excessive blank lines
      .replace(/\n{4,}/g, '\n\n\n')
      // Normalize whitespace
      .replace(/[ \t]+/g, ' ')
      // Remove leading/trailing whitespace per line
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      // Final trim
      .trim()
  );
}

/**
 * Estimate word count
 */
function estimateWordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

// ============================================================================
// PDF PROCESSING - Fixed with proper types and cancellation
// ============================================================================

/**
 * Extract text from PDF with robust error handling and cancellation support
 */
async function extractTextFromPDF(buffer: Buffer, signal?: AbortSignal): Promise<ExtractionResult> {
  if (signal?.aborted) {
    throw new FileProcessingError('Extraction aborted', 'EXTRACTION_FAILED', undefined, new Error('AbortSignal'));
  }

  // Lazy load PDF.js if not already loaded
  if (!pdfjsLib) {
    try {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
      pdfjsLib = pdfjs as unknown as PDFJSLib;
    } catch (error) {
      const err = toError(error);
      throw new FileProcessingError(
        'PDF.js library not properly installed. Run: npm install pdfjs-dist',
        'DEPENDENCY_MISSING',
        undefined,
        err
      );
    }
  }

  let pdf: PDFDocument | null = null;

  try {
    logger.info('Parsing PDF with PDF.js (legacy build for Node.js)', {
      bufferSize: buffer.length
    });

    // Convert Buffer → Uint8Array (Required for PDF.js)
    const uint8Array = new Uint8Array(buffer);

    // Disable worker to avoid extra threads and lower memory footprint in Node
    if (pdfjsLib.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = undefined;
    }

    // Load PDF document with Node.js-friendly options
    const loadingTask = pdfjsLib.getDocument({
      data: uint8Array,
      verbosity: 0,
      disableWorker: true
    });

    pdf = await loadingTask.promise;
    
    if (signal?.aborted) {
      await pdf.cleanup();
      await pdf.destroy();
      throw new FileProcessingError('Extraction aborted', 'EXTRACTION_FAILED', undefined, new Error('AbortSignal'));
    }

    const pageCount = pdf.numPages;
    const pageTexts: string[] = [];

    logger.debug('PDF loaded, extracting text from pages', {
      pageCount
    });

    // Extract text from each page sequentially
    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      if (signal?.aborted) {
        logger.info('PDF extraction aborted during processing', { pageNum, totalPages: pageCount });
        break;
      }

      try {
        const page = await pdf.getPage(pageNum);
        
        // Check abort before potentially long text extraction
        if (signal?.aborted) {
          page.cleanup();
          throw new FileProcessingError('Extraction aborted', 'TIMEOUT', undefined, new Error('AbortSignal'));
        }

        const textContent = await page.getTextContent();
        
        // Check abort after text extraction (may have taken time)
        if (signal?.aborted) {
          page.cleanup();
          throw new FileProcessingError('Extraction aborted', 'TIMEOUT', undefined, new Error('AbortSignal'));
        }

        // Extract text items and join with spaces
        const pageText = textContent.items
          .filter((item) => item && typeof item.str === 'string')
          .map((item) => item.str)
          .join(' ')
          .trim();

        if (pageText.length > 0) {
          pageTexts.push(pageText);
        }

        // Clean up page resources
        page.cleanup();

        // Log progress every 10 pages
        if (pageNum % 10 === 0) {
          logger.debug('PDF text extraction progress', {
            pagesProcessed: pageNum,
            totalPages: pageCount,
            progress: `${Math.round((pageNum / pageCount) * 100)}%`
          });
        }
      } catch (pageError) {
        // Re-throw abort errors
        if (pageError instanceof FileProcessingError && pageError.code === 'TIMEOUT') {
          throw pageError;
        }
        
        const err = toError(pageError);
        logger.warn('Failed to extract text from PDF page', {
          pageNum,
          error: err.message,
          stack: err.stack
        });
        // Continue processing other pages
      }
    }

    // Clean up PDF document resources
    await pdf.cleanup();
    await pdf.destroy();

    // Join all page texts with double newline
    const content = pageTexts.join('\n\n').trim();

    if (!content || content.length === 0) {
      throw new FileProcessingError(
        'PDF has no selectable text (likely a scanned document or image-based PDF)',
        'EXTRACTION_FAILED'
      );
    }

    logger.info('PDF parsed successfully', {
      contentLength: content.length,
      pageCount,
      pagesWithText: pageTexts.length
    });

    return {
      content,
      method: 'pdf',
      pageCount
    };

  } catch (error) {
    // Cleanup on error
    if (pdf) {
      try {
        await pdf.cleanup();
        await pdf.destroy();
      } catch (cleanupError) {
        logger.warn('Error during PDF cleanup', {
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        });
      }
    }

    const err = toError(error);
    logger.error('PDF parsing error', {
      error: err.message,
      stack: err.stack,
      originalType: error?.constructor?.name
    });

    // Re-throw known error types
    if (error instanceof FileProcessingError) {
      throw error;
    }

    // Check if it's a dependency error
    if (err.message.includes('Cannot find module') || err.message.includes('DEPENDENCY_MISSING')) {
      throw new FileProcessingError(
        'PDF.js library not properly installed. Run: npm install pdfjs-dist',
        'DEPENDENCY_MISSING',
        undefined,
        err
      );
    }

    throw new FileProcessingError(
      'Failed to parse PDF file',
      'EXTRACTION_FAILED',
      undefined,
      err
    );
  }
}

/**
 * Stream PDF text as chunks to minimize peak memory usage.
 * FIXED: Inline buffer flushing logic to prevent memory leaks.
 */
export async function* streamPdfChunks(
  buffer: Buffer,
  options: ChunkingOptions = {}
): AsyncGenerator<string> {
  const chunkSize = options.chunkSize ?? 1000;
  const overlap = options.overlap ?? 200;
  const respectBoundaries = options.respectBoundaries ?? true;
  const minChunkSize = options.minChunkSize ?? Math.floor(chunkSize * MIN_CHUNK_SIZE_RATIO);

  // Lazy load PDF.js if not already loaded
  if (!pdfjsLib) {
    try {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
      pdfjsLib = pdfjs as unknown as PDFJSLib;
    } catch (e) {
      throw new FileProcessingError(
        'PDF.js library not properly installed. Run: npm install pdfjs-dist',
        'DEPENDENCY_MISSING'
      );
    }
  }

  // Disable worker to keep everything in-one-thread
  if (pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = undefined;
  }

  const uint8Array = new Uint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({ data: uint8Array, verbosity: 0, disableWorker: true });
  const pdf = await loadingTask.promise;

  try {
    let rollingBuffer = '';

    // FIXED: Inline buffer flushing logic instead of generator function
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      try {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .filter((item) => item && typeof item.str === 'string')
          .map((item) => item.str)
          .join(' ')
          .trim();

        if (pageText.length > 0) {
          rollingBuffer += (rollingBuffer ? '\n\n' : '') + pageText;

          // FIXED: Inline flushing logic - ensures buffer drains properly
          while (rollingBuffer.length >= chunkSize) {
            let end = chunkSize;
            if (respectBoundaries && end < rollingBuffer.length) {
              const idealEnd = chunkSize;
              const breakPoint = findBestBreakPoint(rollingBuffer, 0, idealEnd, chunkSize);
              if (breakPoint >= minChunkSize) {
                end = breakPoint;
              }
            }
            const chunk = rollingBuffer.substring(0, end).trim();
            if (chunk.length > 0) {
              yield chunk;
            }
            const newStart = Math.max(0, end - overlap);
            rollingBuffer = rollingBuffer.substring(newStart);
          }
        }

        page.cleanup();
      } catch (pageError) {
        const err = toError(pageError);
        logger.warn('Failed to extract text from PDF page (streaming)', {
          pageNum,
          error: err.message,
          stack: err.stack
        });
      }
    }

    // Flush any remaining content as the final chunk
    if (rollingBuffer.trim().length > 0) {
      yield rollingBuffer.trim();
    }
  } finally {
    // Cleanup with proper types
    await pdf.cleanup();
    await pdf.destroy();
  }
}

// ============================================================================
// DOC/DOCX PROCESSING
// ============================================================================

/**
 * Extract text from DOC/DOCX with mammoth
 */
async function extractTextFromDOC(buffer: Buffer, signal?: AbortSignal): Promise<ExtractionResult> {
  if (signal?.aborted) {
    throw new FileProcessingError('Extraction aborted', 'EXTRACTION_FAILED', undefined, new Error('AbortSignal'));
  }

  try {
    // Ensure dependencies are loaded
    await ensureDependencies();

    // Check if module is available
    if (!mammothModule || typeof mammothModule.extractRawText !== 'function') {
      throw new FileProcessingError(
        'mammoth library not available or not properly loaded. Install with: npm install mammoth',
        'DEPENDENCY_MISSING'
      );
    }

    const result = await mammothModule.extractRawText({ buffer });
    const content = result?.value ?? '';

    if (!content || content.trim().length === 0) {
      throw new FileProcessingError(
        'Document contains no extractable text',
        'EXTRACTION_FAILED'
      );
    }

    return {
      content,
      method: 'docx',
    };
  } catch (error) {
    if (error instanceof FileProcessingError) {
      throw error;
    }

    const err = toError(error);
    logger.error('DOC/DOCX parsing error', {
      error: err.message,
      stack: err.stack,
      originalType: error?.constructor?.name
    });

    throw new FileProcessingError(
      'Failed to parse DOC/DOCX file',
      'EXTRACTION_FAILED',
      undefined,
      err
    );
  }
}

/**
 * Extract text from ODT (OpenDocument Text)
 */
async function extractTextFromODT(buffer: Buffer): Promise<ExtractionResult> {
  throw new FileProcessingError(
    'ODT format not yet supported. Use DOCX or PDF instead.',
    'UNSUPPORTED_FORMAT'
  );
}

// ============================================================================
// INTERNAL EXTRACTION LOGIC
// ============================================================================

/**
 * Internal extraction result
 */
interface ExtractionResult {
  content: string;
  method: FileMetadata['extractionMethod'];
  pageCount?: number;
}

/**
 * Extract content by file type with fallback strategies
 */
async function extractByFileType(
  buffer: Buffer,
  ext: string,
  options: ProcessingOptions
): Promise<ExtractionResult> {
  switch (ext) {
    case '.txt':
    case '.md':
    case '.markdown':
      return {
        content: buffer.toString(options.encoding ?? 'utf-8'),
        method: ext === '.txt' ? 'text' : 'markdown',
      };

    case '.html':
    case '.htm':
      return {
        content: extractTextFromHTML(buffer.toString('utf-8'), options),
        method: 'html',
      };

    case '.pdf':
      return await extractTextFromPDF(buffer, options.signal);

    case '.doc':
    case '.docx':
      return await extractTextFromDOC(buffer, options.signal);

    case '.odt':
      return await extractTextFromODT(buffer);

    default:
      // Fallback: attempt UTF-8 text extraction
      return {
        content: buffer.toString('utf-8'),
        method: 'fallback',
      };
  }
}

/**
 * Extract text from file buffer with timeout and proper cancellation
 * INTEGRATED: Telemetry tracking for observability
 */
export async function extractTextFromFile(
  buffer: Buffer,
  fileName: string,
  mimeType?: string,
  options: ProcessingOptions = {}
): Promise<ProcessedFile> {
  const fileId = generateSafeFileId();
  const startTime = Date.now();
  const ext = getFileExtension(fileName);
  const sanitizedFileName = sanitizeFilename(fileName);

  // Start telemetry span
  const span = telemetry.startSpan('file.extraction', {
    extension: ext,
    sizeBytes: buffer.length,
    fileId
  });

  try {
    // Validate input
    await validateFileBuffer(buffer, fileName, options, mimeType);

    if (!validateFileType(fileName, mimeType)) {
      telemetry.incrementCounter('files_processed_total', {
        status: 'error',
        type: ext,
        error: 'INVALID_TYPE'
      });
      throw new FileValidationError(
        `Unsupported file type: ${ext}${mimeType ? ` (${mimeType})` : ''}`,
        'INVALID_TYPE',
        fileName
      );
    }

    // FIXED: Use safe file ID instead of filename in logs
    logger.info('Starting file text extraction', {
      fileId,
      extension: ext,
      mimeType,
      sizeBytes: buffer.length,
    });

    span.setAttribute('mimeType', mimeType || 'unknown');
    span.setAttribute('fileType', ext);

    // FIXED: Implement proper timeout with AbortController
    const timeoutMs = options.timeoutMs ?? DEFAULT_LIMITS.PROCESSING_TIMEOUT;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let result: ExtractionResult;
    try {
      result = await extractByFileType(buffer, ext, {
        ...options,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    // Validate extracted content
    const cleanedContent = cleanText(result.content);
    if (cleanedContent.length < DEFAULT_LIMITS.MIN_CONTENT_LENGTH) {
      telemetry.incrementCounter('files_processed_total', {
        status: 'error',
        type: ext,
        error: 'CONTENT_TOO_SHORT'
      });
      throw new FileProcessingError(
        'Extracted content is too short or empty',
        'EXTRACTION_FAILED',
        fileName
      );
    }

    // FIXED: Throw error instead of silently truncating
    if (cleanedContent.length > DEFAULT_LIMITS.MAX_CONTENT_LENGTH) {
      telemetry.incrementCounter('files_processed_total', {
        status: 'error',
        type: ext,
        error: 'CONTENT_TOO_LARGE'
      });
      throw new FileValidationError(
        `Content exceeds ${DEFAULT_LIMITS.MAX_CONTENT_LENGTH} characters (${cleanedContent.length}). Use chunked upload or split file.`,
        'CONTENT_TOO_LARGE',
        fileName
      );
    }

    const finalContent = cleanedContent; // No truncation
    const wordCount = estimateWordCount(finalContent);
    const processingTime = Date.now() - startTime;

    // Record success metrics
    telemetry.incrementCounter('files_processed_total', {
      status: 'success',
      type: ext
    });
    telemetry.recordHistogram('file_processing_duration_ms', processingTime, {
      file_type: ext
    });
    telemetry.recordHistogram('file_content_length_chars', finalContent.length, {
      file_type: ext
    });

    span.setAttribute('wordCount', wordCount);
    span.setAttribute('pageCount', result.pageCount || 0);
    span.setAttribute('extractionMethod', result.method);

    const metadata: FileMetadata = {
      fileName: sanitizedFileName, // Use sanitized name
      fileType: ext,
      processedAt: new Date().toISOString(),
      sizeBytes: buffer.length,
      extractionMethod: result.method,
      wordCount,
      ...(result.pageCount && { pageCount: result.pageCount }),
    };

    logger.info('File text extraction completed', {
      fileId,
      contentLength: finalContent.length,
      wordCount,
      processingTimeMs: processingTime,
      method: result.method,
    });

    return {
      content: finalContent,
      fileName: sanitizedFileName,
      fileType: ext,
      metadata,
    };
  } catch (error) {
    const processingTime = Date.now() - startTime;
    const err = toError(error);

    // Record error metrics
    telemetry.incrementCounter('files_processed_total', {
      status: 'error',
      type: ext,
      error: error instanceof FileValidationError || error instanceof FileProcessingError ? error.code : 'UNKNOWN'
    });
    telemetry.recordHistogram('file_processing_duration_ms', processingTime, {
      file_type: ext,
      status: 'error'
    });

    span.setAttribute('error', true);
    span.setAttribute('errorMessage', err.message);

    // FIXED: Preserve all error context
    logger.error('File text extraction failed', {
      fileId,
      extension: ext,
      error: err.message,
      stack: err.stack,
      processingTimeMs: processingTime,
      originalType: error?.constructor?.name,
      errorCode: error instanceof FileValidationError || error instanceof FileProcessingError ? error.code : undefined
    });

    if (error instanceof FileValidationError || error instanceof FileProcessingError) {
      throw error;
    }

    throw new FileProcessingError(
      `Failed to process file: ${err.message}`,
      'EXTRACTION_FAILED',
      fileName,
      err
    );
  } finally {
    span.end();
  }
}

// ============================================================================
// CHUNKING LOGIC
// ============================================================================

/**
 * Find the best break point for chunking (paragraph > sentence > word)
 */
function findBestBreakPoint(
  text: string,
  start: number,
  idealEnd: number,
  chunkSize: number
): number {
  const minBreakPoint = start + Math.floor(chunkSize * MIN_BREAK_POINT_RATIO);
  const searchStart = Math.max(start, idealEnd - Math.floor(chunkSize * BREAK_SEARCH_WINDOW_RATIO));

  // Priority 1: Paragraph break (double newline)
  const paragraphBreak = text.lastIndexOf('\n\n', idealEnd);
  if (paragraphBreak >= minBreakPoint && paragraphBreak >= searchStart) {
    return paragraphBreak + 2;
  }

  // Priority 2: Single newline
  const lineBreak = text.lastIndexOf('\n', idealEnd);
  if (lineBreak >= minBreakPoint && lineBreak >= searchStart) {
    return lineBreak + 1;
  }

  // Priority 3: Sentence boundary
  const sentenceEndings = ['. ', '! ', '? ', '.\n', '!\n', '?\n'];
  let bestSentenceBreak = -1;

  for (const ending of sentenceEndings) {
    const pos = text.lastIndexOf(ending, idealEnd);
    if (pos >= minBreakPoint && pos >= searchStart && pos > bestSentenceBreak) {
      bestSentenceBreak = pos + ending.length;
    }
  }

  if (bestSentenceBreak > -1) {
    return bestSentenceBreak;
  }

  // Priority 4: Word boundary (space)
  const wordBreak = text.lastIndexOf(' ', idealEnd);
  if (wordBreak >= minBreakPoint && wordBreak >= searchStart) {
    return wordBreak + 1;
  }

  // Fallback: hard break at idealEnd
  return idealEnd;
}

/**
 * Split text into chunks with intelligent boundary detection
 */
export function chunkText(
  text: string,
  options: ChunkingOptions = {}
): string[] {
  const chunkSize = options.chunkSize ?? 1000;
  const overlap = options.overlap ?? 200;
  const respectBoundaries = options.respectBoundaries ?? true;
  const minChunkSize = options.minChunkSize ?? Math.floor(chunkSize * MIN_CHUNK_SIZE_RATIO);

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);

    // Find intelligent break point if not at the end
    if (end < text.length && respectBoundaries) {
      const breakPoint = findBestBreakPoint(text, start, end, chunkSize);
      if (breakPoint > start + minChunkSize) {
        end = breakPoint;
      }
    }

    const chunk = text.substring(start, end).trim();

    // Only add non-empty chunks
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    // Move start position with overlap
    start = end - overlap;

    // Prevent infinite loop
    if (start <= 0 || start >= text.length) {
      break;
    }
  }

  return chunks;
}

// ============================================================================
// BATCH PROCESSING - Fixed with proper concurrency
// ============================================================================

/**
 * Batch process multiple files with true concurrency control
 * FIXED: Uses proper concurrency pool instead of sequential batches
 */
export async function processFileBatch(
  files: Array<{ buffer: Buffer; fileName: string; mimeType?: string }>,
  options: ProcessingOptions & { concurrency?: number } = {}
): Promise<Array<{ file: string; result?: ProcessedFile; error?: Error }>> {
  const concurrency = options.concurrency ?? 5;
  
  // Try to use p-limit if available (preferred)
  try {
    const pLimit = (await import('p-limit')).default;
    const limit = pLimit(concurrency);
    
    const results = await Promise.allSettled(
      files.map(file => limit(() => extractTextFromFile(file.buffer, file.fileName, file.mimeType, options)))
    );

    return results.map((result, index) => {
      const file = files[index];
      if (!file) {
        return { file: 'unknown', error: new Error('File not found in batch') };
      }
      if (result.status === 'fulfilled') {
        return { file: file.fileName, result: result.value };
      } else {
        return { file: file.fileName, error: result.reason };
      }
    });
  } catch {
    // Fallback to sequential batches if p-limit not available
    logger.warn('p-limit not available, using sequential batch processing (install p-limit for better performance)');
    
    const results: Array<{ file: string; result?: ProcessedFile; error?: Error }> = [];

    // Process files in batches
    for (let i = 0; i < files.length; i += concurrency) {
      const batch = files.slice(i, i + concurrency);

      const batchResults = await Promise.allSettled(
        batch.map((file) => extractTextFromFile(file.buffer, file.fileName, file.mimeType, options))
      );

      for (let j = 0; j < batchResults.length; j++) {
        const fileIndex = i + j;
        const result = batchResults[j];
        const file = files[fileIndex];

        if (!result || !file) {
          continue;
        }

        if (result.status === 'fulfilled') {
          results.push({ file: file.fileName, result: result.value });
        } else {
          results.push({ file: file.fileName, error: result.reason });
        }
      }
    }

    return results;
  }
}

// ============================================================================
// OBSERVABILITY HOOKS (Structure for telemetry integration)
// ============================================================================

/**
 * Telemetry interface for metrics and tracing
 * Applications can implement this to integrate with their observability stack
 */
export interface FileProcessorTelemetry {
  startSpan(name: string, attributes?: Record<string, unknown>): FileProcessorSpan;
  incrementCounter(name: string, labels?: Record<string, string>): void;
  recordHistogram(name: string, value: number, labels?: Record<string, string>): void;
}

export interface FileProcessorSpan {
  setAttribute(key: string, value: unknown): void;
  end(): void;
}

// Default no-op telemetry implementation
class NoOpTelemetry implements FileProcessorTelemetry {
  startSpan(): FileProcessorSpan {
    return {
      setAttribute: () => {},
      end: () => {}
    };
  }
  incrementCounter = () => {};
  recordHistogram = () => {};
}

let telemetry: FileProcessorTelemetry = new NoOpTelemetry();

/**
 * Set custom telemetry implementation
 */
export function setTelemetry(impl: FileProcessorTelemetry): void {
  telemetry = impl;
}

// Re-export ensureDependencies for convenience (already exported above)
