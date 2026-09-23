import type { AcceptedCallClick } from '../call-clicks/types';
import type {
  TelegramBotApi,
  TelegramCallbackQuery,
  TelegramChatId,
  TelegramMessage,
  TelegramReplyMarkup,
  TelegramUpdate,
} from './types';
import {
  normalizeCustomerPhone,
  parseMoscowTripDate,
  parsePatientWeight,
  parsePriceRub,
  validateAddress,
} from './validation';
import { formatUserAgent } from './user-agent';

type PatientPosition = 'lying' | 'sitting';
type ConversationStep = 'phone' | 'pickup' | 'destination' | 'tripAt' | 'weight' | 'position' | 'price' | 'confirm';

export interface TransportRequestDraft {
  callClickEventId: string;
  customerPhone: string;
  pickupAddress: string;
  destinationAddress: string;
  tripAt: string;
  patientWeightKg: number;
  patientPosition: PatientPosition;
  priceRub: number;
  createdByTelegramUserId: string;
}

interface DraftValues {
  customerPhone?: string;
  pickupAddress?: string;
  destinationAddress?: string;
  tripAt?: string;
  patientWeightKg?: number;
  patientPosition?: PatientPosition;
  priceRub?: number;
}

interface ConversationSession {
  eventId: string;
  chatId: TelegramChatId;
  chatType: string;
  userId: string;
  step: ConversationStep;
  values: DraftValues;
  promptMessageId?: number;
  updatedAt: number;
}

interface MedtaxiConversationOptions {
  notificationChatId: TelegramChatId;
  now?: () => Date;
  sessionTtlMs?: number;
  onCompleted?: (draft: TransportRequestDraft) => void | Promise<void>;
}

const START_PREFIX = 'medtax:start:';
const POSITION_PREFIX = 'medtax:position:';
const CONFIRM_CALLBACK = 'medtax:confirm';
const RESTART_CALLBACK = 'medtax:restart';
const CANCEL_CALLBACK = 'medtax:cancel';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000;
const MAX_COMPLETED_EVENTS = 5_000;
const CANCEL_HINT = 'Для отмены заполнения отправьте /cancel.';

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const formatMoscowDate = (value: string): string => new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
}).format(new Date(value));

const formatPrice = (value: number): string => new Intl.NumberFormat('ru-RU').format(value);

const forceReply = (placeholder: string): TelegramReplyMarkup => ({
  force_reply: true,
  input_field_placeholder: placeholder,
});

const getSessionKey = (chatId: TelegramChatId, userId: string): string => `${String(chatId)}:${userId}`;

const getUserLabel = (query: TelegramCallbackQuery): string => {
  const firstName = query.from.first_name?.trim();
  const username = query.from.username?.trim();
  if (firstName) return firstName;
  if (username) return `@${username}`;
  return String(query.from.id);
};

export class MedtaxiConversation {
  private readonly sessions = new Map<string, ConversationSession>();
  private readonly claims = new Map<string, string>();
  private readonly completedEvents = new Set<string>();
  private readonly now: () => Date;
  private readonly sessionTtlMs: number;

  constructor(
    private readonly bot: TelegramBotApi,
    private readonly options: MedtaxiConversationOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  }

