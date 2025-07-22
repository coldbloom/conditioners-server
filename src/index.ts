import express from 'express';
import cors from 'cors';
import { config } from './config';
import { telegramSendMessage } from "./telegram-send-message";

export interface PhoneRequest {
  phone: string;
}

const app = express();

const allowedOrigins = [
  'https://holodniypartner.ru',
  'https://conditioners-plum.vercel.app'
];

// Разрешает все домены и методы
app.use(cors({
  origin: true,  // Автоматически разрешает текущий origin
  methods: ['POST'],
  credentials: true
}));

// Middleware
// app.use(cors({
//   origin: (origin, callback) => {
//     if (!origin || allowedOrigins.includes(origin)) {
//       callback(null, true);
//     } else {
//       console.log('Blocked by CORS:', origin);
//       callback(new Error('Not allowed'));
//     }
//   },
//   methods: ['POST', 'OPTIONS'],
//   allowedHeaders: ['Content-Type'],
//   credentials: true
// }));

// @FIXME временно комментирую этот вариант
// app.use(cors({
//   origin: (origin, callback) => {
//     const allowed = [
//       'https://holodniypartner.ru',
//       'https://conditioners-plum.vercel.app'
//     ];
//
//     if (!origin || allowed.includes(origin.replace(/\/$/, ''))) {
//       callback(null, true);
//     } else {
//       callback(new Error('Not allowed by CORS'));
//     }
//   },
//   methods: ['POST', 'OPTIONS'],
//   credentials: true
// }));
app.use(express.json());

// Роут для обработки номера телефона
app.post('/api/feedback', async (req: any, res: any) => {
  try {
    const { phone } = req.body as PhoneRequest;
    const origin = req.headers.origin;

    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    // Отправляем email
    // await sendPhoneEmail(phone);

    if (origin === process.env.FREEZE_MASTER) {
      await telegramSendMessage(
        phone,
        process.env.FREEZE_MASTER_TELEGRAM_TOKEN as string,
        process.env.FREEZE_MASTER_CHAT_ID as string
      );

      return res.status(200).json({
        success: true,
        message: 'Request processed successfully'
      });
    }

    await telegramSendMessage(phone, process.env.TELEGRAM_TOKEN as string, process.env.TELEGRAM_GROUP_CHAT_ID as string);

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