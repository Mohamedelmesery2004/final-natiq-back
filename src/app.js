import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import config from './config/index.js';

import authRoutes from './routes/authRoutes.js';
import platformRoutes from './routes/platformRoutes.js';
import adminUserRoutes from './routes/adminUserRoutes.js';
import knowledgeRoutes from './routes/knowledgeRoutes.js';
import embeddingRoutes from './routes/embeddingRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import adminChatRoutes from './routes/adminChatRoutes.js';
import ticketRoutes from './routes/ticketRoutes.js';
import adminTicketRoutes from './routes/adminTicketRoutes.js';
import channelRoutes from './routes/channelRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import agentRoutes from './routes/agentRoutes.js';
import qaRoutes from './routes/qaRoutes.js';
import callRoutes from './routes/callRoutes.js';
import teamLeaderRoutes from './routes/teamLeaderRoutes.js';
import managerRoutes from './routes/managerRoutes.js';
import ownerRoutes from './routes/ownerRoutes.js';
import internalMessageRoutes from './routes/internalMessageRoutes.js';
import coachRoutes from './routes/coachRoutes.js';

import { errorHandler, notFound } from './middlewares/errorMiddleware.js';

const app = express();

app.set('trust proxy', 1);

app.use(helmet());

app.use(cors({ origin: config.cors.origin, credentials: true }));

const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: { success: false, message: 'Too many requests, please try again later.' },
  validate: { xForwardedForHeader: false },
  skip: () => config.env === 'development',
});
app.use('/api/', limiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(compression());

if (config.env === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

import url from 'url';
import path from 'path';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/platform', platformRoutes);
app.use('/api/v1/admin/users', adminUserRoutes);
app.use('/api/v1/admin/knowledge', knowledgeRoutes);
app.use('/api/v1/admin/embeddings', embeddingRoutes);
app.use('/api/v1/admin/management', managerRoutes);
app.use('/api/v1/chat', chatRoutes);
app.use('/api/v1/admin/chat', adminChatRoutes);
app.use('/api/v1/tickets', ticketRoutes);
app.use('/api/v1/admin/tickets', adminTicketRoutes);
app.use('/api/v1/channels', channelRoutes);
app.use('/api/v1/admin/analytics', analyticsRoutes);
app.use('/api/v1/agent', agentRoutes);
app.use('/api/v1/qa', qaRoutes);
app.use('/api/v1/calls', callRoutes);
app.use('/api/v1/team-leader', teamLeaderRoutes);
app.use('/api/v1/owner', ownerRoutes);
app.use('/api/v1/internal-messages', internalMessageRoutes);
app.use('/api/v1/coach', coachRoutes);

app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

app.use(notFound);
app.use(errorHandler);

export default app;
