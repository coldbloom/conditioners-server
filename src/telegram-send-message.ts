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

export const telegramSendMessage = async (
  phone: string,
  telegramToken: string,
  telegramChatId: string
) => {
  try {
    const text = `📞 <b>Новый запрос</b>\nТелефон: <code>${phone}</code>\nДата: ${new Date().toLocaleString('ru-RU')}`;
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
    console.error('Telegram sendMessage error:', error instanceof Error ? error.message : error);
    throw error; // Пробрасываем ошибку дальше для обработки в роутере
  }
};