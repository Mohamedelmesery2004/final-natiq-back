import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../repositories/index.js';
import path from 'path';
import chatSessionManager from '../services/chat/chatSessionManager.js';
import messageProcessor from '../services/chat/messageProcessor.js';
import BaseController from './baseController.js';
import { getIO } from '../sockets/index.js';
import ApiError from '../utils/apiError.js';
import config from '../config/index.js';

class ChatController extends BaseController {

  createSession = this.catchAsync(async (req, res) => {
    const { channel = 'web' } = req.body;
    const session = await chatSessionManager.createSession(req.companyId, req.userId, channel);
    this.sendSuccess(res, { session }, 'Chat session created', 201);
  });

  sendMessage = this.catchAsync(async (req, res) => {
    const { sessionId } = req.params;
    const { content } = req.body;

    const result = await messageProcessor.processMessage(req.companyId, sessionId, content, 'web');

    try {
      const io = getIO();

      io.of('/webchat').to(`session:${sessionId}`).emit('chat:message', {
        sessionId,
        message: {
          role: 'assistant',
          content: result.aiResponse.answer,
          timestamp: new Date(),
        },
      });

      if (result.ticket) {
        io.of('/admin').to(`company:${req.companyId}`).emit('ticket:new', {
          ticket: result.ticket,
          sessionId,
        });
      }

      io.of('/admin').to(`company:${req.companyId}`).emit('chat:sessionUpdated', {
        sessionId,
        status: result.session.status,
        messageCount: result.session.messageCount,
        lastActivity: result.session.lastActivity,
      });
    } catch (socketErr) {
      console.error('Socket emit error:', socketErr.message);
    }

    this.sendSuccess(res, {
      message: {
        role: 'assistant',
        content: result.aiResponse.answer,
      },
      intent: result.aiResponse.detectedIntent,
      confidence: result.aiResponse.confidence,
      escalated: result.escalated,
      ticketNumber: result.ticket?.ticketNumber || null,
    });
  });

  generateTTS = this.catchAsync(async (req, res) => {
    const { text } = req.body;
    if (!text) throw new ApiError('Text is required', 400);

    const apiKey = config.elevenlabs?.apiKey;
    if (!apiKey) throw new ApiError('ElevenLabs API key is not configured in backend', 500);

    const voiceId = "pNInz6obpgDQGcFmaJgB"; // Adam
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      })
    });

    if (!response.ok) {
      throw new ApiError('ElevenLabs API failed', response.status);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': buffer.length
    });

    res.send(buffer);
  });

  sendMediaMessage = this.catchAsync(async (req, res) => {
    const { sessionId } = req.params;

        if (!req.file) {
      throw ApiError.badRequest('No media file provided');
    }

    const mediaType = req.file.mimetype.startsWith('image/') ? 'image' :
                     req.file.mimetype.startsWith('video/') ? 'video' :
                     req.file.mimetype.startsWith('audio/') ? 'audio' : 'file';

    const relativePath = path.relative(process.cwd(), req.file.path);
    const mediaUrl = `/${relativePath.replace(/\\/g, '/')}`;

    const media = {
      url: mediaUrl,
      type: mediaType,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
    };

    const result = await messageProcessor.processMessage(
      req.companyId, 
      sessionId, 
      `[Sent a ${mediaType}: ${req.file.originalname}]`, 
      'web',
      media
    );

    const session = result.session;
    const lastUserMsg = session.messages.reverse().find(m => m.role === 'user');
    if (lastUserMsg) {
      lastUserMsg.mediaUrl = media.url;
      lastUserMsg.mediaType = media.type;
      lastUserMsg.fileName = media.fileName;
      lastUserMsg.fileSize = media.fileSize;
      lastUserMsg.mimeType = media.mimeType;
    }
    await session.save();

    try {
      const io = getIO();
      io.of('/webchat').to(`session:${sessionId}`).emit('chat:message', {
        sessionId,
        message: {
          role: 'user',
          ...media,
          timestamp: new Date(),
        },
      });

      io.of('/webchat').to(`session:${sessionId}`).emit('chat:message', {
        sessionId,
        message: {
          role: 'assistant',
          content: result.aiResponse.answer,
          timestamp: new Date(),
        },
      });
    } catch (socketErr) {
      console.error('Socket emit error:', socketErr.message);
    }

    this.sendSuccess(res, {
      session,
      aiResponse: result.aiResponse,
    });
  });

  getMySessions = this.catchAsync(async (req, res) => {
    const { page, limit, status } = req.query;
    const result = await chatSessionManager.getUserSessions(req.companyId, req.userId, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      status,
    });
    this.sendSuccess(res, result);
  });

  closeSession = this.catchAsync(async (req, res) => {
    const session = await chatSessionManager.closeSession(req.companyId, req.params.sessionId);

    try {
      const io = getIO();
      io.of('/admin').to(`company:${req.companyId}`).emit('chat:sessionUpdated', {
        sessionId: session.sessionId,
        status: 'closed',
      });
    } catch (socketErr) {
      console.error('Socket emit error:', socketErr.message);
    }

    this.sendSuccess(res, { session: { sessionId: session.sessionId, status: session.status } }, 'Session closed');
  });

  uploadSessionRecording = this.catchAsync(async (req, res) => {
    const { sessionId } = req.params;

    if (!req.file) {
      throw ApiError.badRequest('No audio file provided');
    }

    const recordingUrl = `/uploads/calls/${req.file.filename}`;

    const session = await chatSessionRepo.findOne({ sessionId, companyId: req.companyId });
    if (!session) {
      throw ApiError.notFound('Session not found');
    }
    
    // We add a recordingUrl to the session metadata or context
    session.context = session.context || {};
    session.context.recordingUrl = recordingUrl;
    await session.save();

    this.sendSuccess(res, { session }, 'Session recording uploaded successfully');
  });

}

export default new ChatController();
