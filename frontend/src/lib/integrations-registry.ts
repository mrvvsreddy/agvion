import {
  Mail,
  MessageSquare,
  Database,
  Calendar,
  FileText,
  Users,
  DollarSign,
  ShoppingCart,
  BarChart,
  Cloud,
  Phone,
  Video,
  Smartphone,
  Slack,
  Github,
  Gitlab,
  Twitter,
  Linkedin,
  Instagram,
  Youtube,
  Chrome,
  Zap,
  Trello,
  Send,
  type LucideIcon,
} from 'lucide-react';

export interface Integration {
  id: string;
  name: string;
  icon: LucideIcon;
  category: 'communication' | 'productivity' | 'crm' | 'database' | 'analytics' | 'social' | 'development' | 'automation';
  color: string;
  description?: string;
}

export const integrationsRegistry: Integration[] = [
  // Communication
  {
    id: 'gmail',
    name: 'Gmail',
    icon: Mail,
    category: 'communication',
    color: '#EA4335',
    description: 'Send and receive emails via Gmail',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    icon: MessageSquare,
    category: 'communication',
    color: '#25D366',
    description: 'Send WhatsApp messages',
  },
  {
    id: 'slack',
    name: 'Slack',
    icon: Slack,
    category: 'communication',
    color: '#4A154B',
    description: 'Send messages to Slack channels',
  },
  {
    id: 'telegram',
    name: 'Telegram',
    icon: Send,
    category: 'communication',
    color: '#0088cc',
    description: 'Send Telegram messages',
  },
  {
    id: 'zoom',
    name: 'Zoom',
    icon: Video,
    category: 'communication',
    color: '#2D8CFF',
    description: 'Create and manage Zoom meetings',
  },
  {
    id: 'twilio',
    name: 'Twilio',
    icon: Phone,
    category: 'communication',
    color: '#F22F46',
    description: 'Send SMS and make phone calls',
  },

  // Productivity
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    icon: FileText,
    category: 'productivity',
    color: '#0F9D58',
    description: 'Read and write data to spreadsheets',
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    icon: Calendar,
    category: 'productivity',
    color: '#4285F4',
    description: 'Manage calendar events',
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    icon: Cloud,
    category: 'productivity',
    color: '#4285F4',
    description: 'Access and manage files',
  },
  {
    id: 'trello',
    name: 'Trello',
    icon: Trello,
    category: 'productivity',
    color: '#0052CC',
    description: 'Manage Trello boards and cards',
  },

  // CRM
  {
    id: 'zoho-crm',
    name: 'Zoho CRM',
    icon: Users,
    category: 'crm',
    color: '#E42527',
    description: 'Manage contacts and leads',
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    icon: Users,
    category: 'crm',
    color: '#FF7A59',
    description: 'Manage contacts and deals',
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    icon: Cloud,
    category: 'crm',
    color: '#00A1E0',
    description: 'Access Salesforce data',
  },

  // Database
  {
    id: 'mysql',
    name: 'MySQL',
    icon: Database,
    category: 'database',
    color: '#4479A1',
    description: 'Execute MySQL queries',
  },
  {
    id: 'postgresql',
    name: 'PostgreSQL',
    icon: Database,
    category: 'database',
    color: '#336791',
    description: 'Execute PostgreSQL queries',
  },
  {
    id: 'mongodb',
    name: 'MongoDB',
    icon: Database,
    category: 'database',
    color: '#47A248',
    description: 'Query MongoDB collections',
  },

  // Analytics
  {
    id: 'google-analytics',
    name: 'Google Analytics',
    icon: BarChart,
    category: 'analytics',
    color: '#F9AB00',
    description: 'Track and analyze website traffic',
  },
  {
    id: 'mixpanel',
    name: 'Mixpanel',
    icon: BarChart,
    category: 'analytics',
    color: '#7856FF',
    description: 'Track user events and analytics',
  },

  // Social Media
  {
    id: 'twitter',
    name: 'Twitter',
    icon: Twitter,
    category: 'social',
    color: '#1DA1F2',
    description: 'Post tweets and manage Twitter',
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    icon: Linkedin,
    category: 'social',
    color: '#0A66C2',
    description: 'Share posts on LinkedIn',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    icon: Instagram,
    category: 'social',
    color: '#E4405F',
    description: 'Manage Instagram posts',
  },
  {
    id: 'youtube',
    name: 'YouTube',
    icon: Youtube,
    category: 'social',
    color: '#FF0000',
    description: 'Manage YouTube videos',
  },

  // Development
  {
    id: 'github',
    name: 'GitHub',
    icon: Github,
    category: 'development',
    color: '#181717',
    description: 'Manage repositories and issues',
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    icon: Gitlab,
    category: 'development',
    color: '#FCA121',
    description: 'Manage GitLab projects',
  },

  // Automation
  {
    id: 'zapier',
    name: 'Zapier',
    icon: Zap,
    category: 'automation',
    color: '#FF4A00',
    description: 'Connect apps and automate workflows',
  },
  {
    id: 'webhook',
    name: 'Webhook',
    icon: Zap,
    category: 'automation',
    color: '#6B7280',
    description: 'Send HTTP requests',
  },

  // E-commerce
  {
    id: 'shopify',
    name: 'Shopify',
    icon: ShoppingCart,
    category: 'productivity',
    color: '#96BF48',
    description: 'Manage Shopify store',
  },
  {
    id: 'stripe',
    name: 'Stripe',
    icon: DollarSign,
    category: 'productivity',
    color: '#635BFF',
    description: 'Process payments',
  },
];

export const getIntegrationById = (id: string): Integration | undefined => {
  return integrationsRegistry.find((integration) => integration.id === id);
};

export const getIntegrationsByCategory = (category: Integration['category']): Integration[] => {
  return integrationsRegistry.filter((integration) => integration.category === category);
};
