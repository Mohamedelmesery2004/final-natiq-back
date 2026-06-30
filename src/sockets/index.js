import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import axios from 'axios';
import { User, Ticket, ChatSession, Company } from '../models/index.js';
import { ROLES, CHANNELS } from '../constants/index.js';
import chatSessionManager from '../services/chat/chatSessionManager.js';
import agentTicketService from '../services/agent/agentTicketService.js';
import messageProcessor from '../services/chat/messageProcessor.js';

let io;

const initializeSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: config.cors.origin,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  const adminNamespace = io.of('/admin');

  adminNamespace.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(token, config.jwt.secret);
      const user = await User.findById(decoded.id).select('-passwordHash');

      if (!user || !user.isActive) {
        return next(new Error('User not found or inactive'));
      }

      const staffRoles = [
        ROLES.PLATFORM_SUPER_ADMIN,
        ROLES.COMPANY_MANAGER,
        ROLES.TEAM_LEADER,
        ROLES.AGENT,
      ];
      if (!staffRoles.includes(user.role)) {
        return next(new Error('Access denied: insufficient role'));
      }

      socket.user = user;
      socket.companyId = user.companyId?.toString();
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  adminNamespace.on('connection', (socket) => {
    console.log(`[Admin] ${socket.user.name} connected (${socket.user.role})`);

    if (socket.companyId) {
      socket.join(`company:${socket.companyId}`);
    }

    if (socket.user.role === ROLES.PLATFORM_SUPER_ADMIN) {
      socket.join('superadmin');
    }

    if (socket.user.role === ROLES.AGENT) {
      socket.join(`company:${socket.companyId}:agent:${socket.user._id}`);
    }

    socket.on('ticket:watch', (ticketId) => {
      socket.join(`ticket:${ticketId}`);
      socket.join(`company:${socket.companyId}:ticket:${ticketId}`);
    });

    socket.on('ticket:unwatch', (ticketId) => {
      socket.leave(`ticket:${ticketId}`);
      socket.leave(`company:${socket.companyId}:ticket:${ticketId}`);
    });

    socket.on('test:ping', (data) => {
      console.log('[Socket.IO] Test ping received:', data);
      socket.emit('test:pong', { 
        message: 'pong', 
        timestamp: new Date(),
        user: socket.user.name 
      });
    });

    socket.on('chat:getHistory', async (data) => {
      try {
        let { sessionId, ticketId, options = {} } = data;

        if (ticketId && !sessionId) {
          const ticket = await Ticket.findOne({
            _id: ticketId,
            companyId: socket.companyId,
            assignedTo: socket.user._id,
          });

          if (!ticket) {
            throw new Error('Ticket not found or not assigned to you');
          }

          sessionId = ticket.context?.sessionId;
          if (!sessionId) {
            throw new Error('No chat session linked to this ticket');
          }
        }

        if (!sessionId) {
          throw new Error('sessionId is required');
        }

        const history = await agentTicketService.getChatHistory(
          socket.companyId,
          sessionId,
          socket.user._id.toString(),
          options
        );

        socket.emit('chat:history', {
          sessionId,
          ticketId,
          history,
          timestamp: new Date(),
        });
      } catch (err) {
        socket.emit('chat:historyError', {
          sessionId: data.sessionId,
          ticketId: data.ticketId,
          error: err.message,
          timestamp: new Date(),
        });
      }
    });

    socket.on('agent:typing', ({ sessionId, isTyping }) => {
      io.of('/webchat').to(`session:${sessionId}`).emit('agent:typing', {
        agentName: socket.user.name,
        isTyping,
      });
    });

    socket.on('ticket:sendMessage', async ({ ticketId, content }) => {
      try {
        const { ticket, session } = await agentTicketService.agentReplyToTicket(
          socket.companyId,
          ticketId,
          socket.user._id.toString(),
          content
        );

        const payload = {
          ticketId: ticket._id,
          ticketNumber: ticket.ticketNumber,
          sessionId: session?.sessionId || null,
          agentId: socket.user._id,
          agentName: socket.user.name,
          content,
          role: 'agent',
          createdAt: new Date(),
        };

adminNamespace
  .to(`company:${socket.companyId}:ticket:${ticket._id}`)
  .except(socket.id)
  .emit('ticket:message:new', payload);

adminNamespace
  .to(`company:${socket.companyId}`)
  .except(`company:${socket.companyId}:ticket:${ticket._id}`)
  .except(socket.id)
  .emit('ticket:message:new', payload);

socket.emit('ticket:messageSent', { ticketId, content, createdAt: new Date() });

      } catch (err) {
        socket.emit('ticket:messageError', { ticketId, error: err.message });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Admin] ${socket.user.name} disconnected`);
    });
  });

  const webchatNamespace = io.of('/webchat');

  webchatNamespace.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(token, config.jwt.secret);
      const user = await User.findById(decoded.id).select('-passwordHash');

      if (!user || !user.isActive) {
        return next(new Error('User not found or inactive'));
      }

      socket.user = user;
      socket.companyId = user.companyId?.toString();
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  webchatNamespace.on('connection', (socket) => {
    console.log(`[WebChat] ${socket.user.name} connected`);

    socket.on('session:join', (sessionId) => {
      socket.join(`session:${sessionId}`);
      console.log(`[WebChat] ${socket.user.name} joined session:${sessionId}`);
    });

    socket.on('session:leave', (sessionId) => {
      socket.leave(`session:${sessionId}`);
    });

    socket.on('chat:sendMessage', async ({ sessionId, content }) => {
      try {
        const result = await messageProcessor.processMessage(
          socket.companyId,
          sessionId,
          content,
          'web'
        );

        socket.emit('chat:message', {
          sessionId,
          message: {
            role: 'assistant',
            content: result.aiResponse.answer,
            timestamp: new Date(),
            meta: {
              intent: result.aiResponse.detectedIntent,
              confidence: result.aiResponse.confidence,
            },
          },
          escalated: result.escalated,
          ticketNumber: result.ticket?.ticketNumber || null,
        });

        if (result.ticket) {
          adminNamespace.to(`company:${socket.companyId}`).emit('ticket:new', {
            ticket: result.ticket,
            sessionId,
            channel: 'web',
          });
        }

        adminNamespace.to(`company:${socket.companyId}`).emit('chat:sessionUpdated', {
          sessionId,
          messageCount: result.session.messageCount,
          lastActivity: result.session.lastActivity,
        });

        const linkedTicket = await Ticket.findOne({
          companyId: socket.companyId,
          'context.sessionId': sessionId,
        });
        if (linkedTicket) {
          adminNamespace
            .to(`company:${socket.companyId}:ticket:${linkedTicket._id}`)
            .emit('ticket:message:new', {
              ticketId: linkedTicket._id,
              ticketNumber: linkedTicket.ticketNumber,
              sessionId,
              userId: socket.user._id,
              userName: socket.user.name,
              message: content,
              role: 'user',
              channel: 'web',
              timestamp: new Date(),
            });
        }
      } catch (error) {
        socket.emit('chat:error', { message: error.message });
      }
    });

    socket.on('customer:typing', ({ sessionId, isTyping }) => {
      adminNamespace.to(`company:${socket.companyId}`).emit('customer:typing', {
        sessionId,
        customerName: socket.user.name,
        isTyping,
      });
    });

    socket.on('disconnect', () => {
      console.log(`[WebChat] ${socket.user.name} disconnected`);
    });
  });

  // ─── CALLS NAMESPACE (/calls) ────────────────────────────────────────────────
  // Used for WebRTC signaling between customer phone and agent dashboard

  const callsNamespace = io.of('/calls');

  callsNamespace.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('Authentication required'));

      const decoded = jwt.verify(token, config.jwt.secret);
      const user = await User.findById(decoded.id).select('-passwordHash');

      if (!user || !user.isActive) return next(new Error('User not found or inactive'));

      socket.user = user;
      socket.companyId = user.companyId?.toString();
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  callsNamespace.on('connection', (socket) => {
    const companyRoom = `calls:company:${socket.companyId}`;
    socket.join(companyRoom);
    console.log(`[Calls] ${socket.user.name} (${socket.user.role}) connected`);

    // ── CUSTOMER: initiate a call ──────────────────────────────────────────
    socket.on('call:initiate', ({ callId, customerName }) => {
      console.log(`[Calls] call:initiate from ${socket.user.name} callId=${callId}`);

      // Tag this socket with the active callId so we can route responses back
      socket.activeCallId = callId;
      socket.customerSocketId = socket.id;

      // Broadcast to all agents in this company
      socket.to(companyRoom).emit('call:incoming', {
        callId,
        customerId: socket.user._id,
        customerName: customerName || socket.user.name,
        startedAt: new Date(),
      });
    });

    // ── AGENT: accept a call ──────────────────────────────────────────────
    socket.on('call:accept', ({ callId }) => {
      console.log(`[Calls] call:accept by agent ${socket.user.name} callId=${callId}`);
      socket.activeCallId = callId;

      // Notify the whole room (customer + other agents that it's been picked up)
      callsNamespace.to(companyRoom).emit('call:accepted', {
        callId,
        agentId: socket.user._id,
        agentName: socket.user.name,
        answeredAt: new Date(),
      });
    });

    // ── AGENT: reject a call ──────────────────────────────────────────────
    socket.on('call:reject', ({ callId }) => {
      console.log(`[Calls] call:reject by agent ${socket.user.name} callId=${callId}`);
      callsNamespace.to(companyRoom).emit('call:rejected', {
        callId,
        agentId: socket.user._id,
      });
    });

    // ── WebRTC: SDP offer (customer → agent) ──────────────────────────────
    socket.on('call:offer', ({ callId, sdp }) => {
      console.log(`[Calls] call:offer relayed callId=${callId}`);
      socket.to(companyRoom).emit('call:offer', { callId, sdp });
    });

    // ── WebRTC: SDP answer (agent → customer) ─────────────────────────────
    socket.on('call:answer', ({ callId, sdp }) => {
      console.log(`[Calls] call:answer relayed callId=${callId}`);
      socket.to(companyRoom).emit('call:answer', { callId, sdp });
    });

    // ── WebRTC: ICE candidates (both directions) ──────────────────────────
    socket.on('call:ice-candidate', ({ callId, candidate }) => {
      socket.to(companyRoom).emit('call:ice-candidate', { callId, candidate });
    });

    // ── Either side: end the call ─────────────────────────────────────────
    socket.on('call:end', ({ callId, endedBy, duration }) => {
      console.log(`[Calls] call:end callId=${callId} by ${endedBy}, duration=${duration}s`);
      callsNamespace.to(companyRoom).emit('call:ended', {
        callId,
        endedBy,
        duration: duration || 0,
        endedAt: new Date(),
      });
    });

    socket.on('disconnect', () => {
      console.log(`[Calls] ${socket.user.name} disconnected`);
      // If they were in an active call, notify the room
      if (socket.activeCallId) {
        callsNamespace.to(companyRoom).emit('call:ended', {
          callId: socket.activeCallId,
          endedBy: socket.user.role,
          duration: 0,
          endedAt: new Date(),
          reason: 'disconnected',
        });
      }
    });
  });

  console.log('Socket.IO initialized with /admin, /webchat, and /calls namespaces');
  return io;
};

const getIO = () => {
  if (!io) {
    console.warn('[Socket.IO] Not initialized — returning null. Real-time features unavailable.');
    return null;
  }
  return io;
};

export { initializeSocket, getIO };
