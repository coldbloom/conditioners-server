import axios from "axios";
import dotenv from 'dotenv';
dotenv.config(); // используется для загрузки переменных среды из файла .env и их добавления в объект process.env в приложении Node.js


// Добавляем типы для ответа и ошибок Telegram API
interface TelegramResponse {
  data: {
    ok: boolean;
    result?: any;
    description?: string;
  };
}

interface TelegramSendMessageProps {
  formData: FormData;
  telegramToken: string,
  telegramChatId: string
  serviceFrom?: string,
}

interface FormData {
  phone: string;
  name?: string;
  message?: string;
}

interface BuildMessageTextProps extends FormData {
  serviceFrom?: string
}

const buildMessageText = ({ phone, name, message, serviceFrom }: BuildMessageTextProps): string => {
  const lines = [
    '📞 <b>Новый запрос</b>',
    `Телефон: <code>${phone}</code>`,
  ];

  if (serviceFrom) {
    lines.push(`Для сервиса: ${serviceFrom}`);
  }

  if (name) {
    lines.push(`Имя: ${name}`);
  }

  if (message) {
    lines.push(`Сообщение: ${message}`);
  }

  lines.push(`Дата: ${new Date().toLocaleString('ru-RU')}`);

  return lines.join('\n');
};

export const telegramSendMessage = async ({
  formData,
  telegramToken,
  telegramChatId,
  serviceFrom,
}: TelegramSendMessageProps) => {
  try {
    const text = buildMessageText({ ...formData, serviceFrom });
    const response: TelegramResponse = await axios.post(
      `https://api.telegram.org/bot${telegramToken}/sendMessage`,
      {
        chat_id: telegramChatId,
        text: text,
        parse_mode: 'HTML'
      }
    )

    if (!response.data.ok) {
      throw new Error(`Telegram API error: ${response.data.description}`);
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('Telegram sendMessage error:', {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
      });
    } else {
      console.error('Telegram sendMessage error:', error instanceof Error ? error.message : error);
    }
    throw error;
  }
};