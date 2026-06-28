import mongoose from 'mongoose';

const subscriptionPlanSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Plan name is required'],
      trim: true,
      maxlength: 100,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      maxlength: 500,
    },
    price: {
      type: Number,
      required: [true, 'Plan price is required'],
      min: 0,
    },
    currency: {
      type: String,
      default: 'USD',
      uppercase: true,
      trim: true,
    },
    interval: {
      type: String,
      enum: ['monthly', 'yearly'],
      default: 'monthly',
    },
    features: [{
      text: { type: String, required: true },
      included: { type: Boolean, default: true },
    }],
    limits: {
      maxAgents: { type: Number, default: 5 },
      maxChatsPerDay: { type: Number, default: 100 },
      maxTicketsPerDay: { type: Number, default: 50 },
      maxKnowledgeItems: { type: Number, default: 100 },
      aiEnabled: { type: Boolean, default: true },
      channels: [{
        type: String,
        enum: ['web', 'telegram', 'whatsapp', 'voice'],
      }],
      storageGb: { type: Number, default: 5 },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

subscriptionPlanSchema.index({ isActive: 1, sortOrder: 1 });

export default mongoose.model('SubscriptionPlan', subscriptionPlanSchema);
