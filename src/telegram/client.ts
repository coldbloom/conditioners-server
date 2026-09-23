import axios from 'axios';
import type {
  TelegramBotApi,
  TelegramChatId,
  TelegramMessage,
  TelegramMessageOptions,
} from './types';

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

/** Минимальный Bot API-клиент без логирования token и полного axios config. */
export class TelegramClient implements TelegramBotApi {
  constructor(private readonly token: string) {}

  async sendMessage(
    chatId: TelegramChatId,
    text: string,
    options: TelegramMessageOptions = {},
  ): Promise<TelegramMessage> {
    return this.call<TelegramMessage>('sendMessage', {
      chat_id: chatId,
      text,
      ...options,
    });
  }

  async editMessageText(
    chatId: TelegramChatId,
    messageId: number,
    text: string,
    options: TelegramMessageOptions = {},
  ): Promise<TelegramMessage> {
    return this.call<TelegramMessage>('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      ...options,
    });
  }

  async answerCallbackQuery(
    callbackQueryId: string,
    options: { text?: string; show_alert?: boolean } = {},
  ): Promise<void> {
    await this.call<true>('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      cache_time: 0,
      ...options,
    });
  }

  private async call<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    try {
      const response = await axios.post<TelegramApiResponse<T>>(
        `https://api.telegram.org/bot${this.token}/${method}`,
        payload,
        { timeout: 10_000 },
      );

      if (!response.data.ok || response.data.result === undefined) {
        throw new Error(response.data.description || 'unknown Telegram API error');
      }

      return response.data.result;
    } catch (error) {
      if (axios.isAxiosError<TelegramApiResponse<unknown>>(error)) {
        const status = error.response?.status;
        const description = error.response?.data?.description || error.message;
        throw new Error(`Telegram ${method} failed${status ? ` (${status})` : ''}: ${description}`);
      }

      throw error;
    }
  }
}
