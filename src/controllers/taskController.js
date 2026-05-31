import { Task } from '../models/index.js';
import BaseController from './baseController.js';
import ApiError from '../utils/apiError.js';

class TaskController extends BaseController {

  /**
   * GET /api/v1/agent/tasks?date=YYYY-MM-DD
   * List tasks for the logged-in agent. Optionally filter by date.
   */
  getTasks = this.catchAsync(async (req, res) => {
    const filter = { userId: req.userId, companyId: req.companyId };
    if (req.query.date) {
      filter.date = req.query.date;
    }

    const tasks = await Task.find(filter).sort({ date: 1, time: 1 }).lean();
    this.sendSuccess(res, tasks);
  });

  /**
   * POST /api/v1/agent/tasks
   * Create a new task.
   */
  createTask = this.catchAsync(async (req, res) => {
    const { title, date, time } = req.body;

    if (!title || !date) {
      throw ApiError.badRequest('Title and date are required');
    }

    const task = await Task.create({
      userId: req.userId,
      companyId: req.companyId,
      title: title.trim(),
      date,
      time: time || null,
      done: false,
    });

    this.sendSuccess(res, task, 'Task created');
  });

  /**
   * PATCH /api/v1/agent/tasks/:taskId
   * Update a task (title, time, done).
   */
  updateTask = this.catchAsync(async (req, res) => {
    const { taskId } = req.params;
    const updates = {};

    if (req.body.title !== undefined) updates.title = req.body.title.trim();
    if (req.body.time !== undefined) updates.time = req.body.time || null;
    if (req.body.done !== undefined) updates.done = req.body.done;
    if (req.body.date !== undefined) updates.date = req.body.date;

    const task = await Task.findOneAndUpdate(
      { _id: taskId, userId: req.userId, companyId: req.companyId },
      updates,
      { new: true }
    );

    if (!task) throw ApiError.notFound('Task not found');

    this.sendSuccess(res, task, 'Task updated');
  });

  /**
   * DELETE /api/v1/agent/tasks/:taskId
   * Delete a task.
   */
  deleteTask = this.catchAsync(async (req, res) => {
    const { taskId } = req.params;

    const task = await Task.findOneAndDelete({
      _id: taskId,
      userId: req.userId,
      companyId: req.companyId,
    });

    if (!task) throw ApiError.notFound('Task not found');

    this.sendSuccess(res, null, 'Task deleted');
  });
}

export default new TaskController();
