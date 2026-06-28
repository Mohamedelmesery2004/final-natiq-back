import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

import { User, Ticket, TicketFeedback } from '../models/index.js';
import { CHANNELS, TICKET_STATUS, TICKET_PRIORITY, TICKET_CATEGORY, ROLES } from '../constants/index.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/natiq';

const seed = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    await Promise.all([
      Ticket.deleteMany({}),
      TicketFeedback.deleteMany({}),
    ]);
    console.log('Cleared existing tickets and feedback');

    const company = await User.findOne({ role: ROLES.COMPANY_OWNER }).select('companyId').lean();
    if (!company) {
      console.error('Run seed.js first — no company found');
      process.exit(1);
    }
    const companyId = company.companyId;

    const omar = await User.findOne({ email: 'omar@primestore.com' }).lean();
    const fatima = await User.findOne({ email: 'fatima@primestore.com' }).lean();
    const khaled = await User.findOne({ email: 'khaled@example.com' }).lean();

    if (!omar || !fatima || !khaled) {
      console.error('Run seed.js first — users not found');
      process.exit(1);
    }

    const now = new Date();
    const daysAgo = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return d; };
    const hoursAgo = (h) => { const d = new Date(now); d.setHours(d.getHours() - h); return d; };
    const randomBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

    const channels = Object.values(CHANNELS);
    const priorities = Object.values(TICKET_PRIORITY);
    const categories = Object.values(TICKET_CATEGORY);

    const CATEGORY_BIAS = {
      [TICKET_PRIORITY.LOW]: [TICKET_CATEGORY.PACKAGES, TICKET_CATEGORY.OTHER],
      [TICKET_PRIORITY.MEDIUM]: [TICKET_CATEGORY.BILLING, TICKET_CATEGORY.PAYMENT, TICKET_CATEGORY.NETWORK],
      [TICKET_PRIORITY.HIGH]: [TICKET_CATEGORY.COMPLAINT, TICKET_CATEGORY.REFUND],
      [TICKET_PRIORITY.URGENT]: [TICKET_CATEGORY.COMPLAINT, TICKET_CATEGORY.REFUND, TICKET_CATEGORY.BILLING],
    };

    let ticketCounter = 1;

    const generateTicketsFor = (agent, profile) => {
      const tickets = [];
      const numTickets = profile.ticketCount;

      for (let i = 0; i < numTickets; i++) {
        const isEscalated = Math.random() < profile.escalationRate;
        const priority = isEscalated
          ? (Math.random() < 0.4 ? TICKET_PRIORITY.URGENT : TICKET_PRIORITY.HIGH)
          : (Math.random() < 0.3 ? TICKET_PRIORITY.LOW : TICKET_PRIORITY.MEDIUM);

        const channel = channels[randomBetween(0, channels.length - 1)];
        const catPool = CATEGORY_BIAS[priority] || categories;
        const category = catPool[randomBetween(0, catPool.length - 1)];

        const createdOffset = randomBetween(1, profile.maxDaysBack);
        const createdAt = daysAgo(createdOffset);
        createdAt.setHours(randomBetween(8, 22), randomBetween(0, 59), 0, 0);

        const responseDelayMin = randomBetween(profile.responseMin, profile.responseMax);
        const firstResponseAt = new Date(createdAt.getTime() + responseDelayMin * 60000);

        const resolutionDelayMin = randomBetween(profile.resolutionMin, profile.resolutionMax);
        const resolvedAt = new Date(createdAt.getTime() + resolutionDelayMin * 60000);

        const ticketNumber = `TKT-${String(ticketCounter++).padStart(5, '0')}`;

        tickets.push({
          companyId,
          ticketNumber,
          userId: khaled._id,
          assignedTo: agent._id,
          channel,
          category,
          priority,
          status: TICKET_STATUS.CLOSED,
          createdAt,
          firstResponseAt,
          resolvedAt,
          context: {
            sessionId: `sess_${ticketNumber}`,
            lastUserMessage: profile.sampleIssues[i % profile.sampleIssues.length],
            analysisStatus: 'completed',
          },
        });
      }
      return tickets;
    };

    const omarTickets = generateTicketsFor(omar, {
      ticketCount: 35,
      escalationRate: 0.10,
      responseMin: 1,
      responseMax: 6,
      resolutionMin: 20,
      resolutionMax: 120,
      maxDaysBack: 7,
      sampleIssues: [
        'استفسار عن مقاس تيشرت ريال مدريد',
        'طلب تغيير عنوان الشحن',
        'استفسار عن سعر حذاء نايك ميركوريال',
        'تأكيد طلب',
        'استفسار عن سياسة الاستبدال',
        'موعد التوصيل',
      ],
    });

    const fatimaTickets = generateTicketsFor(fatima, {
      ticketCount: 25,
      escalationRate: 0.28,
      responseMin: 3,
      responseMax: 25,
      resolutionMin: 60,
      resolutionMax: 360,
      maxDaysBack: 7,
      sampleIssues: [
        'شكوى تأخير في الشحن',
        'طلب استرجاع منتج',
        'مشكلة في الدفع',
        'المنتج مش مطابق للوصف',
        'شكوى من جودة الخامة',
        'طلب إلغاء طلب',
        'لم يتم استلام الطلب',
      ],
    });

    const allTickets = [...omarTickets, ...fatimaTickets];
    const createdTickets = await Ticket.insertMany(allTickets);
    console.log(`Created ${createdTickets.length} tickets`);

    const feedbacks = [];
    createdTickets.forEach((t) => {
      const isOmar = t.assignedTo.toString() === omar._id.toString();
      const ratingChance = Math.random();
      let rating;
      if (isOmar) {
        rating = ratingChance < 0.7 ? 5 : (ratingChance < 0.9 ? 4 : 3);
      } else {
        rating = ratingChance < 0.2 ? 5 : (ratingChance < 0.5 ? 4 : (ratingChance < 0.75 ? 3 : (ratingChance < 0.9 ? 2 : 1)));
      }

      const commentMap = {
        5: 'خدمة ممتازة وشكراً',
        4: 'خدمة جيدة',
        3: 'مقبول',
        2: 'تحتاج تحسين',
        1: 'خدمة سيئة',
      };

      feedbacks.push({
        companyId,
        ticketId: t._id,
        agentId: t.assignedTo,
        userId: khaled._id,
        rating,
        comment: commentMap[rating] || null,
        channel: t.channel,
        submittedAt: new Date(t.resolvedAt.getTime() + 3600000),
      });
    });

    await TicketFeedback.insertMany(feedbacks);
    console.log(`Created ${feedbacks.length} feedback records`);

    const omarResolved = createdTickets.filter((t) => t.assignedTo.toString() === omar._id.toString()).length;
    const fatimaResolved = createdTickets.filter((t) => t.assignedTo.toString() === fatima._id.toString()).length;
    console.log(`\nOmar: ${omarResolved} tickets resolved`);
    console.log(`Fatima: ${fatimaResolved} tickets resolved`);

    console.log('\n==========================================');
    console.log('  TICKET SEED COMPLETE');
    console.log('==========================================');
    console.log('\nAgent performance endpoint now has data:');
    console.log('  GET /api/v1/team-leader/agents/:agentId/performance?period=week');
    console.log('  Login as teamlead@primestore.com / teamlead123');
    console.log('==========================================\n');

    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
};

seed();
