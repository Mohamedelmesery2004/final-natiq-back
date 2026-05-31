import { internalMessageRepo, userRepo } from '../repositories/index.js';
import BaseController from './baseController.js';
import ApiError from '../utils/apiError.js';
import { getIO } from '../sockets/index.js';
import { ROLES } from '../constants/index.js';

class InternalMessageController extends BaseController {

  getUsers = this.catchAsync(async (req, res) => {
    // Only agents in same company. You can include team leaders if needed.
    const users = await userRepo.model.find({ 
      companyId: req.companyId,
      _id: { $ne: req.userId },
      isActive: true,
      role: { $in: [ROLES.AGENT, ROLES.TEAM_LEADER] }
    }).select('name email role profileImage isOnline');

    this.sendSuccess(res, { users });
  });

  getMessages = this.catchAsync(async (req, res) => {
    const { contactId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    if (!contactId) throw ApiError.badRequest('Contact ID is required');

    const query = {
      companyId: req.companyId,
      $or: [
        { senderId: req.userId, receiverId: contactId },
        { senderId: contactId, receiverId: req.userId },
      ],
    };

    const messages = await internalMessageRepo.model.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('senderId', 'name')
      .lean();

    messages.reverse();

    // Mark as read
    await internalMessageRepo.model.updateMany(
      { companyId: req.companyId, senderId: contactId, receiverId: req.userId, isRead: false },
      { $set: { isRead: true } }
    );

    this.sendSuccess(res, { messages, page: parseInt(page) });
  });

  sendMessage = this.catchAsync(async (req, res) => {
    const { receiverId, content } = req.body;

    if (!receiverId || !content) {
      throw ApiError.badRequest('receiverId and content are required');
    }

    const message = await internalMessageRepo.create({
      companyId: req.companyId,
      senderId: req.userId,
      receiverId,
      content,
    });

    const populatedMsg = await message.populate('senderId', 'name profileImage');

    try {
      const io = getIO();
      // Emitting to the specific agent room for internal messages
      io.of('/admin').to(`company:${req.companyId}:agent:${receiverId}`).emit('internal:message', populatedMsg);
      // Also emit to sender to confirm
      io.of('/admin').to(`company:${req.companyId}:agent:${req.userId}`).emit('internal:message', populatedMsg);
    } catch (e) {
      console.error('Failed to emit internal message', e.message);
    }

    this.sendSuccess(res, { message: populatedMsg });
  });
}

export default new InternalMessageController();
