// path: src/integrations/agent_knowledge/aws-embedding-service.ts
// AWS Bedrock Embedding Service for Knowledge Base Search

import logger from '../../utils/logger';

/**
 * AWS Bedrock Embedding Service Configuration
 */
interface AWSEmbeddingConfig {
  accessKey: string;
  secretKey: string;
  region: string;
  model: string;
  dimensions: number;
}

/**
 * AWS Bedrock Embedding Service
 * Handles embedding generation using AWS Bedrock models
 */
export class AWSEmbeddingService {
  private config: AWSEmbeddingConfig;

  constructor(config?: Partial<AWSEmbeddingConfig>) {
    this.config = {
      accessKey: config?.accessKey 
        || process.env.AWS_BEDROCK_ACCESS_KEY_ID
        || '',
      secretKey: config?.secretKey 
        || process.env.AWS_BEDROCK_SECRET_ACCESS_KEY 
        || '',
      region: config?.region || process.env.AWS_REGION || 'ap-south-1',
      model: config?.model || process.env.AWS_EMBEDDING_MODEL || 'amazon.titan-embed-text-v2:0',
      dimensions: config?.dimensions || parseInt(process.env.AWS_EMBEDDING_DIMENSIONS || '1024')
    };
  }

  /**
   * Check if AWS credentials are properly configured
   */
  isConfigured(): boolean {
    return !!(this.config.accessKey && this.config.secretKey);
  }

  /**
   * Get current configuration (without exposing secrets)
   */
  getConfig() {
    return {
      region: this.config.region,
      model: this.config.model,
      dimensions: this.config.dimensions,
      hasCredentials: this.isConfigured()
    };
  }

  /**
   * Generate embedding for text using AWS Bedrock
   */
  async generateEmbedding(text: string): Promise<number[] | null> {
    if (!this.isConfigured()) {
      logger.warn('AWS credentials not configured for embedding service');
      return null;
    }

    try {
      logger.debug('Generating AWS Bedrock embedding', {
        textLength: text.length,
        model: this.config.model,
        dimensions: this.config.dimensions,
        region: this.config.region
      });

      const embedding = await this.callBedrockAPI(text.trim());

      if (!embedding) {
        throw new Error('Failed to generate embedding from AWS Bedrock');
      }

      logger.debug('AWS embedding generated successfully', {
        embeddingLength: embedding.length,
        model: this.config.model,
        dimensions: this.config.dimensions
      });

      return embedding;

    } catch (error) {
      logger.error('AWS embedding generation failed', {
        error: error instanceof Error ? error.message : String(error),
        model: this.config.model,
        textLength: text.length
      });
      return null;
    }
  }

  /**
   * Generate embeddings for multiple texts (batch processing)
   * DEPRECATED: Use generateEmbeddingsBatch for production-safe controlled concurrency
   */
  async generateEmbeddings(texts: string[]): Promise<(number[] | null)[]> {
    if (!this.isConfigured()) {
      logger.warn('AWS credentials not configured for batch embedding service');
      return texts.map(() => null);
    }

    logger.info('Generating batch AWS embeddings', {
      count: texts.length,
      model: this.config.model
    });

    const results = await Promise.all(
      texts.map(text => this.generateEmbedding(text))
    );

    const successCount = results.filter(r => r !== null).length;
    logger.info('Batch embedding generation completed', {
      total: texts.length,
      successful: successCount,
      failed: texts.length - successCount
    });

    return results;
  }

