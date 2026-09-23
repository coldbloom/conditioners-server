import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AcceptedCallClick } from '../call-clicks/types';
import { MedtaxiConversation, type TransportRequestDraft } from './conversation';
import type {
  TelegramBotApi,
  TelegramChatId,
  TelegramMessage,
  TelegramMessageOptions,
  TelegramUpdate,
} from './types';

interface SentRecord {
  chatId: TelegramChatId;
  text: string;
  options?: TelegramMessageOptions;
  message: TelegramMessage;
}

class FakeTelegramBot implements TelegramBotApi {
  sent: SentRecord[] = [];
  edits: Array<{ chatId: TelegramChatId; messageId: number; text: string; options?: TelegramMessageOptions }> = [];
  answers: Array<{ id: string; options?: { text?: string; show_alert?: boolean } }> = [];
  private nextMessageId = 100;

  async sendMessage(chatId: TelegramChatId, text: string, options?: TelegramMessageOptions): Promise<TelegramMessage> {
    const message: TelegramMessage = {
      message_id: this.nextMessageId++,
      text,
      chat: { id: chatId, type: 'private' },
    };
    this.sent.push({ chatId, text, options, message });
    return message;
  }

  async editMessageText(
    chatId: TelegramChatId,
    messageId: number,
    text: string,
    options?: TelegramMessageOptions,
  ): Promise<TelegramMessage> {
    this.edits.push({ chatId, messageId, text, options });
    return { message_id: messageId, text, chat: { id: chatId, type: 'private' } };
  }

  async answerCallbackQuery(
    id: string,
    options?: { text?: string; show_alert?: boolean },
  ): Promise<void> {
    this.answers.push({ id, options });
  }
}

const chatId = '-100123456';
const userId = 112233;
const eventId = '8039e6de-b47c-4c6e-8507-b128e1739e6c';
const nextEventId = '4dcc9d0e-c67f-4225-a8d8-0115566fd8b1';
const now = new Date('2026-09-22T09:00:00.000Z');

const click: AcceptedCallClick = {
  eventId,
  trackingId: 'hero',
  phone: '+79895052785',
  page: '/donetsk',
  utm: { source: 'yandex', campaign: 'donetsk' },
  receivedAt: now.toISOString(),
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) '
    + 'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
};

const callbackUpdate = (
  updateId: number,
  callbackId: string,
  data: string,
  message: TelegramMessage,
): TelegramUpdate => ({
  update_id: updateId,
  callback_query: {
    id: callbackId,
    data,
    from: { id: userId, first_name: 'Оператор' },
    message,
  },
});

const textUpdate = (
  updateId: number,
  text: string,
  replyTo?: number,
  chatType = 'private',
): TelegramUpdate => ({
  update_id: updateId,
  message: {
    message_id: 1_000 + updateId,
    text,
    chat: { id: chatId, type: chatType },
    from: { id: userId },
    ...(replyTo ? { reply_to_message: { message_id: replyTo } } : {}),
  },
});

test('sends call-click notification with form button', async () => {
  const bot = new FakeTelegramBot();
  const conversation = new MedtaxiConversation(bot, { notificationChatId: chatId, now: () => now });

  await conversation.notifyCallClick(click);

  assert.equal(bot.sent.length, 1);
  assert.match(bot.sent[0].text, /Возможный звонок с сайта/);
  assert.match(bot.sent[0].text, /yandex/);
  assert.match(bot.sent[0].text, /iPhone · iOS 18\.5 · Safari 18\.5 · mobile/);
  assert.equal(
    bot.sent[0].options?.reply_markup?.inline_keyboard?.[0][0].callback_data,
    `medtax:start:${eventId}`,
  );
});

test('group prompts force a reply without an untargeted selective flag', async () => {
  const bot = new FakeTelegramBot();
  const conversation = new MedtaxiConversation(bot, { notificationChatId: chatId, now: () => now });

  await conversation.notifyCallClick(click);
  const notification = bot.sent[0].message;
  notification.chat.type = 'supergroup';
  await conversation.handleUpdate(callbackUpdate(1, 'start', `medtax:start:${eventId}`, notification));

  const phonePrompt = bot.sent.at(-1);
  assert.ok(phonePrompt);
  assert.deepEqual(phonePrompt.options?.reply_markup, {
    force_reply: true,
    input_field_placeholder: '+7 978 123-45-67',
  });
  assert.match(phonePrompt.text, /\/cancel/);

  await conversation.handleUpdate(textUpdate(
    2,
    '8 (978) 123-45-67',
    undefined,
    'supergroup',
  ));
  assert.match(bot.sent.at(-1)?.text ?? '', /Откуда забрать пациента/);
});

