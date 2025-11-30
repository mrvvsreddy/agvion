// path: src/utils/r2Uploader.ts

import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import logger from '../utils/logger';

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  endpoint: string;
  publicUrl: string | undefined;
}

interface UploadParams {
  bucket: string;
  key: string;
  content: string;
}

interface UploadResult {
  success: boolean;
  publicUrl?: string;
  error?: string;
}

/**
 * Get R2 configuration from environment variables
 */
function getR2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    return null;
  }

  // Construct endpoint URL if not explicitly provided
  const endpoint = process.env.R2_ENDPOINT || 
    `https://${accountId}.r2.cloudflarestorage.com`;

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    endpoint,
    publicUrl
  };
}

/**
 * Create S3-compatible client for R2
 */
function createR2Client(config: R2Config): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });
}

/**
 * Generate public URL for uploaded object
 */
function getPublicUrl(config: R2Config, bucket: string, key: string): string {
  // Special handling for webchat bucket agent config files
  // Remove "webchat/" from path: webchat/agent/config/* -> agent/config/*
  let urlKey = key;
  if (bucket === 'webchat' && key.startsWith('agent/config/')) {
    // Use key directly without bucket prefix
    urlKey = key;
  }
  
  if (config.publicUrl) {
    // Use R2.dev public URL if configured
    return `${config.publicUrl.replace(/\/$/, '')}/${urlKey}`;
  }
  
  // Fallback to custom domain or default pattern
  const customDomain = process.env.R2_CUSTOM_DOMAIN;
  if (customDomain) {
    return `${customDomain.replace(/\/$/, '')}/${urlKey}`;
  }
  
  // Default CDN pattern
  // For webchat bucket agent config files, exclude bucket from path
  if (bucket === 'webchat' && key.startsWith('agent/config/')) {
    return `https://cdn.agvion.com/${urlKey}`;
  }
  
  // Default CDN pattern for other files
  return `https://cdn.agvion.com/${bucket}/${key}`;
}

/**
 * Upload a JavaScript file to Cloudflare R2 using AWS SDK v3.
 * 
 * Environment variables required:
 * - R2_ACCOUNT_ID: Your Cloudflare account ID
 * - R2_ACCESS_KEY_ID: R2 API access key
 * - R2_SECRET_ACCESS_KEY: R2 API secret key
 * - R2_BUCKET_NAME: Target bucket name
 * - R2_ENDPOINT (optional): Custom endpoint URL
 * - R2_PUBLIC_URL (optional): R2.dev public URL
 * - R2_CUSTOM_DOMAIN (optional): Your custom domain for public access
 * 
 * @param params - Upload parameters
 * @returns Upload result with success status and public URL
 */
export async function uploadJsToR2(params: UploadParams): Promise<UploadResult> {
  try {
    const config = getR2Config();

    // Handle missing configuration gracefully
    if (!config) {
      logger.warn('R2 configuration incomplete; skipping upload', {
        hasAccountId: !!process.env.R2_ACCOUNT_ID,
        hasAccessKey: !!process.env.R2_ACCESS_KEY_ID,
        hasSecretKey: !!process.env.R2_SECRET_ACCESS_KEY,
        hasBucketName: !!process.env.R2_BUCKET_NAME
      });

      return {
        success: false,
        publicUrl: getPublicUrl(
          {
            accountId: '',
            accessKeyId: '',
            secretAccessKey: '',
            bucketName: params.bucket,
            endpoint: '',
            publicUrl: undefined
          },
          params.bucket,
          params.key
        ),
        error: 'R2 configuration not found'
      };
    }

    // Create S3-compatible client
    const client = createR2Client(config);

    // Prepare upload command
    const command = new PutObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      Body: params.content,
      ContentType: 'application/javascript',
      CacheControl: 'public, max-age=31536000, immutable', // 1 year cache for JS files
      Metadata: {
        uploadedAt: new Date().toISOString(),
        source: 'agvion-server'
      }
    });

    // Execute upload
    const response = await client.send(command);

    logger.info('R2 upload successful', {
      bucket: params.bucket,
      key: params.key,
      etag: response.ETag,
      versionId: response.VersionId
    });

    return {
      success: true,
      publicUrl: getPublicUrl(config, params.bucket, params.key)
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    logger.error('R2 upload failed', {
      bucket: params.bucket,
      key: params.key,
      error: errorMessage,
      errorType: error instanceof Error ? error.constructor.name : typeof error
    });

    return {
      success: false,
      publicUrl: getPublicUrl(
        {
          accountId: '',
          accessKeyId: '',
          secretAccessKey: '',
          bucketName: params.bucket,
          endpoint: '',
          publicUrl: ''
        },
        params.bucket,
        params.key
      ),
      error: errorMessage
    };
  }
}

/**
 * Upload generic content to R2 with custom content type
 */
