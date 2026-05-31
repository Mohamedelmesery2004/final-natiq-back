import mongoose from 'mongoose';

const qaAnalysisSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
    },
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ticket',
      required: true,
      unique: true,
    },
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    
    // Flattened fields for list view performance
    ticketNumber: String,
    channel: String,
    category: String,
    
    customerSentiment: {
      type: String,
      default: 'unclear',
    },
    resolutionStatus: {
      type: String,
      default: 'unclear',
    },
    
    scores: {
      professionalism: { type: Number, default: 0 },
      empathy: { type: Number, default: 0 },
      quality: { type: Number, default: 0 },
    },

    // The full AI response object
    fullAnalysis: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    natiqAnalysis: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    metadata: {
      model: String,
      tokensUsed: Number,
      analyzedAt: {
        type: Date,
        default: Date.now,
      },
    },

    teamLeaderNotes: [
      {
        leaderId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        content: { type: String, required: true, trim: true, maxlength: 8000 },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  }
);

qaAnalysisSchema.index({ companyId: 1, createdAt: -1 });
qaAnalysisSchema.index({ companyId: 1, agentId: 1, createdAt: -1 });
qaAnalysisSchema.index({ companyId: 1, resolutionStatus: 1 });
qaAnalysisSchema.index({ companyId: 1, customerSentiment: 1 });

export default mongoose.model('QAAnalysis', qaAnalysisSchema);
