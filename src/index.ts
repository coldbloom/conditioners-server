import express from 'express';
import cors from 'cors';
import { config } from './config';
import { telegramSendMessage } from "./telegram-send-message";

export interface Request {
  phone: string;
  name?: string
  message?: string;
}

const app = express();

const allowedOrigins = [
  process.env.FREEZE_MASTER,
  process.env.CLIENT_URL,
  process.env.MEDTAXI_URL,
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

    if (origin === process.env.FREEZE_MASTER) {
      console.log('[feedback] routing → FREEZE_MASTER');
      await telegramSendMessage({
        formData: { phone },
        telegramToken: process.env.FREEZE_MASTER_TELEGRAM_TOKEN as string,
        telegramChatId: process.env.FREEZE_MASTER_CHAT_ID as string,
      });
    } else if (origin === process.env.CLIENT_URL) {
      console.log('[feedback] routing → CLIENT_URL');
      await telegramSendMessage({
        formData: { phone },
        telegramToken: process.env.TELEGRAM_TOKEN as string,
        telegramChatId: process.env.TELEGRAM_GROUP_CHAT_ID as string,
      });
    } else if (origin === process.env.MEDTAXI_URL) {
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
    'CLIENT_URL',
    'MEDTAXI_URL',
    'FREEZE_MASTER_TELEGRAM_TOKEN',
    'FREEZE_MASTER_CHAT_ID',
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
