import dotenv from 'dotenv';
dotenv.config(); // используется для загрузки переменных среды из файла .env и их добавления в объект process.env в приложении Node.js

export const config = {
  PORT: process.env.PORT || 3000,
  EMAIL_USER: process.env.EMAIL_USER || 'your.email@gmail.com',
  EMAIL_PASS: process.env.EMAIL_PASS || 'your-email-password',
  EMAIL_TO: process.env.EMAIL_TO || 'business.owner@example.com',
  EMAIL_SUBJECT: 'Новый запрос обратной связи',
};