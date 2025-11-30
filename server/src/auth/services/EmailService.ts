// auth/services/EmailService.ts
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import logger from '../../utils/logger';
import fs from 'fs';
import path from 'path';

export interface EmailTemplate {
  subject: string;
  htmlBody: string;
  textBody: string;
}

export class EmailService {
  private static instance: EmailService;
  private sesClient: SESClient;
  private fromEmail: string;
  private fromName: string;

  private constructor() {
    const region = process.env.AWS_REGION || 'us-east-1';
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

    if (!accessKeyId || !secretAccessKey) {
      throw new Error('AWS credentials not configured. Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.');
    }

    this.sesClient = new SESClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    this.fromEmail = process.env.FROM_EMAIL || 'hello@agvion.com';
    this.fromName = process.env.FROM_NAME || 'agvion';

    logger.info('AWS SES Email Service initialized', { region, fromEmail: this.fromEmail });
  }

  public static getInstance(): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService();
    }
    return EmailService.instance;
  }

  private generateVerificationEmailTemplate(code: string, firstName: string): EmailTemplate {
    // Inline template to avoid spam filters - professional, clean design
    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Email Verification</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #333333; font-size: 24px; margin: 0;">Welcome to Our Platform</h1>
        </div>
        
        <div style="margin-bottom: 30px;">
            <p style="color: #666666; font-size: 16px; line-height: 1.5; margin: 0;">
                Hello ${firstName},
            </p>
            <p style="color: #666666; font-size: 16px; line-height: 1.5; margin: 10px 0;">
                Thank you for signing up! To complete your account setup, please use the verification code below:
            </p>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
            <div style="background-color: #f8f9fa; border: 2px solid #e9ecef; border-radius: 8px; padding: 20px; display: inline-block;">
                <span style="font-size: 32px; font-weight: bold; color: #007bff; letter-spacing: 4px; font-family: monospace;">${code}</span>
            </div>
        </div>
        
        <div style="margin-bottom: 30px;">
            <p style="color: #666666; font-size: 14px; line-height: 1.5; margin: 0;">
                This code will expire in 15 minutes for security reasons.
            </p>
            <p style="color: #666666; font-size: 14px; line-height: 1.5; margin: 10px 0;">
                If you didn't request this verification, please ignore this email.
            </p>
        </div>
        
        <div style="border-top: 1px solid #e9ecef; padding-top: 20px; text-align: center;">
            <p style="color: #999999; font-size: 12px; margin: 0;">
                This is an automated message. Please do not reply to this email.
            </p>
        </div>
    </div>
</body>
</html>`;

    const textBody = `
Welcome to Our Platform

Hello ${firstName},

Thank you for signing up! To complete your account setup, please use the verification code below:

Verification Code: ${code}

This code will expire in 15 minutes for security reasons.

If you didn't request this verification, please ignore this email.

This is an automated message. Please do not reply to this email.
`;

    return {
      subject: 'Complete Your Account Setup',
      htmlBody,
      textBody
    };
  }

  private generatePasswordResetEmailTemplate(resetLink: string, firstName: string): EmailTemplate {
    const templatesDir = path.resolve(__dirname, '../templates');
    const htmlPath = path.join(templatesDir, 'reset.html');
    const textPath = path.join(templatesDir, 'reset.txt');
    let htmlBody = fs.readFileSync(htmlPath, 'utf8');
    let textBody = fs.readFileSync(textPath, 'utf8');
    htmlBody = htmlBody.replace(/{{firstName}}/g, firstName).replace(/{{resetLink}}/g, resetLink);
    textBody = textBody.replace(/{{firstName}}/g, firstName).replace(/{{resetLink}}/g, resetLink);
    return { subject: 'Reset Your Password', htmlBody, textBody };
  }

  public async sendVerificationEmail(email: string, code: string, firstName: string): Promise<boolean> {
    try {
      const template = this.generateVerificationEmailTemplate(code, firstName);

      const command = new SendEmailCommand({
        Source: `${this.fromName} <${this.fromEmail}>`,
        Destination: {
          ToAddresses: [email],
        },
        Message: {
          Subject: {
            Data: template.subject,
            Charset: 'UTF-8',
          },
          Body: {
            Html: {
              Data: template.htmlBody,
              Charset: 'UTF-8',
            },
            Text: {
              Data: template.textBody,
              Charset: 'UTF-8',
            },
          },
        },
      });

      const result = await this.sesClient.send(command);
      logger.info('Verification email sent successfully', {
        email,
        messageId: result.MessageId,
        code: code.substring(0, 2) + '****' // Log partial code for debugging
      });

      return true;
    } catch (error) {
      logger.error('Failed to send verification email', { error, email });
      throw error;
    }
  }

  public async sendPasswordResetEmail(email: string, resetLink: string, firstName: string): Promise<boolean> {
    try {
      const template = this.generatePasswordResetEmailTemplate(resetLink, firstName);

      const command = new SendEmailCommand({
        Source: `${this.fromName} <${this.fromEmail}>`,
        Destination: {
          ToAddresses: [email],
        },
        Message: {
          Subject: {
            Data: template.subject,
            Charset: 'UTF-8',
          },
          Body: {
            Html: {
              Data: template.htmlBody,
              Charset: 'UTF-8',
            },
            Text: {
              Data: template.textBody,
              Charset: 'UTF-8',
            },
          },
        },
      });

      const result = await this.sesClient.send(command);
      logger.info('Password reset email sent successfully', {
        email,
        messageId: result.MessageId
      });

      return true;
    } catch (error) {
      logger.error('Failed to send password reset email', { error, email });
      throw error;
    }
  }

  public async sendWelcomeEmail(email: string, firstName: string): Promise<boolean> {
    try {
      const template = {
        subject: 'Welcome to Our Platform!',
        htmlBody: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Welcome</title>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
              .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
              .button { display: inline-block; background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 10px 0; }
              .footer { text-align: center; margin-top: 20px; color: #666; font-size: 14px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>Welcome ${firstName}!</h1>
                <p>Your account has been successfully created</p>
              </div>
              <div class="content">
                <p>Thank you for joining us! Your email has been verified and your account is now active.</p>
                
                <p>You can now:</p>
                <ul>
                  <li>Access all features of our platform</li>
                  <li>Create and manage your workflows</li>
                  <li>Connect your integrations</li>
                  <li>Invite team members</li>
                </ul>
                
                <p>If you have any questions, feel free to reach out to our support team.</p>
                
                <p>Best regards,<br>The Team</p>
              </div>
              <div class="footer">
                <p>This is an automated message. Please do not reply to this email.</p>
              </div>
            </div>
          </body>
          </html>
        `,
        textBody: `
          Welcome ${firstName}!
          
          Thank you for joining us! Your email has been verified and your account is now active.
          
          You can now:
          - Access all features of our platform
          - Create and manage your workflows
          - Connect your integrations
          - Invite team members
          
          If you have any questions, feel free to reach out to our support team.
          
          Best regards,
          The Team
          
          ---
          This is an automated message. Please do not reply to this email.
        `
      };

      const command = new SendEmailCommand({
        Source: `${this.fromName} <${this.fromEmail}>`,
        Destination: {
          ToAddresses: [email],
        },
        Message: {
          Subject: {
            Data: template.subject,
            Charset: 'UTF-8',
          },
          Body: {
            Html: {
              Data: template.htmlBody,
              Charset: 'UTF-8',
            },
            Text: {
              Data: template.textBody,
              Charset: 'UTF-8',
            },
          },
        },
      });

      const result = await this.sesClient.send(command);
      logger.info('Welcome email sent successfully', {
        email,
        messageId: result.MessageId
      });

      return true;
    } catch (error) {
      logger.error('Failed to send welcome email', { error, email });
      throw error;
    }
  }

  public async testConnection(): Promise<boolean> {
    try {
      // Try to send a test email to verify SES configuration
      const command = new SendEmailCommand({
        Source: this.fromEmail,
        Destination: {
          ToAddresses: [this.fromEmail], // Send to self for testing
        },
        Message: {
          Subject: {
            Data: 'SES Test Email',
            Charset: 'UTF-8',
          },
          Body: {
            Text: {
              Data: 'This is a test email to verify SES configuration.',
              Charset: 'UTF-8',
            },
          },
        },
      });

      await this.sesClient.send(command);
      logger.info('SES connection test successful');
      return true;
    } catch (error) {
      logger.error('SES connection test failed', { error });
      return false;
    }
  }
}

export default EmailService;
