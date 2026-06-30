import mongoose from 'mongoose';

const coachJobSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
  },
  ticketId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ticket',
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
  },
  result: {
    ai_recommendations: { type: String, default: '' },
    weakness_analysis: { type: String, default: '' },
    suggested_learning: { type: String, default: '' },
    encouragement_quote: { type: String, default: '' },
  },
  error: {
    type: String,
    default: null,
  },
  startedAt: {
    type: Date,
    default: null,
  },
  completedAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

coachJobSchema.index({ companyId: 1, createdAt: -1 });

export default mongoose.model('CoachJob', coachJobSchema);
