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

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log('Blocked by CORS:', origin);
      callback(new Error('Not allowed'));
    }
  },
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));

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
    console.log(phone);

    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    // Отправляем email
    // await sendPhoneEmail(phone);
    console.log('test phone = ', phone);

    await telegramSendMessage(phone);

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