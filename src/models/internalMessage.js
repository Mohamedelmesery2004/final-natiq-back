import mongoose from 'mongoose';

const internalMessageSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

internalMessageSchema.index({ companyId: 1, senderId: 1, receiverId: 1 });
internalMessageSchema.index({ companyId: 1, receiverId: 1, isRead: 1 });

export default mongoose.model('InternalMessage', internalMessageSchema);
