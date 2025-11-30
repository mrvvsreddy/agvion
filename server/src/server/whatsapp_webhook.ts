// server/whatsapp_webhook.ts
import express, { Request, Response } from 'express';
import logger from '../utils/logger';

const app = express();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req: Request, res: Response, next) => {
  logger.info('WhatsApp Webhook Request', {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });
  next();
});

// WhatsApp Business API webhook verification endpoint
app.get('/webhook', async (req: Request, res: Response) => {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    logger.info('Webhook verification request', {
      mode,
      token: token ? '***' : 'missing',
      challenge: challenge ? '***' : 'missing'
    });

    // Check if mode and token are correct
    if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
      logger.info('Webhook verification successful');
      res.status(200).send(challenge);
    } else {
      logger.warn('Webhook verification failed', {
        mode,
        tokenMatch: token === process.env.WEBHOOK_VERIFY_TOKEN,
        hasVerifyToken: !!process.env.WEBHOOK_VERIFY_TOKEN
      });
      res.status(403).send('Forbidden');
    }
  } catch (error) {
    logger.error('Webhook verification error', { error });
    res.status(500).send('Internal Server Error');
  }
});

// WhatsApp Business API webhook message endpoint
app.post('/webhook', async (req: Request, res: Response) => {
  try {
    const body = req.body;
    
    logger.info('Webhook message received', {
      body: JSON.stringify(body, null, 2),
      headers: {
        'content-type': req.get('content-type'),
        'user-agent': req.get('user-agent'),
        'x-hub-signature-256': req.get('x-hub-signature-256')
      }
    });

    // Verify webhook signature if configured
    const signature = req.get('x-hub-signature-256');
    if (process.env.WEBHOOK_SECRET && signature) {
      // TODO: Implement signature verification
      logger.info('Webhook signature verification would be implemented here');
    }

    // Process the webhook data
    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field === 'messages') {
            logger.info('Processing message change', {
              entryId: entry.id,
              changeValue: change.value
            });

            // Process messages
            const messages = change.value.messages || [];
            for (const message of messages) {
              logger.info('Processing message', {
                messageId: message.id,
                from: message.from,
                timestamp: message.timestamp,
                type: message.type
              });

              // TODO: Process the message based on type
              await processMessage(message, change.value);
            }

            // Process status updates
            const statuses = change.value.statuses || [];
            for (const status of statuses) {
              logger.info('Processing status update', {
                messageId: status.id,
                status: status.status,
                timestamp: status.timestamp,
                recipientId: status.recipient_id
              });

              // TODO: Process status updates
              await processStatusUpdate(status, change.value);
            }
          }
        }
      }
    }

    // Always respond with 200 OK to acknowledge receipt
    res.status(200).send('OK');
  } catch (error) {
    logger.error('Webhook message processing error', { error });
    res.status(500).send('Internal Server Error');
  }
});

// Process incoming messages
async function processMessage(message: any, webhookData: any): Promise<void> {
  try {
    logger.info('Processing message', {
      messageId: message.id,
      from: message.from,
      type: message.type,
      timestamp: message.timestamp
    });

    // Handle different message types
    switch (message.type) {
      case 'text':
        await handleTextMessage(message, webhookData);
        break;
      case 'image':
        await handleImageMessage(message, webhookData);
        break;
      case 'document':
        await handleDocumentMessage(message, webhookData);
        break;
      case 'audio':
        await handleAudioMessage(message, webhookData);
        break;
      case 'video':
        await handleVideoMessage(message, webhookData);
        break;
      case 'sticker':
        await handleStickerMessage(message, webhookData);
        break;
      case 'location':
        await handleLocationMessage(message, webhookData);
        break;
      case 'contacts':
        await handleContactsMessage(message, webhookData);
        break;
      case 'interactive':
        await handleInteractiveMessage(message, webhookData);
        break;
      default:
        logger.warn('Unknown message type', { type: message.type });
    }
  } catch (error) {
    logger.error('Error processing message', { error, messageId: message.id });
  }
}

// Handle text messages
async function handleTextMessage(message: any, webhookData: any): Promise<void> {
  logger.info('Handling text message', {
    messageId: message.id,
    text: message.text?.body,
    from: message.from
  });

  // TODO: Implement text message processing logic
  // This could include:
  // - Finding matching workflows
  // - Triggering workflow execution
  // - Storing message data
}

// Handle image messages
async function handleImageMessage(message: any, webhookData: any): Promise<void> {
  logger.info('Handling image message', {
    messageId: message.id,
    imageId: message.image?.id,
    from: message.from
  });

  // TODO: Implement image message processing logic
}

// Handle document messages
async function handleDocumentMessage(message: any, webhookData: any): Promise<void> {
  logger.info('Handling document message', {
    messageId: message.id,
    documentId: message.document?.id,
    filename: message.document?.filename,
    from: message.from
  });

  // TODO: Implement document message processing logic
}

// Handle audio messages
async function handleAudioMessage(message: any, webhookData: any): Promise<void> {
  logger.info('Handling audio message', {
    messageId: message.id,
    audioId: message.audio?.id,
    from: message.from
  });

  // TODO: Implement audio message processing logic
}

// Handle video messages
async function handleVideoMessage(message: any, webhookData: any): Promise<void> {
  logger.info('Handling video message', {
    messageId: message.id,
    videoId: message.video?.id,
    from: message.from
  });

  // TODO: Implement video message processing logic
}

// Handle sticker messages
async function handleStickerMessage(message: any, webhookData: any): Promise<void> {
  logger.info('Handling sticker message', {
    messageId: message.id,
    stickerId: message.sticker?.id,
    from: message.from
  });

  // TODO: Implement sticker message processing logic
}

// Handle location messages
async function handleLocationMessage(message: any, webhookData: any): Promise<void> {
  logger.info('Handling location message', {
    messageId: message.id,
    latitude: message.location?.latitude,
    longitude: message.location?.longitude,
    from: message.from
  });

  // TODO: Implement location message processing logic
}

// Handle contacts messages
async function handleContactsMessage(message: any, webhookData: any): Promise<void> {
  logger.info('Handling contacts message', {
    messageId: message.id,
    contactCount: message.contacts?.length,
    from: message.from
  });

  // TODO: Implement contacts message processing logic
}

// Handle interactive messages (buttons, lists, etc.)
async function handleInteractiveMessage(message: any, webhookData: any): Promise<void> {
  logger.info('Handling interactive message', {
    messageId: message.id,
    interactiveType: message.interactive?.type,
    from: message.from
  });

  // TODO: Implement interactive message processing logic
}

// Process status updates
async function processStatusUpdate(status: any, webhookData: any): Promise<void> {
  try {
    logger.info('Processing status update', {
      messageId: status.id,
      status: status.status,
      timestamp: status.timestamp,
      recipientId: status.recipient_id
    });

    // TODO: Implement status update processing logic
    // This could include:
    // - Updating message delivery status
    // - Triggering follow-up actions
    // - Logging delivery metrics
  } catch (error) {
    logger.error('Error processing status update', { error, messageId: status.id });
  }
}

// Error handling middleware
app.use((error: Error, req: Request, res: Response, next: any) => {
  logger.error('WhatsApp Webhook Error', { 
    error: error.message, 
    stack: error.stack,
    url: req.url,
    method: req.method 
  });
  
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not found',
    message: `Route ${req.method} ${req.url} not found`,
  });
});

export default app;
