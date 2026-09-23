export type TelegramChatId = string | number;

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface TelegramReplyMarkup {
  inline_keyboard?: TelegramInlineKeyboardButton[][];
  force_reply?: boolean;
  selective?: boolean;
  input_field_placeholder?: string;
}

export interface TelegramMessageOptions {
  parse_mode?: 'HTML';
  reply_markup?: TelegramReplyMarkup;
}

export interface TelegramMessage {
  message_id: number;
  text?: string;
  chat: {
    id: TelegramChatId;
    type?: string;
    username?: string;
  };
  from?: {
    id: number;
    first_name?: string;
    username?: string;
  };
  reply_to_message?: {
    message_id: number;
  };
}

export interface TelegramCallbackQuery {
  id: string;
  from: {
    id: number;
    first_name?: string;
    username?: string;
  };
  data?: string;
  message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramBotApi {
  sendMessage(
    chatId: TelegramChatId,
    text: string,
    options?: TelegramMessageOptions,
  ): Promise<TelegramMessage>;
  editMessageText(
    chatId: TelegramChatId,
    messageId: number,
    text: string,
    options?: TelegramMessageOptions,
  ): Promise<TelegramMessage>;
  answerCallbackQuery(
    callbackQueryId: string,
    options?: { text?: string; show_alert?: boolean },
  ): Promise<void>;
}