  /** Отправляет оператору карточку клика с кнопкой запуска формы. */
  async notifyCallClick(event: AcceptedCallClick): Promise<void> {
    const source = event.utm?.source;
    const campaign = event.utm?.campaign;
    const client = event.userAgent ? formatUserAgent(event.userAgent) : undefined;
    const lines = [
      '📞 <b>Возможный звонок с сайта</b>',
      '',
      `<b>Время:</b> ${escapeHtml(formatMoscowDate(event.receivedAt))}`,
      `<b>Страница:</b> <code>${escapeHtml(event.page)}</code>`,
      `<b>Кнопка:</b> <code>${escapeHtml(event.trackingId)}</code>`,
      ...(source ? [`<b>Источник:</b> ${escapeHtml(source)}`] : []),
      ...(campaign ? [`<b>Кампания:</b> ${escapeHtml(campaign)}`] : []),
      ...(client ? [`<b>Устройство:</b> ${escapeHtml(client)}`] : []),
      `<b>Номер медтакси:</b> <code>${escapeHtml(event.phone)}</code>`,
      `<b>ID клика:</b> <code>${escapeHtml(event.eventId)}</code>`,
      '',
      'После разговора нажмите кнопку и заполните результат.',
    ];

    await this.bot.sendMessage(this.options.notificationChatId, lines.join('\n'), {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{
          text: '📝 Оформить заявку',
          callback_data: `${START_PREFIX}${event.eventId}`,
        }]],
      },
    });
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    this.cleanupExpiredSessions();

    if (update.callback_query) {
      await this.handleCallback(update.callback_query);
      return;
    }

    if (update.message?.text) await this.handleTextMessage(update.message);
  }

  private async handleCallback(query: TelegramCallbackQuery): Promise<void> {
    const message = query.message;
    const data = query.data;
    if (!message || !data) {
      await this.bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith(START_PREFIX)) {
      await this.startConversation(query, data.slice(START_PREFIX.length));
      return;
    }

    const session = this.sessions.get(getSessionKey(message.chat.id, String(query.from.id)));
    if (!session) {
      await this.bot.answerCallbackQuery(query.id, {
        text: 'Форма не найдена или устарела. Откройте её из уведомления ещё раз.',
        show_alert: true,
      });
      return;
    }

    if (data.startsWith(POSITION_PREFIX)) {
      await this.selectPosition(query, session, data.slice(POSITION_PREFIX.length));
      return;
    }

    if (data === CONFIRM_CALLBACK) {
      await this.confirmConversation(query, session);
      return;
    }

    if (data === RESTART_CALLBACK) {
      await this.restartConversation(query, session);
      return;
    }

    if (data === CANCEL_CALLBACK) {
      await this.cancelConversation(query, session);
      return;
    }

    await this.bot.answerCallbackQuery(query.id, { text: 'Неизвестное действие.' });
  }

  private async startConversation(query: TelegramCallbackQuery, eventId: string): Promise<void> {
    const message = query.message;
    if (!message || !UUID_PATTERN.test(eventId)) {
      await this.bot.answerCallbackQuery(query.id, { text: 'Некорректный ID клика.', show_alert: true });
      return;
    }

    if (this.completedEvents.has(eventId)) {
      await this.bot.answerCallbackQuery(query.id, { text: 'Эта форма уже была заполнена.', show_alert: true });
      return;
    }

    const userId = String(query.from.id);
    const key = getSessionKey(message.chat.id, userId);
    const existing = this.sessions.get(key);
    if (existing) {
      await this.bot.answerCallbackQuery(query.id, {
        text: existing.eventId === eventId
          ? 'Вы уже заполняете эту форму. Ответьте на последний вопрос бота.'
          : 'Сначала завершите или отмените текущую форму командой /cancel.',
        show_alert: true,
      });
      return;
    }

    const claimedBy = this.claims.get(eventId);
    if (claimedBy && claimedBy !== key) {
      await this.bot.answerCallbackQuery(query.id, {
        text: 'Эту заявку уже оформляет другой оператор.',
        show_alert: true,
      });
      return;
    }

    const session: ConversationSession = {
      eventId,
      chatId: message.chat.id,
      chatType: message.chat.type || 'private',
      userId,
      step: 'phone',
      values: {},
      updatedAt: this.now().getTime(),
    };
    this.sessions.set(key, session);
    this.claims.set(eventId, key);

    await this.bot.answerCallbackQuery(query.id, { text: `Форму заполняет ${getUserLabel(query)}` });
    await this.sendPrompt(session, '1/7. Введите номер телефона клиента.', '+7 978 123-45-67');
  }

  private async handleTextMessage(message: TelegramMessage): Promise<void> {
    if (!message.from || !message.text) return;
    const key = getSessionKey(message.chat.id, String(message.from.id));
    const session = this.sessions.get(key);
    const command = message.text.trim().split(/\s+/, 1)[0].split('@', 1)[0].toLowerCase();

    if (command === '/cancel') {
      if (!session) {
        await this.bot.sendMessage(message.chat.id, 'Активной формы нет.');
        return;
      }
      this.releaseSession(session);
      await this.bot.sendMessage(message.chat.id, '❌ Заполнение формы отменено.');
      return;
    }

    if (command === '/start' || command === '/help') {
      await this.bot.sendMessage(
        message.chat.id,
        session
          ? `Ответьте на последний вопрос бота или завершите текущую форму командой /cancel.`
          : 'После разговора с клиентом нажмите «Оформить заявку» под уведомлением о звонке.',
      );
      return;
    }

    if (!session) {
      return;
    }

    // Privacy Mode доставляет ForceReply как ответ. Если бот видит обычные сообщения
    // (например, он администратор), принимаем их только из активной сессии оператора.
    // Явный ответ на другое сообщение по-прежнему не относится к текущему вопросу.
    if (session.chatType !== 'private'
      && session.promptMessageId
      && message.reply_to_message
      && message.reply_to_message.message_id !== session.promptMessageId) {
      return;
    }

    session.updatedAt = this.now().getTime();
    const text = message.text;

    if (session.step === 'phone') {
      const result = normalizeCustomerPhone(text);
      if (!result.success) {
        await this.sendPrompt(session, `❌ ${result.error}\n\n1/7. Введите номер телефона клиента.`, '+7 978 123-45-67');
        return;
      }
      session.values.customerPhone = result.value;
      session.step = 'pickup';
      await this.sendPrompt(session, '2/7. Откуда забрать пациента?', 'Город, улица, дом, квартира');
      return;
    }

    if (session.step === 'pickup' || session.step === 'destination') {
      const result = validateAddress(text);
      if (!result.success) {
        const label = session.step === 'pickup' ? 'Откуда забрать пациента?' : 'Куда привезти пациента?';
        await this.sendPrompt(session, `❌ ${result.error}\n\n${label}`, 'Введите полный адрес');
        return;
      }

      if (session.step === 'pickup') {
        session.values.pickupAddress = result.value;
        session.step = 'destination';
        await this.sendPrompt(session, '3/7. Куда привезти пациента?', 'Город, улица, учреждение');
      } else {
        session.values.destinationAddress = result.value;
        session.step = 'tripAt';
        await this.sendPrompt(session, '4/7. Когда состоится поездка? Введите дату и время по Москве.', 'ДД.ММ.ГГГГ ЧЧ:ММ');
      }
      return;
    }

    if (session.step === 'tripAt') {
      const result = parseMoscowTripDate(text, this.now());
      if (!result.success) {
        await this.sendPrompt(session, `❌ ${result.error}\n\n4/7. Введите дату и время поездки по Москве.`, 'ДД.ММ.ГГГГ ЧЧ:ММ');
        return;
      }
      session.values.tripAt = result.value;
      session.step = 'weight';
      await this.sendPrompt(session, '5/7. Укажите вес пациента в килограммах.', 'Например: 85');
      return;
    }

    if (session.step === 'weight') {
      const result = parsePatientWeight(text);
      if (!result.success) {
        await this.sendPrompt(session, `❌ ${result.error}\n\n5/7. Укажите вес пациента.`, 'Например: 85');
        return;
      }
      session.values.patientWeightKg = result.value;
      session.step = 'position';
      await this.sendPositionPrompt(session);
      return;
    }

    if (session.step === 'price') {
      const result = parsePriceRub(text);
      if (!result.success) {
        await this.sendPrompt(session, `❌ ${result.error}\n\n7/7. Укажите согласованную цену.`, 'Например: 7500');
        return;
      }
      session.values.priceRub = result.value;
      session.step = 'confirm';
      await this.sendSummary(session);
      return;
    }

    if (session.step === 'position') {
      await this.sendPositionPrompt(session, 'Выберите вариант кнопкой ниже.');
    } else if (session.step === 'confirm') {
      await this.bot.sendMessage(session.chatId, 'Проверьте карточку и нажмите одну из кнопок под ней.');
    }
  }

  private async selectPosition(
    query: TelegramCallbackQuery,
    session: ConversationSession,
    value: string,
  ): Promise<void> {
    if (session.step !== 'position' || !['lying', 'sitting'].includes(value)) {
      await this.bot.answerCallbackQuery(query.id, { text: 'Сейчас этот вариант выбрать нельзя.' });
      return;
    }

    session.values.patientPosition = value as PatientPosition;
    session.step = 'price';
    session.updatedAt = this.now().getTime();
    await this.bot.answerCallbackQuery(query.id);
    await this.sendPrompt(session, '7/7. Укажите согласованную цену в рублях.', 'Например: 7500');
  }

  private async confirmConversation(query: TelegramCallbackQuery, session: ConversationSession): Promise<void> {
    if (session.step !== 'confirm' || !query.message) {
      await this.bot.answerCallbackQuery(query.id, { text: 'Форма ещё не заполнена.' });
      return;
    }

    const draft = this.buildCompletedDraft(session);
    if (!draft) {
      await this.bot.answerCallbackQuery(query.id, { text: 'В форме не хватает данных.', show_alert: true });
      return;
    }

    try {
      await this.options.onCompleted?.(draft);
    } catch (error) {
      console.error(`[telegram-form] completion failed eventId=${session.eventId}:`, error instanceof Error ? error.message : String(error));
      await this.bot.answerCallbackQuery(query.id, {
        text: 'Не удалось обработать форму. Данные сохранены в черновике, попробуйте ещё раз.',
        show_alert: true,
      });
      return;
    }

    await this.bot.editMessageText(
      session.chatId,
      query.message.message_id,
      `✅ <b>Форма заполнена</b>\n\n${this.formatSummary(draft)}\n\n<i>Сохранение в БД будет подключено следующим этапом.</i>`,
      { parse_mode: 'HTML' },
    );
    await this.bot.answerCallbackQuery(query.id, { text: 'Карточка готова' });
    this.rememberCompletedEvent(session.eventId);
    this.releaseSession(session);
  }

  private async restartConversation(query: TelegramCallbackQuery, session: ConversationSession): Promise<void> {
    if (!query.message) return;
    session.values = {};
    session.step = 'phone';
    session.updatedAt = this.now().getTime();
    await this.bot.editMessageText(
      session.chatId,
      query.message.message_id,
      '🔄 Заполняем форму заново.',
    );
    await this.bot.answerCallbackQuery(query.id);
    await this.sendPrompt(session, '1/7. Введите номер телефона клиента.', '+7 978 123-45-67');
  }

  private async cancelConversation(query: TelegramCallbackQuery, session: ConversationSession): Promise<void> {
    if (query.message) {
      await this.bot.editMessageText(session.chatId, query.message.message_id, '❌ Заполнение формы отменено.');
    }
    await this.bot.answerCallbackQuery(query.id, { text: 'Форма отменена' });
    this.releaseSession(session);
  }

  private async sendPrompt(session: ConversationSession, text: string, placeholder: string): Promise<void> {
    const message = await this.bot.sendMessage(session.chatId, `${text}\n\n${CANCEL_HINT}`, {
      reply_markup: forceReply(placeholder),
    });
    session.promptMessageId = message.message_id;
    session.updatedAt = this.now().getTime();
  }

  private async sendPositionPrompt(session: ConversationSession, prefix?: string): Promise<void> {
    const message = await this.bot.sendMessage(
      session.chatId,
      `${prefix ? `${prefix}\n\n` : ''}6/7. Пациент лежачий или сидячий?`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🛏 Лежачий', callback_data: `${POSITION_PREFIX}lying` },
              { text: '🪑 Сидячий', callback_data: `${POSITION_PREFIX}sitting` },
            ],
            [{ text: '❌ Отменить заявку', callback_data: CANCEL_CALLBACK }],
          ],
        },
      },
    );
    session.promptMessageId = message.message_id;
    session.updatedAt = this.now().getTime();
  }

  private async sendSummary(session: ConversationSession): Promise<void> {
    const draft = this.buildCompletedDraft(session);
    if (!draft) throw new Error('Cannot render an incomplete transport request draft');

    const message = await this.bot.sendMessage(
      session.chatId,
      `🚑 <b>Проверьте заявку</b>\n\n${this.formatSummary(draft)}`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Подтвердить', callback_data: CONFIRM_CALLBACK }],
            [
              { text: '🔄 Заполнить заново', callback_data: RESTART_CALLBACK },
              { text: '❌ Отменить', callback_data: CANCEL_CALLBACK },
            ],
          ],
        },
      },
    );
    session.promptMessageId = message.message_id;
    session.updatedAt = this.now().getTime();
  }

  private buildCompletedDraft(session: ConversationSession): TransportRequestDraft | undefined {
    const values = session.values;
    if (!values.customerPhone
      || !values.pickupAddress
      || !values.destinationAddress
      || !values.tripAt
      || values.patientWeightKg === undefined
      || !values.patientPosition
      || values.priceRub === undefined) {
      return undefined;
    }

    return {
      callClickEventId: session.eventId,
      customerPhone: values.customerPhone,
      pickupAddress: values.pickupAddress,
      destinationAddress: values.destinationAddress,
      tripAt: values.tripAt,
      patientWeightKg: values.patientWeightKg,
      patientPosition: values.patientPosition,
      priceRub: values.priceRub,
      createdByTelegramUserId: session.userId,
    };
  }

  private formatSummary(draft: TransportRequestDraft): string {
    const position = draft.patientPosition === 'lying' ? 'лежачий' : 'сидячий';
    return [
      `<b>Телефон клиента:</b> <code>${escapeHtml(draft.customerPhone)}</code>`,
      `<b>Откуда:</b> ${escapeHtml(draft.pickupAddress)}`,
      `<b>Куда:</b> ${escapeHtml(draft.destinationAddress)}`,
      `<b>Поездка:</b> ${escapeHtml(formatMoscowDate(draft.tripAt))}`,
      `<b>Вес:</b> ${draft.patientWeightKg} кг`,
      `<b>Положение:</b> ${position}`,
      `<b>Цена:</b> ${escapeHtml(formatPrice(draft.priceRub))} ₽`,
      `<b>ID клика:</b> <code>${escapeHtml(draft.callClickEventId)}</code>`,
    ].join('\n');
  }

  private releaseSession(session: ConversationSession): void {
    const key = getSessionKey(session.chatId, session.userId);
    this.sessions.delete(key);
    if (this.claims.get(session.eventId) === key) this.claims.delete(session.eventId);
  }

  private cleanupExpiredSessions(): void {
    const expiresBefore = this.now().getTime() - this.sessionTtlMs;
    for (const session of this.sessions.values()) {
      if (session.updatedAt < expiresBefore) this.releaseSession(session);
    }
  }

  private rememberCompletedEvent(eventId: string): void {
    this.completedEvents.add(eventId);
    if (this.completedEvents.size <= MAX_COMPLETED_EVENTS) return;
    const oldest = this.completedEvents.values().next().value as string | undefined;
    if (oldest) this.completedEvents.delete(oldest);
  }
}
