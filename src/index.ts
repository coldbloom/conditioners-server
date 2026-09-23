import express from 'express';
import cors from 'cors';
import { config } from './config';
import { telegramSendMessage } from "./telegram-send-message";
import { createCallClicksRouter } from './call-clicks/router';
import { TelegramClient } from './telegram/client';
import { MedtaxiConversation } from './telegram/conversation';
import { createTelegramWebhookRouter, parseOperatorIds } from './telegram/webhook-router';

export interface Request {
  phone: string;
  name?: string
  message?: string;
}

const app = express();

const medtaxiTelegramToken = process.env.FREEZE_MASTER_TELEGRAM_TOKEN;
const medtaxiTelegramChatId = process.env.FREEZE_MASTER_CHAT_ID;
const medtaxiBot = medtaxiTelegramToken && medtaxiTelegramChatId
  ? new MedtaxiConversation(new TelegramClient(medtaxiTelegramToken), {
    notificationChatId: medtaxiTelegramChatId,
  })
  : undefined;

// У кликов и Telegram webhook собственные parser/ограничения.
// Старый /api/feedback ниже продолжает работать через общие middleware.
app.use('/api/call-clicks', createCallClicksRouter({
  onAccepted: medtaxiBot ? (event) => medtaxiBot.notifyCallClick(event) : undefined,
}));
app.use('/api/telegram/webhook', createTelegramWebhookRouter({
  secret: process.env.TELEGRAM_WEBHOOK_SECRET,
  allowedChatId: medtaxiTelegramChatId,
  allowedOperatorIds: parseOperatorIds(process.env.TELEGRAM_OPERATOR_IDS),
  onUpdate: medtaxiBot ? (update) => medtaxiBot.handleUpdate(update) : undefined,
}));

const allowedOrigins = [
  process.env.FREEZE_MASTER,
  process.env.PARTNER_URL,
  process.env.MEDTAXI_URL,
  'http://localhost:3077',
].filter((origin): origin is string => Boolean(origin));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ''))) {
      callback(null, true);
      return;
    }

    callback(new Error('Not allowed by CORS'));
  },
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true,
}));
app.use(express.json());

app.post('/api/feedback', async (req: any, res: any) => {
  const origin = req.headers.origin;

  console.log(`[feedback] origin=${origin} body=${JSON.stringify(req.body)}`);

  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    if (origin === process.env.FREEZE_MASTER) { // split161
      console.log('[feedback] routing → FREEZE_MASTER');
      await telegramSendMessage({
        formData: { phone },
        telegramToken: process.env.FREEZE_MASTER_TELEGRAM_TOKEN as string,
        telegramChatId: process.env.FREEZE_MASTER_CHAT_ID as string,
      });
    } else if (origin === process.env.PARTNER_URL) { // ледяной партнер
      console.log('[feedback] routing → Ледяной партнер');
      await telegramSendMessage({
        formData: { phone },
        telegramToken: process.env.PARTNER_TELEGRAM_TOKEN as string,
        telegramChatId: process.env.PARTNER_TELEGRAM_GROUP_CHAT_ID as string,
      });
    } else if (origin === process.env.MEDTAXI_URL || origin === 'http://localhost:3077') { // https://medtaxi-evp.ru
      console.log('[feedback] routing → MEDTAXI_URL');
      const { name, message } = req.body;

      if (!name) {
        return res.status(400).json({ error: 'Name is required' });
      }

      await telegramSendMessage({
        formData: { phone, name, message },
        telegramToken: process.env.FREEZE_MASTER_TELEGRAM_TOKEN as string,
        telegramChatId: process.env.FREEZE_MASTER_CHAT_ID as string,
        serviceFrom: process.env.MEDTAXI_URL,
      });
    } else {
      console.warn(`[feedback] unknown origin: ${origin}`);
      return res.status(403).json({
        error: 'Forbidden',
        detail: `Origin not recognized: ${origin}`,
      });
    }

    return res.status(200).json({ success: true, message: 'Request processed successfully' });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[feedback] unhandled error:', detail);
    return res.status(500).json({ error: 'Internal server error', detail });
  }
});

app.listen(config.PORT, () => {
  console.log(`Server is running on http://localhost:${config.PORT}`);

  const requiredEnvVars = [
    'FREEZE_MASTER',
    'PARTNER_URL',
    'MEDTAXI_URL',
    'FREEZE_MASTER_TELEGRAM_TOKEN',
    'FREEZE_MASTER_CHAT_ID',
    'TELEGRAM_WEBHOOK_SECRET',
    'TELEGRAM_TOKEN',
    'TELEGRAM_GROUP_CHAT_ID',
  ];

  const missing = requiredEnvVars.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.warn('[env] Missing variables:', missing.join(', '));
  } else {
    console.log('[env] All required variables are set');
  }

  console.log('[env] Allowed origins:', allowedOrigins);
});
