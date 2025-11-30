# Agent Knowledge Integration with AWS Bedrock Vector Search

This integration provides semantic search capabilities for knowledge bases using AWS Bedrock embeddings and Supabase vector storage.

## 🚀 Features

- **Vector Similarity Search**: Semantic search using AWS Bedrock embeddings
- **Hybrid Search**: Combines vector and text search for better results
- **Text Search Fallback**: Ensures results even when vector search fails
- **Multiple AWS Models**: Supports various AWS Bedrock embedding models
- **Batch Processing**: Efficient batch embedding generation
- **Automatic Fallback**: Graceful degradation when AWS is unavailable

## 📁 File Structure

```
src/integrations/agent_knowledge/
├── index.ts                    # Integration registration and exports
├── integration.ts              # Main integration logic and search functions
├── aws-embedding-service.ts    # AWS Bedrock embedding service (separate module)
├── test-aws-embedding.ts       # Test script for AWS configuration
└── README.md                   # This documentation
```

## ⚙️ Configuration

### Environment Variables

Add these to your `.env` file:

```bash
# AWS Access Credentials (Required)
AWS_ACCESS_KEY_ID=your_aws_access_key_here
AWS_SECRET_ACCESS_KEY=your_aws_secret_key_here
AWS_REGION=us-east-1

# AWS Embedding Model Configuration
# IMPORTANT: Use the EXACT same model that generated your stored embeddings
AWS_EMBEDDING_MODEL=amazon.titan-embed-text-v1
AWS_EMBEDDING_DIMENSIONS=1024
```

### Supported AWS Models

| Model | Dimensions | Use Case |
|-------|------------|----------|
| `amazon.titan-embed-text-v1` | 1536 | General text embedding |
| `amazon.titan-embed-text-v2` | 1024 | Improved performance |
| `cohere.embed-english-v3` | 1024 | English text |
| `cohere.embed-multilingual-v3` | 1024 | Multi-language |

### AWS IAM Permissions

Your AWS user/role needs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel"
      ],
      "Resource": "arn:aws:bedrock:*:*:model/amazon.titan-embed-text-v1"
    }
  ]
}
```

## 🔧 Usage

### Available Functions

| Function | Description | Parameters |
|----------|-------------|------------|
| `agent_knowledge.search` | **Recommended** - Semantic vector search | `{query, tableName, topK?}` |
| `agent_knowledge.retrieve` | Same as search, with optional query | `{query?, tableName, topK?}` |
| `agent_knowledge.searchContent` | Exact text matching | `{query, tableName, limit?}` |

### Example Usage in Workflows

```json
{
  "name": "Knowledge Base Search",
  "integrationName": "agent_knowledge",
  "operation": "search",
  "credentials": {
    "tableName": "mywebsitedata"
  },
  "description": "Search knowledge base for relevant information"
}
```

### Programmatic Usage

```typescript
import { awsEmbeddingService } from './aws-embedding-service';

// Generate single embedding
const embedding = await awsEmbeddingService.generateEmbedding("search query");

// Generate batch embeddings
const embeddings = await awsEmbeddingService.generateEmbeddings([
  "query 1",
  "query 2",
  "query 3"
]);

// Test connection
const isConnected = await awsEmbeddingService.testConnection();
```

## 🧪 Testing

### Run the Test Script

```bash
# Test your AWS configuration
npx ts-node src/integrations/agent_knowledge/test-aws-embedding.ts
```

### Expected Output

```
🚀 Testing AWS Bedrock Embedding Service...

📋 Configuration Check:
   Region: us-east-1
   Model: amazon.titan-embed-text-v1
   Dimensions: 1024
   Has Credentials: ✅

🔗 Connection Test:
   Connection: ✅ Success

🎯 Single Embedding Test:
   Query: "WhatsApp automation services"
   ✅ Success! Generated embedding in 150ms
   Dimensions: 1024
   First 5 values: [-0.047328, 0.006172, -0.017021, 0.010031, 0.023383...]

🎉 AWS Embedding Service test completed!
✅ Your AWS Bedrock embedding service is ready to use!
```

## 🔍 Search Strategy

The integration uses a three-layer search approach:

### 1. Vector Similarity Search (Primary)
- Generates AWS Bedrock embedding for the query
- Uses Supabase's `embedding <-> query_embedding` operator
- Returns semantically similar results

### 2. Hybrid Search (Fallback)
- Combines vector search (lower threshold) with text search
- Merges and ranks results from both methods
- Provides broader coverage

### 3. Text Search (Final Fallback)
- Exact phrase matching using `ILIKE`
- Word-based search for individual terms
- Synthetic similarity scoring

## 📊 Performance

### Typical Performance Metrics

| Operation | Time | Notes |
|-----------|------|-------|
| AWS Embedding Generation | 100-200ms | Depends on query length |
| Vector Search | 10-50ms | Supabase native operations |
| Total Search Time | 150-300ms | End-to-end |

### Cost Estimation

- **Amazon Titan Embed**: ~$0.0001 per 1K tokens
- **Typical search query**: 10-50 tokens
- **Cost per search**: ~$0.000001-0.000005 (very low cost)

## 🛠️ Architecture

### Data Flow

```
User Query
    ↓
AWS Bedrock Embedding Service
    ↓
Query Embedding (1024 dimensions)
    ↓
Supabase Vector Search
    ↓
Similarity Results
    ↓
Formatted Response to LLM
```

### Error Handling

1. **AWS Credentials Missing**: Falls back to text search
2. **AWS API Error**: Falls back to hybrid search
3. **Embedding Generation Fails**: Falls back to text search
4. **No Vector Results**: Tries hybrid search
5. **All Methods Fail**: Returns empty results with error message

## 🔧 Customization

### Custom AWS Service Instance

```typescript
import { AWSEmbeddingService } from './aws-embedding-service';

const customService = new AWSEmbeddingService({
  region: 'eu-west-1',
  model: 'cohere.embed-english-v3',
  dimensions: 1024
});
```

### Custom Search Parameters

```typescript
// In your workflow configuration
{
  "operation": "search",
  "credentials": {
    "tableName": "mydata",
    "topK": 10,
    "similarityThreshold": 0.7
  }
}
```

## 🐛 Troubleshooting

### Common Issues

1. **"AWS credentials not configured"**
   - Check `.env` file has `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`

2. **"AWS Bedrock API error: 403"**
   - Verify IAM permissions include `bedrock:InvokeModel`

3. **"Invalid embedding response format"**
   - Check model name is correct and available in your region

4. **"Dimension mismatch"**
   - Ensure `AWS_EMBEDDING_DIMENSIONS` matches your stored embeddings

### Debug Logging

Enable debug logging to see detailed search operations:

```bash
LOG_LEVEL=debug npm start
```

## 📝 License

This integration is part of the larger workflow system and follows the same licensing terms.