export async function uploadToR2(params: {
  bucket: string;
  key: string;
  content: string | Buffer;
  contentType: string;
  metadata?: Record<string, string>;
}): Promise<UploadResult> {
  try {
    const config = getR2Config();

    if (!config) {
      logger.warn('R2 configuration incomplete; skipping upload');
      return {
        success: false,
        publicUrl: getPublicUrl(
          {
            accountId: '', accessKeyId: '', secretAccessKey: '', bucketName: params.bucket, endpoint: '',
            publicUrl: undefined
          },
          params.bucket,
          params.key
        ),
        error: 'R2 configuration not found'
      };
    }

    const client = createR2Client(config);

    const command = new PutObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      Body: params.content,
      ContentType: params.contentType,
      CacheControl: 'public, max-age=31536000',
      Metadata: {
        ...params.metadata,
        uploadedAt: new Date().toISOString()
      }
    });

    await client.send(command);

    logger.info('R2 upload successful', {
      bucket: params.bucket,
      key: params.key,
      contentType: params.contentType
    });

    return {
      success: true,
      publicUrl: getPublicUrl(config, params.bucket, params.key)
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    logger.error('R2 upload failed', {
      bucket: params.bucket,
      key: params.key,
      error: errorMessage
    });

    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Format timestamp for file naming
 */
export function formatTimestamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const HH = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}${MM}${dd}${HH}${mm}${ss}`;
}

/**
 * Delete a single object from R2
 */
export async function deleteFromR2(params: {
  bucket: string;
  key: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const config = getR2Config();

    if (!config) {
      logger.warn('R2 configuration incomplete; skipping deletion');
      return {
        success: false,
        error: 'R2 configuration not found'
      };
    }

    const client = createR2Client(config);

    const command = new DeleteObjectCommand({
      Bucket: params.bucket,
      Key: params.key
    });

    await client.send(command);

    logger.info('R2 deletion successful', {
      bucket: params.bucket,
      key: params.key
    });

    return {
      success: true
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    logger.error('R2 deletion failed', {
      bucket: params.bucket,
      key: params.key,
      error: errorMessage
    });

    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Delete all agent config files for a given agent ID from R2
 * Searches for files matching pattern: agent/config/*-{agentId}.js
 */
export async function deleteAgentConfigFiles(agentId: string): Promise<{
  success: boolean;
  deletedCount: number;
  errors?: string[];
}> {
  try {
    const config = getR2Config();

    if (!config) {
      logger.warn('R2 configuration incomplete; skipping agent config file deletion');
      return {
        success: false,
        deletedCount: 0,
        errors: ['R2 configuration not found']
      };
    }

    const client = createR2Client(config);
    const bucket = 'webchat';
    const prefix = 'agent/config/';

    // List all files with the agent/config/ prefix
    const listCommand = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix
    });

    const listResponse = await client.send(listCommand);
    const objects = listResponse.Contents || [];

    // Filter files that match the agent ID pattern: *-{agentId}.js
    const agentFiles = objects.filter(obj => 
      obj.Key && obj.Key.endsWith(`-${agentId}.js`)
    );

    if (agentFiles.length === 0) {
      logger.info('No agent config files found to delete', { agentId, bucket, prefix });
      return {
        success: true,
        deletedCount: 0
      };
    }

    // Delete all matching files
    const deleteResults = await Promise.allSettled(
      agentFiles.map(file => 
        deleteFromR2({
          bucket,
          key: file.Key!
        })
      )
    );

    const errors: string[] = [];
    let deletedCount = 0;

    deleteResults.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.success) {
        deletedCount++;
      } else {
        const error = result.status === 'rejected' 
          ? result.reason?.message || 'Unknown error'
          : result.value.error || 'Unknown error';
        errors.push(`Failed to delete ${agentFiles[index]?.Key}: ${error}`);
      }
    });

    if (errors.length > 0) {
      logger.warn('Some agent config files failed to delete', {
        agentId,
        deletedCount,
        totalFiles: agentFiles.length,
        errors
      });
    } else {
      logger.info('All agent config files deleted successfully', {
        agentId,
        deletedCount,
        files: agentFiles.map(f => f.Key)
      });
    }

    return {
      success: deletedCount > 0 || errors.length === 0,
      deletedCount,
      ...(errors.length > 0 && { errors })
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    logger.error('Failed to delete agent config files', {
      agentId,
      error: errorMessage
    });

    return {
      success: false,
      deletedCount: 0,
      errors: [errorMessage]
    };
  }
}

/**
 * Verify R2 connection and configuration
 */
export async function verifyR2Connection(): Promise<boolean> {
  try {
    const config = getR2Config();
    if (!config) {
      logger.warn('R2 configuration not found');
      return false;
    }

    const client = createR2Client(config);
    
    // Test with a small HEAD request (doesn't upload anything)
    const { HeadBucketCommand } = await import('@aws-sdk/client-s3');
    await client.send(new HeadBucketCommand({ Bucket: config.bucketName }));
    
    logger.info('R2 connection verified successfully', {
      bucket: config.bucketName,
      endpoint: config.endpoint
    });
    
    return true;
  } catch (error) {
    logger.error('R2 connection verification failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return false;
  }
}