test('/cancel releases the active form so the operator can start a new one', async () => {
  const bot = new FakeTelegramBot();
  const conversation = new MedtaxiConversation(bot, { notificationChatId: chatId, now: () => now });

  await conversation.notifyCallClick(click);
  await conversation.handleUpdate(callbackUpdate(
    1,
    'start-first',
    `medtax:start:${eventId}`,
    bot.sent[0].message,
  ));
  await conversation.handleUpdate(textUpdate(2, '/cancel'));
  assert.match(bot.sent.at(-1)?.text ?? '', /Заполнение формы отменено/);

  await conversation.notifyCallClick({ ...click, eventId: nextEventId });
  const nextNotification = bot.sent.at(-1)?.message;
  assert.ok(nextNotification);
  await conversation.handleUpdate(callbackUpdate(
    3,
    'start-next',
    `medtax:start:${nextEventId}`,
    nextNotification,
  ));

  assert.match(bot.answers.at(-1)?.options?.text ?? '', /Форму заполняет/);
  assert.match(bot.sent.at(-1)?.text ?? '', /1\/7\. Введите номер телефона клиента/);
});

test('walks through the form, validates input and renders a confirmed card', async () => {
  const bot = new FakeTelegramBot();
  let completed: TransportRequestDraft | undefined;
  const conversation = new MedtaxiConversation(bot, {
    notificationChatId: chatId,
    now: () => now,
    onCompleted: (draft) => {
      completed = draft;
    },
  });

  await conversation.notifyCallClick(click);
  const notification = bot.sent[0].message;
  await conversation.handleUpdate(callbackUpdate(1, 'start', `medtax:start:${eventId}`, notification));
  assert.match(bot.sent.at(-1)?.text ?? '', /номер телефона клиента/);

  await conversation.handleUpdate(textUpdate(2, 'wrong'));
  assert.match(bot.sent.at(-1)?.text ?? '', /Ожидается|Введите номер/);

  await conversation.handleUpdate(textUpdate(3, '8 (978) 123-45-67'));
  await conversation.handleUpdate(textUpdate(4, 'Евпатория, ул. Победы, 1 <подъезд>'));
  await conversation.handleUpdate(textUpdate(5, 'Симферополь & больница'));
  await conversation.handleUpdate(textUpdate(6, '23.09.2026 09:30'));
  await conversation.handleUpdate(textUpdate(7, '85 кг'));

  const positionMessage = bot.sent.at(-1)?.message;
  assert.ok(positionMessage);
  await conversation.handleUpdate(callbackUpdate(8, 'position', 'medtax:position:lying', positionMessage));
  await conversation.handleUpdate(textUpdate(9, '7 500 ₽'));

  const summary = bot.sent.at(-1);
  assert.ok(summary);
  assert.match(summary.text, /Проверьте заявку/);
  assert.match(summary.text, /Евпатория, ул. Победы, 1 &lt;подъезд&gt;/);
  assert.match(summary.text, /Симферополь &amp; больница/);
  assert.match(summary.text, /23\.09\.2026/);
  assert.match(summary.text, /7.?500 ₽/);

  await conversation.handleUpdate(callbackUpdate(10, 'confirm', 'medtax:confirm', summary.message));
  assert.deepEqual(completed, {
    callClickEventId: eventId,
    customerPhone: '+79781234567',
    pickupAddress: 'Евпатория, ул. Победы, 1 <подъезд>',
    destinationAddress: 'Симферополь & больница',
    tripAt: '2026-09-23T06:30:00.000Z',
    patientWeightKg: 85,
    patientPosition: 'lying',
    priceRub: 7500,
    createdByTelegramUserId: String(userId),
  });
  assert.match(bot.edits.at(-1)?.text ?? '', /Форма заполнена/);
  assert.match(bot.edits.at(-1)?.text ?? '', /Сохранение в БД/);
});
