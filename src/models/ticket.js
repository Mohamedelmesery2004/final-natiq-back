import mongoose from 'mongoose';
import { CHANNELS, TICKET_STATUS, TICKET_PRIORITY, TICKET_CATEGORY } from '../constants/index.js';

const agentNoteSchema = new mongoose.Schema(
  {
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const ticketSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: [true, 'Company ID is required'],
    },
    ticketNumber: {
      type: String,
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
    },
    channel: {
      type: String,
      enum: Object.values(CHANNELS),
      required: true,
    },
    category: {
      type: String,
      enum: Object.values(TICKET_CATEGORY),
      default: TICKET_CATEGORY.OTHER,
    },
    priority: {
      type: String,
      enum: Object.values(TICKET_PRIORITY),
      default: TICKET_PRIORITY.MEDIUM,
    },
    status: {
      type: String,
      enum: Object.values(TICKET_STATUS),
      default: TICKET_STATUS.PENDING,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    agentNotes: [agentNoteSchema],
    context: {
      sessionId: {
        type: String,
        default: null,
      },
      lastUserMessage: {
        type: String,
        default: null,
      },
      aiSummary: {
        type: String,
        default: null,
      },
      attachments: [
        {
          type: String,
        },
      ],
      conversationSnapshot: {
        type: [mongoose.Schema.Types.Mixed],
        default: [],
      },
      analysisStatus: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'not_applicable'],
        default: 'not_applicable',
      },
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    firstResponseAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

ticketSchema.index({ companyId: 1, ticketNumber: 1 }, { unique: true });
ticketSchema.index({ companyId: 1, status: 1, createdAt: -1 });
ticketSchema.index({ companyId: 1, userId: 1 });
ticketSchema.index({ companyId: 1, assignedTo: 1 });
ticketSchema.index({ companyId: 1, assignedTo: 1, status: 1, createdAt: -1 });
ticketSchema.index({ companyId: 1, category: 1 });
ticketSchema.index({ companyId: 1, priority: 1 });

export default mongoose.model('Ticket', ticketSchema);
