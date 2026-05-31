import mongoose from 'mongoose';

const taskSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: [true, 'Company ID is required'],
    },
    title: {
      type: String,
      required: [true, 'Task title is required'],
      trim: true,
      maxlength: 500,
    },
    date: {
      type: String, // YYYY-MM-DD
      required: [true, 'Task date is required'],
    },
    time: {
      type: String, // HH:MM (optional)
      default: null,
    },
    done: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

taskSchema.index({ userId: 1, date: 1 });
taskSchema.index({ companyId: 1, userId: 1, date: 1 });

export default mongoose.model('Task', taskSchema);
