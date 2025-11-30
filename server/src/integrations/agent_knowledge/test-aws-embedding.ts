// path: src/integrations/agent_knowledge/test-aws-embedding.ts
// Test script for AWS Bedrock Embedding Service

import { AWSEmbeddingService, awsEmbeddingService } from './aws-embedding-service';
import logger from '../../utils/logger';

/**
 * Test the AWS Embedding Service
 * Run this script to verify your AWS configuration
 */
async function testAWSEmbeddingService() {
  console.log('🚀 Testing AWS Bedrock Embedding Service...\n');

  // Test 1: Check configuration
  console.log('📋 Configuration Check:');
  const config = awsEmbeddingService.getConfig();
  console.log(`   Region: ${config.region}`);
  console.log(`   Model: ${config.model}`);
  console.log(`   Dimensions: ${config.dimensions}`);
  console.log(`   Has Credentials: ${config.hasCredentials ? '✅' : '❌'}\n`);

  if (!config.hasCredentials) {
    console.log('❌ AWS credentials not configured. Please check your .env file.\n');
    console.log('Required environment variables:');
    console.log('   - AWS_ACCESS_KEY_ID');
    console.log('   - AWS_SECRET_ACCESS_KEY');
    console.log('   - AWS_REGION (optional, defaults to us-east-1)');
    console.log('   - AWS_EMBEDDING_MODEL (optional, defaults to amazon.titan-embed-text-v1)');
    console.log('   - AWS_EMBEDDING_DIMENSIONS (optional, defaults to 1024)');
    return;
  }

  // Test 2: Connection test
  console.log('🔗 Connection Test:');
  const connectionSuccess = await awsEmbeddingService.testConnection();
  console.log(`   Connection: ${connectionSuccess ? '✅ Success' : '❌ Failed'}\n`);

  if (!connectionSuccess) {
    console.log('❌ Connection test failed. Please check:');
    console.log('   - AWS credentials are correct');
    console.log('   - AWS region is correct');
    console.log('   - Model name is correct and available in your region');
    console.log('   - IAM permissions include bedrock:InvokeModel');
    return;
  }

  // Test 3: Single embedding generation
  console.log('🎯 Single Embedding Test:');
  const testQuery = 'WhatsApp automation services';
  console.log(`   Query: "${testQuery}"`);
  
  const startTime = Date.now();
  const embedding = await awsEmbeddingService.generateEmbedding(testQuery);
  const duration = Date.now() - startTime;
  
  if (embedding) {
    console.log(`   ✅ Success! Generated embedding in ${duration}ms`);
    console.log(`   Dimensions: ${embedding.length}`);
    console.log(`   First 5 values: [${embedding.slice(0, 5).map(v => v.toFixed(6)).join(', ')}...]`);
  } else {
    console.log('   ❌ Failed to generate embedding');
  }
  console.log('');

  // Test 4: Batch embedding generation
  console.log('📦 Batch Embedding Test:');
  const testQueries = [
    'customer support automation',
    'WhatsApp business integration',
    'digital marketing solutions'
  ];
  console.log(`   Queries: ${testQueries.length} items`);
  
  const batchStartTime = Date.now();
  const embeddings = await awsEmbeddingService.generateEmbeddings(testQueries);
  const batchDuration = Date.now() - batchStartTime;
  
  const successCount = embeddings.filter(e => e !== null).length;
  console.log(`   ✅ Generated ${successCount}/${testQueries.length} embeddings in ${batchDuration}ms`);
  console.log(`   Average time per embedding: ${Math.round(batchDuration / testQueries.length)}ms`);
  console.log('');

  // Test 5: Custom configuration
  console.log('⚙️  Custom Configuration Test:');
  const customService = new AWSEmbeddingService({
    model: 'amazon.titan-embed-text-v1',
    dimensions: 1536
  });
  
  const customConfig = customService.getConfig();
  console.log(`   Custom Model: ${customConfig.model}`);
  console.log(`   Custom Dimensions: ${customConfig.dimensions}`);
  console.log(`   Has Credentials: ${customConfig.hasCredentials ? '✅' : '❌'}`);
  console.log('');

  console.log('🎉 AWS Embedding Service test completed!\n');
  
  if (connectionSuccess && embedding) {
    console.log('✅ Your AWS Bedrock embedding service is ready to use!');
    console.log('   You can now use vector search in your knowledge base.');
  } else {
    console.log('❌ Please fix the issues above before using vector search.');
  }
}

/**
 * Run the test if this file is executed directly
 */
if (require.main === module) {
  testAWSEmbeddingService().catch(error => {
    console.error('Test failed with error:', error);
    process.exit(1);
  });
}

export { testAWSEmbeddingService };
