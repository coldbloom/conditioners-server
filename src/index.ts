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

// Роут для обработки номера телефона
app.post('/api/feedback', async (req: any, res: any) => {
  try {
    const { phone } = req.body;
    const origin = req.headers.origin;

    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    // Отправляем email
    // await sendPhoneEmail(phone);

    if (origin === process.env.FREEZE_MASTER) {
      await telegramSendMessage({
        formData: { phone },
        telegramToken: process.env.FREEZE_MASTER_TELEGRAM_TOKEN as string,
        telegramChatId: process.env.FREEZE_MASTER_CHAT_ID as string,
      });
    } else if (origin === process.env.CLIENT_URL) {
      await telegramSendMessage({
        formData: { phone },
        telegramToken: process.env.TELEGRAM_TOKEN as string,
        telegramChatId: process.env.TELEGRAM_GROUP_CHAT_ID as string,
      });
    } else if (origin === process.env.MEDTAXI_URL) {
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
    }

    return res.status(200).json({
      success: true,
      message: 'Request processed successfully'
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Запуск сервера
app.listen(config.PORT, () => {
  console.log(`Server is running on http://localhost:${config.PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});