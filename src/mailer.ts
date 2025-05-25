import nodemailer from 'nodemailer';
import { config } from './config';

const transporter = nodemailer.createTransport({
  secure: true, // only for port 465
  host: 'smtp.mail.ru',
  port: 465,
  auth: {
    user: config.EMAIL_USER,
    pass: config.EMAIL_PASS,
  },
});

export const sendPhoneEmail = async (phone: string) => {
  const formattedDate = new Date().toLocaleString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).replace(/(\d+).(\d+).(\d+),?/, '$3-$2-$1');

  const mailOptions = {
    from: config.EMAIL_USER,
    to: config.EMAIL_TO,
    subject: config.EMAIL_SUBJECT,
    text: `Новый запрос обратной связи. Телефон: ${phone}. \nДата и время: ${formattedDate}`,
  };

  await transporter.sendMail(mailOptions);
};