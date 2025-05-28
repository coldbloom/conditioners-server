import express from 'express';
import cors from 'cors';
import { config } from './config';
import { telegramSendMessage } from "./telegram-send-message";

export interface PhoneRequest {
  phone: string;
}

const app = express();

// Middleware
app.use(cors(
  {
    origin: `${process.env.CLIENT_URL}` || 'https://holodniypartner.ru ', // Разрешаем запросы только с этого домена
    methods: ['POST'], // Разрешаем только POST-запросы
    credentials: true,
  }
));
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