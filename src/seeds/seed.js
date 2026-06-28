import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

import { Company, User, KnowledgeItem, SubscriptionPlan, ChatSession, Ticket, TicketFeedback, Call, EventLog } from '../models/index.js';
import { ROLES, KNOWLEDGE_TYPE, SUBSCRIPTION_STATUS, TICKET_STATUS, TICKET_PRIORITY, TICKET_CATEGORY, CHANNELS, CHAT_STATUS, EVENT_TYPES } from '../constants/index.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/natiq';

const seed = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    await Promise.all([
      Company.deleteMany({}),
      User.deleteMany({}),
      KnowledgeItem.deleteMany({}),
      SubscriptionPlan.deleteMany({}),
      ChatSession.deleteMany({}),
      Ticket.deleteMany({}),
      TicketFeedback.deleteMany({}),
      Call.deleteMany({}),
      EventLog.deleteMany({}),
    ]);
    console.log('Cleared existing data');

    // ─────────────────────────────────────────────────
    //  SUBSCRIPTION PLANS (TIERS)
    // ─────────────────────────────────────────────────
    const [starter, growth, enterprise, enterpriseYearly] = await SubscriptionPlan.insertMany([
      {
        name: 'Starter',
        code: 'starter',
        description: 'For small businesses getting started with customer support',
        price: 29,
        currency: 'USD',
        interval: 'monthly',
        features: [
          { text: 'Up to 2 agents', included: true },
          { text: 'Web chat channel', included: true },
          { text: '100 chats/day', included: true },
          { text: '50 tickets/day', included: true },
          { text: '50 knowledge items', included: true },
          { text: 'AI-powered responses', included: true },
          { text: 'Telegram integration', included: false },
          { text: 'WhatsApp integration', included: false },
          { text: 'Voice calls', included: false },
          { text: 'CSV exports', included: false },
          { text: 'Priority support', included: false },
          { text: 'Custom branding', included: false },
        ],
        limits: { maxAgents: 2, maxChatsPerDay: 100, maxTicketsPerDay: 50, maxKnowledgeItems: 50, aiEnabled: true, channels: ['web'], storageGb: 2 },
        sortOrder: 1,
      },
      {
        name: 'Growth',
        code: 'growth',
        description: 'For growing teams that need multi-channel support',
        price: 79,
        currency: 'USD',
        interval: 'monthly',
        features: [
          { text: 'Up to 10 agents', included: true },
          { text: 'Web chat + Telegram + WhatsApp', included: true },
          { text: '500 chats/day', included: true },
          { text: '200 tickets/day', included: true },
          { text: '500 knowledge items', included: true },
          { text: 'AI-powered responses', included: true },
          { text: 'Telegram integration', included: true },
          { text: 'WhatsApp integration', included: true },
          { text: 'Voice calls', included: false },
          { text: 'CSV exports', included: true },
          { text: 'Priority support', included: false },
          { text: 'Custom branding', included: true },
        ],
        limits: { maxAgents: 10, maxChatsPerDay: 500, maxTicketsPerDay: 200, maxKnowledgeItems: 500, aiEnabled: true, channels: ['web', 'telegram', 'whatsapp'], storageGb: 10 },
        sortOrder: 2,
      },
      {
        name: 'Enterprise',
        code: 'enterprise',
        description: 'Full-featured plan for large organizations with custom needs',
        price: 199,
        currency: 'USD',
        interval: 'monthly',
        features: [
          { text: 'Unlimited agents', included: true },
          { text: 'All channels (web, Telegram, WhatsApp, Voice)', included: true },
          { text: 'Unlimited chats', included: true },
          { text: 'Unlimited tickets', included: true },
          { text: 'Unlimited knowledge items', included: true },
          { text: 'AI-powered responses', included: true },
          { text: 'Telegram integration', included: true },
          { text: 'WhatsApp integration', included: true },
          { text: 'Voice calls', included: true },
          { text: 'CSV exports + advanced analytics', included: true },
          { text: 'Priority support', included: true },
          { text: 'Custom branding', included: true },
        ],
        limits: { maxAgents: 999, maxChatsPerDay: 99999, maxTicketsPerDay: 99999, maxKnowledgeItems: 9999, aiEnabled: true, channels: ['web', 'telegram', 'whatsapp', 'voice'], storageGb: 50 },
        sortOrder: 3,
      },
      {
        name: 'Enterprise Yearly',
        code: 'enterprise-yearly',
        description: 'Enterprise plan with yearly billing (2 months free)',
        price: 166,
        currency: 'USD',
        interval: 'yearly',
        features: [
          { text: 'Unlimited agents', included: true },
          { text: 'All channels', included: true },
          { text: 'Unlimited chats & tickets', included: true },
          { text: 'Priority support', included: true },
          { text: 'Custom AI model tuning', included: true },
          { text: 'Dedicated account manager', included: true },
          { text: '99.9% uptime SLA', included: true },
        ],
        limits: { maxAgents: 999, maxChatsPerDay: 99999, maxTicketsPerDay: 99999, maxKnowledgeItems: 9999, aiEnabled: true, channels: ['web', 'telegram', 'whatsapp', 'voice'], storageGb: 100 },
        sortOrder: 4,
      },
    ]);
    console.log(`Created ${4} subscription plans: Starter, Growth, Enterprise, Enterprise Yearly`);

    // ─────────────────────────────────────────────────
    //  COMPANIES
    // ─────────────────────────────────────────────────

    // 1) Prime Store — active on Growth plan, full data
    const primeStore = await Company.create({
      name: 'Prime Store',
      slug: 'prime-store',
      industry: 'sports_retail',
      channelsConfig: {
        telegram: {
          isActive: true,
          botToken: '8462814216:AAFrx9oIyJ0phTZWjp0ZZuHY1NbZRMqq7nQ',
          webhookUrl: 'https://natiq-api.vercel.app/api/v1/channels/telegram/webhook',
          webhookSecret: 'whsec_prime_telegram_2024',
        },
        whatsapp: {
          isActive: true,
          phoneNumberId: '123456789',
          accessToken: 'EAAxZByZBAg8zQBOzZByZBAg8zQ',
        },
        webChat: {
          isActive: true,
          color: '#042835',
          welcomeMessage: 'مرحباً بك في برايم ستور! كيف يمكننا مساعدتك اليوم؟',
        },
      },
      integrations: {
        webhooks: [
          {
            name: 'Order Updates',
            url: 'https://api.primestore.com/webhooks/natiq',
            secret: 'whsec_primestore_orders',
            events: ['ticket_created', 'ticket_resolved', 'message_received'],
            isActive: true,
          },
        ],
        apiKeys: [
          {
            name: 'Production API Key',
            key: 'pk_primestore_prod_abc123def456',
            permissions: ['read_tickets', 'write_tickets', 'manage_agents'],
            isActive: true,
          },
        ],
        aiModels: {
          provider: 'openai',
          modelName: 'gpt-4o-mini',
          temperature: 0.7,
          maxTokens: 2000,
        },
      },
      settings: {
        aiEnabled: true,
        escalationThreshold: 0.5,
        maxSessionMessages: 50,
        workingHours: {
          start: '10:00',
          end: '22:00',
          timezone: 'Africa/Cairo',
        },
      },
      subscription: {
        planId: growth._id,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        startDate: new Date('2025-01-15'),
        endDate: new Date('2026-07-15'),
        trialEndDate: new Date('2025-02-15'),
        autoRenew: true,
      },
      billingInfo: {
        email: 'billing@primestore.com',
        phone: '+201234567890',
        address: {
          line1: '12 Tahrir Street',
          line2: 'Downtown, Apt 4',
          city: 'Cairo',
          state: 'Cairo Governorate',
          country: 'Egypt',
          postalCode: '11511',
        },
      },
      invoices: [
        {
          invoiceNumber: 'INV-2025-001',
          amount: 79,
          currency: 'USD',
          status: 'paid',
          planId: growth._id,
          planName: 'Growth',
          periodStart: new Date('2025-01-15'),
          periodEnd: new Date('2025-02-15'),
          paidAt: new Date('2025-01-15'),
          dueDate: new Date('2025-01-20'),
          paymentMethod: 'Visa **** 4242',
          notes: 'First month payment',
        },
        {
          invoiceNumber: 'INV-2025-002',
          amount: 79,
          currency: 'USD',
          status: 'paid',
          planId: growth._id,
          planName: 'Growth',
          periodStart: new Date('2025-02-15'),
          periodEnd: new Date('2025-03-15'),
          paidAt: new Date('2025-02-14'),
          dueDate: new Date('2025-02-20'),
          paymentMethod: 'Visa **** 4242',
        },
        {
          invoiceNumber: 'INV-2025-003',
          amount: 79,
          currency: 'USD',
          status: 'paid',
          planId: growth._id,
          planName: 'Growth',
          periodStart: new Date('2025-03-15'),
          periodEnd: new Date('2025-04-15'),
          paidAt: new Date('2025-03-15'),
          dueDate: new Date('2025-03-20'),
          paymentMethod: 'Visa **** 4242',
        },
        {
          invoiceNumber: 'INV-2025-004',
          amount: 79,
          currency: 'USD',
          status: 'paid',
          planId: growth._id,
          planName: 'Growth',
          periodStart: new Date('2025-04-15'),
          periodEnd: new Date('2025-05-15'),
          paidAt: new Date('2025-04-14'),
          dueDate: new Date('2025-04-20'),
          paymentMethod: 'Visa **** 4242',
        },
        {
          invoiceNumber: 'INV-2025-005',
          amount: 79,
          currency: 'USD',
          status: 'paid',
          planId: growth._id,
          planName: 'Growth',
          periodStart: new Date('2025-05-15'),
          periodEnd: new Date('2025-06-15'),
          paidAt: new Date('2025-05-15'),
          dueDate: new Date('2025-05-20'),
          paymentMethod: 'Mastercard **** 5678',
        },
        {
          invoiceNumber: 'INV-2025-006',
          amount: 79,
          currency: 'USD',
          status: 'paid',
          planId: growth._id,
          planName: 'Growth',
          periodStart: new Date('2025-06-15'),
          periodEnd: new Date('2025-07-15'),
          paidAt: new Date('2025-06-15'),
          dueDate: new Date('2025-06-20'),
          paymentMethod: 'Mastercard **** 5678',
        },
      ],
      isActive: true,
    });
    console.log(`Company created: ${primeStore.name} (${primeStore.slug}) — Growth plan, $554 total paid`);

    // 2) TechMart — on Starter plan (trialing)
    const techMart = await Company.create({
      name: 'TechMart Egypt',
      slug: 'techmart-eg',
      industry: 'ecommerce',
      channelsConfig: {
        telegram: { isActive: false },
        whatsapp: { isActive: false },
        webChat: { isActive: true, color: '#2563EB', welcomeMessage: 'Welcome to TechMart! How can we help?' },
      },
      settings: {
        aiEnabled: true,
        escalationThreshold: 0.6,
        maxSessionMessages: 30,
        workingHours: { start: '09:00', end: '18:00', timezone: 'Africa/Cairo' },
      },
      subscription: {
        planId: starter._id,
        status: SUBSCRIPTION_STATUS.TRIALING,
        startDate: new Date('2026-06-01'),
        endDate: new Date('2026-07-01'),
        trialEndDate: new Date('2026-06-15'),
        autoRenew: true,
      },
      billingInfo: {
        email: 'accounts@techmart-eg.com',
        phone: '+201001234567',
        address: { line1: '45 Abbas El-Akkad', city: 'Nasr City', state: 'Cairo', country: 'Egypt', postalCode: '11765' },
      },
      isActive: true,
    });
    console.log(`Company created: ${techMart.name} (${techMart.slug}) — Starter (trialing)`);

    // 3) Gulf Bank — on Enterprise plan, active
    const gulfBank = await Company.create({
      name: 'Gulf Bank',
      slug: 'gulf-bank',
      industry: 'banking',
      channelsConfig: {
        telegram: { isActive: false },
        whatsapp: { isActive: true, phoneNumberId: '987654321', accessToken: 'EAAxBankToken' },
        webChat: { isActive: true, color: '#1E3A5F', welcomeMessage: 'Welcome to Gulf Bank. How may we assist you?' },
      },
      settings: {
        aiEnabled: true,
        escalationThreshold: 0.3,
        maxSessionMessages: 100,
        workingHours: { start: '08:00', end: '20:00', timezone: 'Asia/Riyadh' },
      },
      subscription: {
        planId: enterprise._id,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        startDate: new Date('2025-11-01'),
        endDate: new Date('2026-11-01'),
        autoRenew: true,
      },
      billingInfo: {
        email: 'finance@gulfbank.com',
        phone: '+966500123456',
        address: { line1: 'King Fahd Road', city: 'Riyadh', state: 'Riyadh Province', country: 'Saudi Arabia', postalCode: '11564' },
      },
      invoices: [
        {
          invoiceNumber: 'GB-INV-2025-001',
          amount: 199,
          currency: 'USD',
          status: 'paid',
          planId: enterprise._id,
          planName: 'Enterprise',
          periodStart: new Date('2025-11-01'),
          periodEnd: new Date('2025-12-01'),
          paidAt: new Date('2025-11-01'),
          dueDate: new Date('2025-11-05'),
          paymentMethod: 'Wire Transfer',
        },
        {
          invoiceNumber: 'GB-INV-2025-002',
          amount: 199,
          currency: 'USD',
          status: 'paid',
          planId: enterprise._id,
          planName: 'Enterprise',
          periodStart: new Date('2025-12-01'),
          periodEnd: new Date('2026-01-01'),
          paidAt: new Date('2025-12-01'),
          dueDate: new Date('2025-12-05'),
          paymentMethod: 'Wire Transfer',
        },
        {
          invoiceNumber: 'GB-INV-2026-001',
          amount: 199,
          currency: 'USD',
          status: 'paid',
          planId: enterprise._id,
          planName: 'Enterprise',
          periodStart: new Date('2026-01-01'),
          periodEnd: new Date('2026-02-01'),
          paidAt: new Date('2026-01-02'),
          dueDate: new Date('2026-01-05'),
          paymentMethod: 'Wire Transfer',
        },
        {
          invoiceNumber: 'GB-INV-2026-002',
          amount: 199,
          currency: 'USD',
          status: 'pending',
          planId: enterprise._id,
          planName: 'Enterprise',
          periodStart: new Date('2026-06-01'),
          periodEnd: new Date('2026-07-01'),
          dueDate: new Date('2026-06-05'),
          paymentMethod: 'Wire Transfer',
        },
      ],
      isActive: true,
    });
    console.log(`Company created: ${gulfBank.name} (${gulfBank.slug}) — Enterprise, $796 total paid`);

    // 4) FreshCart — on Starter (canceled)
    const freshCart = await Company.create({
      name: 'FreshCart',
      slug: 'freshcart',
      industry: 'ecommerce',
      channelsConfig: {
        telegram: { isActive: false },
        whatsapp: { isActive: false },
        webChat: { isActive: true, color: '#22C55E', welcomeMessage: 'Welcome to FreshCart! Order fresh groceries online.' },
      },
      settings: { aiEnabled: false, escalationThreshold: 0.7, maxSessionMessages: 20 },
      subscription: {
        planId: starter._id,
        status: SUBSCRIPTION_STATUS.CANCELED,
        startDate: new Date('2025-03-01'),
        endDate: new Date('2025-06-01'),
        autoRenew: false,
      },
      billingInfo: {
        email: 'owner@freshcart.com',
        phone: '+201098765432',
        address: { line1: '7 El-Horreya Road', city: 'Alexandria', state: 'Alexandria Governorate', country: 'Egypt', postalCode: '21511' },
      },
      invoices: [
        {
          invoiceNumber: 'FC-INV-2025-001',
          amount: 29,
          currency: 'USD',
          status: 'paid',
          planId: starter._id,
          planName: 'Starter',
          periodStart: new Date('2025-03-01'),
          periodEnd: new Date('2025-04-01'),
          paidAt: new Date('2025-03-01'),
          dueDate: new Date('2025-03-05'),
          paymentMethod: 'Visa **** 1111',
        },
        {
          invoiceNumber: 'FC-INV-2025-002',
          amount: 29,
          currency: 'USD',
          status: 'paid',
          planId: starter._id,
          planName: 'Starter',
          periodStart: new Date('2025-04-01'),
          periodEnd: new Date('2025-05-01'),
          paidAt: new Date('2025-04-01'),
          dueDate: new Date('2025-04-05'),
          paymentMethod: 'Visa **** 1111',
        },
        {
          invoiceNumber: 'FC-INV-2025-003',
          amount: 29,
          currency: 'USD',
          status: 'refunded',
          planId: starter._id,
          planName: 'Starter',
          periodStart: new Date('2025-05-01'),
          periodEnd: new Date('2025-06-01'),
          paidAt: new Date('2025-05-01'),
          dueDate: new Date('2025-05-05'),
          paymentMethod: 'Visa **** 1111',
          notes: 'Canceled and refunded upon request',
        },
      ],
      isActive: false,
    });
    console.log(`Company created: ${freshCart.name} (${freshCart.slug}) — Starter (canceled)`);

    // 5) Saudi Health — on Enterprise Yearly (active, past_due invoice)
    const saudiHealth = await Company.create({
      name: 'Saudi Health Corp',
      slug: 'saudi-health',
      industry: 'healthcare',
      channelsConfig: {
        telegram: { isActive: true, botToken: 'health_bot_token' },
        whatsapp: { isActive: true, phoneNumberId: '555111222', accessToken: 'health_wa_token' },
        webChat: { isActive: true, color: '#059669', welcomeMessage: 'Welcome to Saudi Health Corp. How can we assist with your healthcare needs?' },
      },
      settings: { aiEnabled: true, escalationThreshold: 0.4, maxSessionMessages: 80 },
      subscription: {
        planId: enterpriseYearly._id,
        status: SUBSCRIPTION_STATUS.PAST_DUE,
        startDate: new Date('2025-06-01'),
        endDate: new Date('2026-06-01'),
        autoRenew: true,
      },
      billingInfo: {
        email: 'ap@saudihealth.com',
        phone: '+966550987654',
        address: { line1: 'Prince Mohammed Bin Salman Road', city: 'Jeddah', state: 'Makkah Province', country: 'Saudi Arabia', postalCode: '21589' },
      },
      invoices: [
        {
          invoiceNumber: 'SH-INV-2025-001',
          amount: 1992,
          currency: 'USD',
          status: 'paid',
          planId: enterpriseYearly._id,
          planName: 'Enterprise Yearly',
          periodStart: new Date('2025-06-01'),
          periodEnd: new Date('2026-06-01'),
          paidAt: new Date('2025-06-01'),
          dueDate: new Date('2025-06-05'),
          paymentMethod: 'Bank Transfer',
          notes: 'Annual payment 2025-2026',
        },
        {
          invoiceNumber: 'SH-INV-2026-001',
          amount: 1992,
          currency: 'USD',
          status: 'overdue',
          planId: enterpriseYearly._id,
          planName: 'Enterprise Yearly',
          periodStart: new Date('2026-06-01'),
          periodEnd: new Date('2027-06-01'),
          dueDate: new Date('2026-06-05'),
          paymentMethod: 'Bank Transfer',
          notes: 'Annual renewal — overdue',
        },
      ],
      isActive: true,
    });
    console.log(`Company created: ${saudiHealth.name} (${saudiHealth.slug}) — Enterprise Yearly (past_due)`);

    // ─────────────────────────────────────────────────
    //  USERS
    // ─────────────────────────────────────────────────

    // Super Admin (platform-wide)
    const superAdmin = await User.create({
      companyId: primeStore._id,
      name: 'Platform Admin',
      email: 'admin@primestore.com',
      passwordHash: 'admin123',
      role: ROLES.PLATFORM_SUPER_ADMIN,
      isActive: true,
    });
    console.log(`Super Admin: ${superAdmin.email} / admin123`);

    // Owner (Natiq team — platform-level, sees all companies)
    const owner = await User.create({
      companyId: primeStore._id,
      name: 'Ahmed Natiq',
      email: 'owner@primestore.com',
      passwordHash: 'owner123',
      role: ROLES.COMPANY_OWNER,
      isActive: true,
      phone: '+201111111111',
    });
    console.log(`Owner (Natiq Team): ${owner.email} / owner123`);

    // Prime Store users
    const manager = await User.create({
      companyId: primeStore._id,
      name: 'Ahmad Al-Manager',
      email: 'manager@primestore.com',
      passwordHash: 'manager123',
      role: ROLES.COMPANY_MANAGER,
      isActive: true,
      phone: '+201122334455',
    });
    console.log(`Manager: ${manager.email} / manager123`);

    const teamLeader = await User.create({
      companyId: primeStore._id,
      name: 'Sara Al-Qaed',
      email: 'teamlead@primestore.com',
      passwordHash: 'teamlead123',
      role: ROLES.TEAM_LEADER,
      isActive: true,
      phone: '+201155667788',
    });
    console.log(`Team Leader: ${teamLeader.email} / teamlead123`);

    const agent1 = await User.create({
      companyId: primeStore._id,
      name: 'Omar Hassan',
      email: 'omar@primestore.com',
      passwordHash: 'agent123',
      role: ROLES.AGENT,
      isActive: true,
      phone: '+201166778899',
      teamLeaderId: teamLeader._id,
    });
    console.log(`Agent: ${agent1.email} / agent123`);

    const agent2 = await User.create({
      companyId: primeStore._id,
      name: 'Fatima Ali',
      email: 'fatima@primestore.com',
      passwordHash: 'agent123',
      role: ROLES.AGENT,
      isActive: true,
      phone: '+201177889900',
      teamLeaderId: teamLeader._id,
    });
    console.log(`Agent: ${agent2.email} / agent123`);

    const agent3 = await User.create({
      companyId: primeStore._id,
      name: 'Khaled Youssef',
      email: 'khaled.agent@primestore.com',
      passwordHash: 'agent123',
      role: ROLES.AGENT,
      isActive: true,
      phone: '+201188990011',
      teamLeaderId: teamLeader._id,
    });
    console.log(`Agent: ${agent3.email} / agent123`);

    const customer = await User.create({
      companyId: primeStore._id,
      name: 'Khaled Mahmoud',
      email: 'khaled@example.com',
      passwordHash: 'customer123',
      phone: '+964770123456',
      role: ROLES.CUSTOMER,
      isActive: true,
    });
    console.log(`Customer: ${customer.email} / customer123`);

    // Additional customers for ticket data
    const customer2 = await User.create({
      companyId: primeStore._id,
      name: 'Noura Hassan',
      email: 'noura@example.com',
      passwordHash: 'customer123',
      phone: '+201234567891',
      role: ROLES.CUSTOMER,
      isActive: true,
    });

    const customer3 = await User.create({
      companyId: primeStore._id,
      name: 'Mohamed Ali',
      email: 'mohamed@example.com',
      passwordHash: 'customer123',
      phone: '+201234567892',
      role: ROLES.CUSTOMER,
      isActive: true,
    });

    // TechMart users
    const techMartManager = await User.create({
      companyId: techMart._id,
      name: 'Karim Mansour',
      email: 'manager@techmart-eg.com',
      passwordHash: 'manager123',
      role: ROLES.COMPANY_MANAGER,
      isActive: true,
    });

    const techMartAgent = await User.create({
      companyId: techMart._id,
      name: 'Laila Sherif',
      email: 'agent@techmart-eg.com',
      passwordHash: 'agent123',
      role: ROLES.AGENT,
      isActive: true,
    });

    // Gulf Bank users
    const gulfBankManager = await User.create({
      companyId: gulfBank._id,
      name: 'Faisal Al-Rashid',
      email: 'manager@gulfbank.com',
      passwordHash: 'manager123',
      role: ROLES.COMPANY_MANAGER,
      isActive: true,
    });

    const gulfBankAgent1 = await User.create({
      companyId: gulfBank._id,
      name: 'Nora Al-Saud',
      email: 'agent1@gulfbank.com',
      passwordHash: 'agent123',
      role: ROLES.AGENT,
      isActive: true,
    });

    const gulfBankAgent2 = await User.create({
      companyId: gulfBank._id,
      name: 'Majid Al-Otaibi',
      email: 'agent2@gulfbank.com',
      passwordHash: 'agent123',
      role: ROLES.AGENT,
      isActive: true,
    });

    // ─────────────────────────────────────────────────
    //  KNOWLEDGE BASE (Prime Store)
    // ─────────────────────────────────────────────────
    const primeKnowledge = await KnowledgeItem.insertMany([
      {
        companyId: primeStore._id,
        type: KNOWLEDGE_TYPE.PACKAGE,
        title: 'تيشرت ريال مدريد الأساسي 2024',
        subtitle: 'أعلى جودة ميرور أوريجينال',
        content: 'تيشرت ريال مدريد الأساسي للموسم الجديد، خامة دراي فيت مريحة جداً ومضادة للتعرق. السعر: 450 جنيه. متاح جميع المقاسات من S لـ XXL. التوصيل متوفر لجميع المحافظات خلال 3-5 أيام عمل.',
        features: ['خامة دراي فيت', 'مضاد للتعرق', 'جميع المقاسات'],
        slug: 'real-madrid-home-2024',
      },
      {
        companyId: primeStore._id,
        type: KNOWLEDGE_TYPE.PACKAGE,
        title: 'حذاء كرة قدم نايك ميركوريال',
        subtitle: 'للعشب الصناعي والطبيعي',
        content: 'حذاء نايك ميركوريال بجودة عالية، يتميز بخفة الوزن والسرعة في الملعب. السعر: 1200 جنيه. المقاسات المتاحة من 40 إلى 45. الشحن مجاني عند الدفع المسبق.',
        features: ['خفيف الوزن', 'مناسب للعشب الصناعي', 'مريح للقدم'],
        slug: 'nike-mercurial-shoes',
      },
      {
        companyId: primeStore._id,
        type: KNOWLEDGE_TYPE.PACKAGE,
        title: 'تيشرت مانشستر سيتي الاحتياطي 2024',
        subtitle: 'ألوان جذابة وخامة ممتازة',
        content: 'تيشرت السيتي الجديد باللون الداكن، مناسب للمباريات والخروج العفوي. السعر: 450 جنيه. التوصيل لباب البيت.',
        features: ['خامة ممتازة', 'ألوان ثابتة', 'مريح'],
        slug: 'man-city-away-2024',
      },
      {
        companyId: primeStore._id,
        type: KNOWLEDGE_TYPE.PACKAGE,
        title: 'طقم برشلونة الكامل 2024/2025',
        subtitle: 'الطقم الرسمي الكامل',
        content: 'طقم برشلونة الكامل يشمل التيشرت والشورت والشراب. السعر: 1200 جنيه للطقم الكامل. متاح جميع المقاسات. خامة دراي فيت أصلية 100%.',
        features: ['طقم كامل', 'دراي فيت', 'أصلي 100%'],
        slug: 'barca-full-kit-2024',
      },
      {
        companyId: primeStore._id,
        type: KNOWLEDGE_TYPE.PACKAGE,
        title: 'حذاء اديداس بريداتور',
        subtitle: 'للعب على النجيل الطبيعي',
        content: 'حذاء اديداس بريداتور الجيل الجديد. تقنية Demonskin للتحكم بالكرة. السعر: 1500 جنيه. متاح من مقاس 39 إلى 46.',
        features: ['تقنية Demonskin', 'التحكم بالكرة', 'نجيل طبيعي'],
        slug: 'adidas-predator',
      },
      {
        companyId: primeStore._id,
        type: KNOWLEDGE_TYPE.FAQ,
        title: 'طرق الدفع وتكلفة الشحن',
        content: 'بنقبل الدفع عند الاستلام، أو الدفع المقدم عن طريق فودافون كاش ومحافظ إلكترونية تانية. مصاريف الشحن بتكون 45 جنيه للقاهرة والجيزة، و60 جنيه لباقي المحافظات. الشحن بياخد من يومين لـ 5 أيام عمل بالكثير.',
        features: ['دفع عند الاستلام', 'فودافون كاش', 'محافظ إلكترونية'],
        slug: 'payment-and-shipping',
      },
      {
        companyId: primeStore._id,
        type: KNOWLEDGE_TYPE.FAQ,
        title: 'كيفية اختيار مقاس التيشرت والحذاء المناسب',
        content: 'عشان تختار المقاس صح، بننصحك دايماً تشوف جدول المقاسات بتاعنا المرفق مع كل منتج. لو محتار بين مقاسين في الأحذية الرياضية، الأفضل تاخد المقاس الأكبر نمرة. ولو مش متأكد، فريق المبيعات هيساعدك تأكد المقاس قبل شحن الأوردر.',
        features: ['جدول مقاسات', 'دليل اختيار المقاس'],
        slug: 'how-to-choose-size',
      },
      {
        companyId: primeStore._id,
        type: KNOWLEDGE_TYPE.FAQ,
        title: 'سياسة الاستبدال والاسترجاع',
        content: 'يمكنك الاستبدال أو الاسترجاع خلال 14 يوم من تاريخ استلام الطلب، بشرط أن يكون المنتج في حالته الأصلية ومرفق مع الجلاد أو الكرتونة الخاصة بيه. مصاريف شحن الاستبدال يتحملها العميل إلا لو فيه عيب صناعة في المنتج.',
        features: ['إرجاع خلال 14 يوم', 'استبدال وتغيير مقاس', 'ضمان عيوب'],
        slug: 'return-policy',
      },
      {
        companyId: primeStore._id,
        type: KNOWLEDGE_TYPE.FAQ,
        title: 'مدة التوصيل للطلب',
        content: 'مدة التوصيل من 2 إلى 5 أيام عمل حسب المحافظة. القاهرة والجيزة يومين عمل. باقي المحافظات من 3 لـ 5 أيام. الطلب بيتم تجهيزه خلال 24 ساعة من تأكيده.',
        features: ['توصيل سريع', 'متابعة الطلب', 'تغليف آمن'],
        slug: 'delivery-timeline',
      },
      {
        companyId: primeStore._id,
        type: KNOWLEDGE_TYPE.POLICY,
        title: 'مواعيد العمل',
        content: 'فريق دعم برايم ستور متاح لخدمتكم يومياً من الساعة 10 صباحاً وحتى 10 مساءً، ما عدا الجمعة بنكون متاحين من 2 ظهراً لـ 10 مساءً.',
        slug: 'working-hours',
      },
      {
        companyId: primeStore._id,
        type: KNOWLEDGE_TYPE.POLICY,
        title: 'جودة الأحذية',
        content: 'جميع الأحذية عندنا ميرور أوريجينال بنسبة 100% وبنفس خامات ومواصفات الأصلي، مناسبة جداً للعب الكورة سواء على النجيل الصناعي أو الطبيعي حسب وصف كل موديل.',
        slug: 'shoes-quality',
      },
      {
        companyId: primeStore._id,
        type: KNOWLEDGE_TYPE.POLICY,
        title: 'سياسة الخصومات والعروض',
        content: 'العروض والخصومات متاحة لفترة محدودة. الخصم لا يشمل المنتجات المخفضة مسبقاً. أقصى خصم يمكن تطبيقه هو 30% على المنتجات الموسمية. كود الخصم يستخدم مرة واحدة لكل عميل.',
        slug: 'discount-policy',
      },
      {
        companyId: primeStore._id,
        type: KNOWLEDGE_TYPE.COMPLAINT_FLOW,
        title: 'طريقة رفع الشكاوى',
        content: 'لو عندك أي مشكلة أو تأخير في الشحن: 1) تواصل معانا هنا على الشات، 2) سيقوم أحد ممثلي الخدمة بفتح تذكرة وتصعيد الموضوع لشركة الشحن، 3) يتم حل المشكلة خلال 48 ساعة بالكثير.',
        slug: 'complaint-resolution',
      },
      {
        companyId: primeStore._id,
        type: KNOWLEDGE_TYPE.COMPLAINT_FLOW,
        title: 'مشاكل استلام منتج مختلف',
        content: 'في العادة لا نخطئ في تجهيز الطلبات، لكن في حال استلمت موديل أو مقاس مختلف عن طلبك، يرجى إرسال صورة المنتج هنا وسنقوم بتوصيل المنتج الصحيح فوراً مجاناً وسحب المنتج الخطأ.',
        slug: 'wrong-item-complaint',
      },
      {
        companyId: primeStore._id,
        type: KNOWLEDGE_TYPE.COMPLAINT_FLOW,
        title: 'تأخير في الشحن',
        content: 'إذا تأخر الشحن عن المدة المحددة (3-5 أيام)، يرجى تزويدنا برقم الطلب وسنقوم بالتواصل مع شركة الشحن فوراً. في حالة التأخير أكثر من 7 أيام، سيتم تعويضك بخصم 10% على طلبك القادم.',
        slug: 'shipping-delay',
      },
    ]);
    console.log(`Created ${primeKnowledge.length} knowledge items for Prime Store`);

    // ─────────────────────────────────────────────────
    //  RICH TRANSACTIONAL DATA (Prime Store)
    //  Tickets, Chat Sessions, Calls, Feedback, Events
    //  Spread across 30 days for heatmap analytics
    // ─────────────────────────────────────────────────

    const now = new Date();
    const daysAgo = (n) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

    const agents = [agent1._id, agent2._id, agent3._id];
    const agentNames = { [agent1._id]: agent1.name, [agent2._id]: agent2.name, [agent3._id]: agent3.name };
    const customers = [customer._id, customer2._id, customer3._id];
    const channels = [CHANNELS.WEB, CHANNELS.TELEGRAM, CHANNELS.WHATSAPP_MOCK];
    const categories = [TICKET_CATEGORY.PACKAGES, TICKET_CATEGORY.PAYMENT, TICKET_CATEGORY.COMPLAINT, TICKET_CATEGORY.REFUND, TICKET_CATEGORY.NETWORK, TICKET_CATEGORY.BILLING, TICKET_CATEGORY.OTHER];
    const priorities = [TICKET_PRIORITY.LOW, TICKET_PRIORITY.MEDIUM, TICKET_PRIORITY.HIGH, TICKET_PRIORITY.URGENT];

    const chatIntents = ['package_info', 'billing_inquiry', 'complaint', 'order_status', 'return_request', 'shipping_info', 'payment_issue', 'size_help', 'product_availability', 'change_order'];

    // ── Build 25 chat sessions across 30 days ──────
    const sessionData = [];
    const sessionRefs = {};
    let sessCounter = 0;
    for (let d = 29; d >= 0; d--) {
      const sessionsPerDay = d >= 25 ? 0 : (d >= 20 ? (d % 2 === 0 ? 1 : 0) : (d % 3 === 0 ? 1 : d % 4 === 0 ? 1 : 0));
      for (let s = 0; s < sessionsPerDay; s++) {
        sessCounter++;
        const ch = channels[s % channels.length];
        const isClosed = d > 5 && Math.random() > 0.3;
        const sid = `sess_${String(sessCounter).padStart(3, '0')}`;
        const nMsg = Math.floor(Math.random() * 4) + 2;
        const msgs = [];
        for (let m = 0; m < nMsg; m++) {
          msgs.push({ role: m % 2 === 0 ? 'user' : 'assistant', content: `message ${m + 1} session ${sessCounter}`, timestamp: daysAgo(d - m * 0.04) });
        }
        sessionData.push({
          companyId: primeStore._id,
          userId: customers[s % customers.length],
          sessionId: sid,
          status: isClosed ? CHAT_STATUS.CLOSED : CHAT_STATUS.ACTIVE,
          channel: ch,
          messages: msgs,
          messageCount: nMsg,
          isAgentHandling: !isClosed || Math.random() > 0.5,
          assignedAgent: !isClosed ? agents[s % 3] : null,
          createdAt: daysAgo(d),
          lastActivity: daysAgo(Math.max(0, d - 1)),
        });
        sessionRefs[sid] = { day: d, channel: ch, userId: customers[s % customers.length] };
      }
    }
    const sessions = await ChatSession.insertMany(sessionData);
    console.log(`Created ${sessions.length} chat sessions`);

    // ── Build 30 tickets across 30 days ────────────
    const ticketData = [];
    let ticketCounter = 0;
    for (let d = 29; d >= 0; d--) {
      const ticketsPerDay = d >= 27 ? (d % 5 === 0 ? 1 : 0) : (d % 3 === 0 ? 1 : d % 2 === 0 ? 1 : d % 5 === 0 ? 1 : 0);
      for (let t = 0; t < ticketsPerDay; t++) {
        const ch = channels[t % channels.length];
        const cat = categories[(d + t) % categories.length];
        const pri = priorities[(d + t) % priorities.length];
        const agentIdx = (d + t) % 3;
        const cusIdx = (d + t) % 3;
        const isResolved = d > 10 && Math.random() > 0.2;
        const isClaimed = d > 5 && Math.random() > 0.3;
        ticketCounter++;
        const ticketNum = `NQ-${new Date(daysAgo(d)).toISOString().slice(0, 10).replace(/-/g, '')}-${String(ticketCounter).padStart(4, '0')}`;

        ticketData.push({
          companyId: primeStore._id,
          ticketNumber: ticketNum,
          userId: customers[cusIdx],
          assignedTo: isClaimed ? agents[agentIdx] : null,
          channel: ch,
          category: cat,
          priority: pri,
          status: isResolved ? TICKET_STATUS.CLOSED : (isClaimed ? TICKET_STATUS.OPENED : TICKET_STATUS.PENDING),
          context: { lastUserMessage: `Customer inquiry about ${cat}`, aiSummary: `Customer asked about ${cat} via ${ch}` },
          agentNotes: isClaimed ? [{ agentId: agents[agentIdx], content: `Agent ${agentNames[agents[agentIdx]]} handled this ticket`, createdAt: daysAgo(d - 1) }] : [],
          firstResponseAt: isClaimed ? daysAgo(d - 0.5) : null,
          resolvedAt: isResolved ? daysAgo(Math.max(0, d - 2)) : null,
          createdAt: daysAgo(d),
        });
      }
    }
    const tickets = await Ticket.insertMany(ticketData);
    console.log(`Created ${tickets.length} tickets`);

    // ── Ticket feedback (on closed tickets) ────────
    const closedTickets = await Ticket.find({ companyId: primeStore._id, status: TICKET_STATUS.CLOSED }).select('_id userId channel').lean();
    const feedbackData = closedTickets.map((t, i) => ({
      companyId: primeStore._id,
      ticketId: t._id,
      userId: t.userId,
      channel: t.channel || 'web',
      rating: 3 + (i % 3),
      comment: i % 2 === 0 ? 'خدمة ممتازة' : 'Good service',
      createdAt: daysAgo(i * 2),
    }));
    await TicketFeedback.insertMany(feedbackData);
    console.log(`Created ${feedbackData.length} ticket feedback entries`);

    // ── Event logs with intents for heatmap ───────
    const eventLogs = [];
    const allSessions = await ChatSession.find({ companyId: primeStore._id }).select('_id sessionId channel createdAt').lean();
    const allTickets = await Ticket.find({ companyId: primeStore._id }).select('_id ticketNumber channel createdAt status').lean();

    allSessions.forEach(s => {
      const d = Math.floor((now - s.createdAt) / (24 * 60 * 60 * 1000));
      eventLogs.push({
        companyId: primeStore._id,
        eventType: EVENT_TYPES.CHAT_SESSION_CREATED,
        entityType: 'chat_session',
        entityId: s._id,
        metadata: { channel: s.channel },
        timestamp: s.createdAt,
      });
      eventLogs.push({
        companyId: primeStore._id,
        eventType: EVENT_TYPES.CHAT_MESSAGE,
        entityType: 'chat_session',
        entityId: s._id,
        metadata: { channel: s.channel, intent: chatIntents[d % chatIntents.length] },
        timestamp: new Date(s.createdAt.getTime() + 60000),
      });
    });

    allTickets.forEach(t => {
      eventLogs.push({
        companyId: primeStore._id,
        eventType: EVENT_TYPES.TICKET_CREATED,
        entityType: 'ticket',
        entityId: t._id,
        metadata: { ticketNumber: t.ticketNumber, channel: t.channel },
        timestamp: t.createdAt,
      });
      if (t.status === TICKET_STATUS.CLOSED) {
        eventLogs.push({
          companyId: primeStore._id,
          eventType: EVENT_TYPES.TICKET_RESOLVED,
          entityType: 'ticket',
          entityId: t._id,
          metadata: { ticketNumber: t.ticketNumber },
          timestamp: new Date(t.createdAt.getTime() + 2 * 24 * 60 * 60 * 1000),
        });
        eventLogs.push({
          companyId: primeStore._id,
          eventType: EVENT_TYPES.TICKET_CLOSED,
          entityType: 'ticket',
          entityId: t._id,
          metadata: { ticketNumber: t.ticketNumber },
          timestamp: new Date(t.createdAt.getTime() + 2 * 24 * 60 * 60 * 1000 + 60000),
        });
      }
    });

    // Additional chat-only event logs for intent diversity
    for (let i = 0; i < 20; i++) {
      eventLogs.push({
        companyId: primeStore._id,
        eventType: EVENT_TYPES.CHAT_MESSAGE,
        entityType: 'chat_session',
        entityId: allSessions[i % allSessions.length]._id,
        metadata: { channel: 'web', intent: chatIntents[i % chatIntents.length] },
        timestamp: daysAgo(i),
      });
    }

    await EventLog.insertMany(eventLogs);
    console.log(`Created ${eventLogs.length} event logs`);

    // ── Call logs across 30 days ──────────────────
    const calls = [];
    for (let d = 29; d >= 0; d -= 3) {
      const statuses = d > 5 ? (d % 2 === 0 ? 'ended' : 'missed') : 'ended';
      calls.push({
        callId: `call_prime_${String(d).padStart(2, '0')}`,
        companyId: primeStore._id,
        customerId: customers[d % 3],
        status: statuses,
        duration: statuses === 'ended' ? Math.floor(Math.random() * 300) + 30 : 0,
        startedAt: daysAgo(d),
        endedAt: statuses === 'ended' ? daysAgo(d - 0.02) : daysAgo(d),
      });
    }
    // A few active calls for today
    calls.push({ callId: 'call_prime_active_01', companyId: primeStore._id, customerId: customers[0], status: 'active', duration: 320, startedAt: daysAgo(0), endedAt: null });
    calls.push({ callId: 'call_prime_missed_02', companyId: primeStore._id, customerId: customers[1], status: 'missed', duration: 0, startedAt: daysAgo(0), endedAt: daysAgo(0) });

    await Call.insertMany(calls);
    console.log(`Created ${calls.length} call logs`);

    // ─────────────────────────────────────────────────
    //  SUMMARY
    // ─────────────────────────────────────────────────
    const totalTickets = await Ticket.countDocuments({ companyId: primeStore._id });
    const closedCount = await Ticket.countDocuments({ companyId: primeStore._id, status: TICKET_STATUS.CLOSED });
    const openedCount = await Ticket.countDocuments({ companyId: primeStore._id, status: TICKET_STATUS.OPENED });
    const pendingCount = await Ticket.countDocuments({ companyId: primeStore._id, status: TICKET_STATUS.PENDING });
    const totalSessions = await ChatSession.countDocuments({ companyId: primeStore._id });
    const activeSessions = await ChatSession.countDocuments({ companyId: primeStore._id, status: CHAT_STATUS.ACTIVE });

    console.log('\n==========================================');
    console.log('  SEED COMPLETE');
    console.log('==========================================');
    console.log(`\n🏢 Companies:           5`);
    console.log(`   • ${primeStore.name}       — Growth (active, $474 paid)`);
    console.log(`   • ${techMart.name}    — Starter (trialing)`);
    console.log(`   • ${gulfBank.name}           — Enterprise (active, $796 paid)`);
    console.log(`   • ${freshCart.name}               — Starter (canceled, $58 refunded)`);
    console.log(`   • ${saudiHealth.name} — Enterprise Yearly (past_due, $1,992 paid)`);
    console.log(`\n📋 Subscription Plans:  4 (Starter $29, Growth $79, Enterprise $199, Enterprise Yearly $166/mo)`);
    console.log(`\n👥 Users:               ${await User.countDocuments()}`);
    console.log(`   Super Admin:         admin@primestore.com / admin123`);
    console.log(`   Owner (Natiq Team):  owner@primestore.com / owner123`);
    console.log(`   Manager (Prime):     manager@primestore.com / manager123`);
    console.log(`   Manager (TechMart):  manager@techmart-eg.com / manager123`);
    console.log(`   Manager (Gulf Bank): manager@gulfbank.com / manager123`);
    console.log(`   Team Leader:         teamlead@primestore.com / teamlead123`);
    console.log(`   Agents:              omar, fatima, khaled.agent / agent123`);
    console.log(`   Customers:           khaled, noura, mohamed / customer123`);
    console.log(`\n📚 Knowledge Base:      ${primeKnowledge.length} items (Prime Store)`);
    console.log(`🎫 Tickets:             ${totalTickets} (${closedCount} closed, ${openedCount} open, ${pendingCount} pending)`);
    console.log(`💬 Chat Sessions:       ${totalSessions} (${totalSessions - activeSessions} closed, ${activeSessions} active)`);
    console.log(`⭐ Feedback:            ${feedbackData.length} entries`);
    console.log(`📞 Calls:               ${calls.length} logs`);
    console.log(`📊 Event Logs:          ${eventLogs.length}`);
    console.log(`\n📌 Owner Dashboard:     GET /api/v1/owner/dashboard`);
    console.log(`📌 Manager Dashboard:   GET /api/v1/admin/management/dashboard`);
    console.log(`📌 Company Settings:    GET /api/v1/admin/management/settings`);
    console.log(`📌 Analytics Overview:  GET /api/v1/admin/analytics/overview`);
    console.log('==========================================\n');

    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
};

seed();