  /**
   * Generate embeddings with controlled concurrency (PRODUCTION-SAFE)
   * Processes texts in small batches to prevent memory exhaustion
   * 
   * @param texts - Array of text chunks to embed
   * @param batchSize - Max concurrent AWS API calls (default: 5)
   * @returns Array of embeddings (null for failures)
   */
  async generateEmbeddingsBatch(
    texts: string[], 
    batchSize: number = 5
  ): Promise<(number[] | null)[]> {
    if (!this.isConfigured()) {
      logger.warn('AWS credentials not configured for batch embedding service');
      return texts.map(() => null);
    }

    if (texts.length === 0) {
      return [];
    }

    logger.info('Starting controlled batch embedding generation', {
      totalTexts: texts.length,
      batchSize,
      estimatedBatches: Math.ceil(texts.length / batchSize),
      model: this.config.model
    });

    const allResults: (number[] | null)[] = [];
    let successCount = 0;
    let failureCount = 0;

    // Process in controlled batches
    for (let i = 0; i < texts.length; i += batchSize) {
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(texts.length / batchSize);
      const batch = texts.slice(i, i + batchSize);

      logger.debug('Processing embedding batch', {
        batchNumber,
        totalBatches,
        batchStart: i,
        batchSize: batch.length,
        progress: `${i + batch.length}/${texts.length}`
      });

      try {
        // Process batch with Promise.all (limited concurrency)
        const batchResults = await Promise.all(
          batch.map(async (text, idx) => {
            try {
              const embedding = await this.generateEmbedding(text);
              if (embedding) {
                successCount++;
              } else {
                failureCount++;
              }
              return embedding;
            } catch (error) {
              logger.error('Individual embedding failed in batch', {
                batchNumber,
                textIndex: i + idx,
                error: error instanceof Error ? error.message : String(error)
              });
              failureCount++;
              return null;
            }
          })
        );

        allResults.push(...batchResults);

        // Log batch completion
        logger.debug('Batch embedding completed', {
          batchNumber,
          totalBatches,
          batchSuccess: batchResults.filter(r => r !== null).length,
          batchFailures: batchResults.filter(r => r === null).length,
          overallProgress: `${allResults.length}/${texts.length}`
        });

        // Allow event loop to process between batches
        await new Promise(resolve => setImmediate(resolve));

        // Explicit garbage collection hint (if enabled with --expose-gc)
        if ((global as any).gc && batchNumber % 5 === 0) {
          const heapBefore = process.memoryUsage().heapUsed / 1024 / 1024;
          (global as any).gc();
          const heapAfter = process.memoryUsage().heapUsed / 1024 / 1024;
          logger.debug('Garbage collection executed', {
            batchNumber,
            heapBeforeMB: heapBefore.toFixed(2),
            heapAfterMB: heapAfter.toFixed(2),
            freedMB: (heapBefore - heapAfter).toFixed(2)
          });
        }
      } catch (error) {
        // Batch-level error (shouldn't happen with individual try-catch, but defensive)
        logger.error('Batch embedding failed catastrophically', {
          batchNumber,
          totalBatches,
          batchStart: i,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
        // Mark entire batch as failed
        const nullResults = new Array(batch.length).fill(null);
        allResults.push(...nullResults);
        failureCount += batch.length;
      }
    }

    logger.info('Batch embedding generation completed', {
      totalTexts: texts.length,
      successful: successCount,
      failed: failureCount,
      successRate: `${((successCount / texts.length) * 100).toFixed(1)}%`,
      model: this.config.model
    });

    return allResults;
  }

  /**
   * Call AWS Bedrock API with proper authentication
   */
  private async callBedrockAPI(text: string): Promise<number[] | null> {
    try {
      // Use AWS SDK for Bedrock instead of manual signing
      const { BedrockRuntimeClient, InvokeModelCommand } = await import("@aws-sdk/client-bedrock-runtime");

      const client = new BedrockRuntimeClient({
        region: this.config.region,
        credentials: {
          accessKeyId: this.config.accessKey,
          secretAccessKey: this.config.secretKey,
        },
      });

      const payload = JSON.stringify({
        inputText: text.trim(),
      });

      const command = new InvokeModelCommand({
        modelId: this.config.model,
        body: payload,
        contentType: "application/json",
        accept: "application/json",
      });

      const response = await client.send(command);
      const raw = new TextDecoder().decode(response.body as any);
      const data = JSON.parse(raw);
      return this.extractEmbeddingFromResponse(data);

    } catch (error) {
      logger.error('AWS Bedrock API call failed', {
        error: error instanceof Error ? error.message : String(error),
        model: this.config.model,
        region: this.config.region
      });
      return null;
    }
  }

  /**
   * Create model-specific payload for different AWS embedding models
   */
  private createModelPayload(text: string): string {
    const modelFamily = this.config.model.split('.')[0];
    
    switch (modelFamily) {
      case 'amazon':
        // Amazon Titan models
        return JSON.stringify({
          inputText: text,
          dimensions: this.config.dimensions
        });
        
      case 'cohere':
        // Cohere models
        return JSON.stringify({
          texts: [text],
          input_type: 'search_query',
          embedding_types: ['float']
        });
        
      case 'anthropic':
        // Anthropic models (if they support embeddings)
        return JSON.stringify({
          input: text,
          model: this.config.model
        });
        
      default:
        // Default format (works for most models)
        return JSON.stringify({
          inputText: text,
          dimensions: this.config.dimensions
        });
    }
  }

  /**
   * Extract embedding from model-specific response format
   */
  private extractEmbeddingFromResponse(data: any): number[] | null {
    let embedding: number[] | null = null;
    
    // Try different response formats based on model
    if (data.embedding && Array.isArray(data.embedding)) {
      // Amazon Titan format
      embedding = data.embedding;
    } else if (data.embeddings && Array.isArray(data.embeddings) && data.embeddings[0]) {
      // Cohere format
      embedding = data.embeddings[0];
    } else if (data.vector && Array.isArray(data.vector)) {
      // Alternative format
      embedding = data.vector;
    } else if (data.data && Array.isArray(data.data) && data.data[0]?.embedding) {
      // OpenAI-like format
      embedding = data.data[0].embedding;
    }
    
    // Validate embedding
    if (!embedding || !Array.isArray(embedding)) {
      logger.error('Invalid embedding response format', {
        responseKeys: Object.keys(data),
        model: this.config.model
      });
      return null;
    }

    // Validate dimensions
    if (embedding.length !== this.config.dimensions) {
      logger.warn('Embedding dimension mismatch', {
        expected: this.config.dimensions,
        actual: embedding.length,
        model: this.config.model
      });
      // Don't return null, just log warning - some models may have flexible dimensions
    }

    return embedding;
  }

  /**
   * Generate AWS Signature V4 signing key
   */
  private getSignatureKey(key: string, dateStamp: string, regionName: string, serviceName: string): Buffer {
    const crypto = require('crypto');
    const kDate = crypto.createHmac('sha256', 'AWS4' + key).update(dateStamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(regionName).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(serviceName).digest();
    const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
    return kSigning;
  }

  /**
   * Test the AWS connection and model
   */
  async testConnection(): Promise<boolean> {
    if (!this.isConfigured()) {
      logger.error('AWS credentials not configured for connection test');
      return false;
    }

    try {
      logger.info('Testing AWS Bedrock connection', {
        model: this.config.model,
        region: this.config.region
      });

      const testEmbedding = await this.generateEmbedding('test connection');
      
      if (testEmbedding && testEmbedding.length > 0) {
        logger.info('AWS Bedrock connection test successful', {
          model: this.config.model,
          dimensions: testEmbedding.length
        });
        return true;
      } else {
        logger.error('AWS Bedrock connection test failed - no embedding returned');
        return false;
      }
    } catch (error) {
      logger.error('AWS Bedrock connection test failed', {
        error: error instanceof Error ? error.message : String(error),
        model: this.config.model
      });
      return false;
    }
  }
}

// Export singleton instance
export const awsEmbeddingService = new AWSEmbeddingService();

// Export class for custom instances
export default AWSEmbeddingService;
