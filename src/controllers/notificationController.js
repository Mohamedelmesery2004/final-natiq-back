import { Notification } from '../models/index.js';
import BaseController from './baseController.js';
import ApiError from '../utils/apiError.js';

class NotificationController extends BaseController {

  /**
   * GET /api/v1/agent/notifications
   * List notifications for the logged-in agent (newest first, limit 50).
   */
  getNotifications = this.catchAsync(async (req, res) => {
    const limit = parseInt(req.query.limit) || 50;

    const [notifications, unreadCount] = await Promise.all([
      Notification.find({ userId: req.userId, companyId: req.companyId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      Notification.countDocuments({ userId: req.userId, companyId: req.companyId, isRead: false }),
    ]);

    this.sendSuccess(res, { notifications, unreadCount });
  });

  /**
   * PATCH /api/v1/agent/notifications/:notificationId/read
   * Mark one notification as read.
   */
  markAsRead = this.catchAsync(async (req, res) => {
    const { notificationId } = req.params;

    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, userId: req.userId, companyId: req.companyId },
      { isRead: true },
      { new: true }
    );

    if (!notification) throw ApiError.notFound('Notification not found');

    this.sendSuccess(res, { notification }, 'Notification marked as read');
  });

  /**
   * PATCH /api/v1/agent/notifications/read-all
   * Mark all notifications as read for the logged-in agent.
   */
  markAllAsRead = this.catchAsync(async (req, res) => {
    await Notification.updateMany(
      { userId: req.userId, companyId: req.companyId, isRead: false },
      { isRead: true }
    );

    this.sendSuccess(res, null, 'All notifications marked as read');
  });
}

export default new NotificationController();
