import mongoose from 'mongoose';

const companySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Company name is required'],
      trim: true,
      maxlength: 100,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    industry: {
      type: String,
      enum: ['telecom', 'banking', 'ecommerce', 'healthcare', 'sports_retail', 'other'],
      default: 'sports_retail',
    },
    channelsConfig: {
      telegram: {
        botToken: { type: String, default: null },
        webhookUrl: { type: String, default: null },
        webhookSecret: { type: String, default: null },
        isActive: { type: Boolean, default: false },
      },
      whatsapp: {
        isActive: { type: Boolean, default: false },
        phoneNumberId: { type: String, default: null },
        accessToken: { type: String, default: null },
      },
      webChat: {
        isActive: { type: Boolean, default: true },
        color: { type: String, default: '#042835' },
        welcomeMessage: { type: String, default: 'Welcome! How can we help you today?' },
      },
    },
    integrations: {
      webhooks: [{
        name: { type: String, required: true },
        url: { type: String, required: true },
        secret: { type: String, required: true },
        events: [{ type: String, enum: ['ticket_created', 'ticket_updated', 'ticket_resolved', 'message_received'] }],
        isActive: { type: Boolean, default: true }
      }],
      apiKeys: [{
        name: { type: String, required: true },
        key: { type: String, required: true, unique: true, sparse: true },
        permissions: [{ type: String, enum: ['read_tickets', 'write_tickets', 'manage_agents', 'all'] }],
        isActive: { type: Boolean, default: true },
        createdAt: { type: Date, default: Date.now }
      }],
      aiModels: {
        provider: { type: String, enum: ['openai', 'anthropic', 'custom'], default: 'openai' },
        modelName: { type: String, default: 'gpt-4o-mini' },
        apiKey: { type: String, default: null },
        temperature: { type: Number, default: 0.7, min: 0, max: 2 },
        maxTokens: { type: Number, default: 2000 }
      }
    },
    settings: {
      aiEnabled: { type: Boolean, default: true },
      escalationThreshold: { type: Number, default: 0.5, min: 0, max: 1 },
      maxSessionMessages: { type: Number, default: 50 },
      workingHours: {
        start: { type: String, default: '09:00' },
        end: { type: String, default: '17:00' },
        timezone: { type: String, default: 'UTC' },
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

companySchema.index({ isActive: 1 });

export default mongoose.model('Company', companySchema);
