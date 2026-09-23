import { timingSafeEqual } from 'node:crypto';
import { json, Router, type ErrorRequestHandler } from 'express';
import type { TelegramUpdate } from './types';

interface TelegramWebhookRouterOptions {
  secret?: string;
  allowedChatId?: string;
  allowedOperatorIds?: ReadonlySet<string>;
  onUpdate?: (update: TelegramUpdate) => void | Promise<void>;
}

const MAX_PROCESSED_UPDATES = 2_000;

const secretsMatch = (expected: string, actual: string): boolean => {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
};

const normalizeChatUsername = (value?: string): string | undefined => {
  const username = value?.trim().replace(/^@/, '').toLowerCase();
  return username || undefined;
};

const extractActor = (update: TelegramUpdate): { chatId?: string; chatUsername?: string; userId?: string } => {
  const message = update.callback_query?.message ?? update.message;
  const user = update.callback_query?.from ?? update.message?.from;
  return {
    chatId: message ? String(message.chat.id) : undefined,
    chatUsername: normalizeChatUsername(message?.chat.username),
    userId: user ? String(user.id) : undefined,
  };
};

const isAllowedChat = (
  allowedChatId: string,
  chatId?: string,
  chatUsername?: string,
): boolean => {
  if (chatId === allowedChatId) return true;

  const allowedUsername = allowedChatId.trim().startsWith('@')
    ? normalizeChatUsername(allowedChatId)
    : undefined;
  return allowedUsername !== undefined && allowedUsername === chatUsername;
};

export const parseOperatorIds = (value?: string): ReadonlySet<string> => new Set(
  (value ?? '').split(',').map((item) => item.trim()).filter(Boolean),
);

/** Telegram-only endpoint: no browser CORS, mandatory secret and chat/operator allowlist. */
export function createTelegramWebhookRouter(options: TelegramWebhookRouterOptions): Router {
  const router = Router();
  const processedUpdates = new Set<number>();

  router.post('/', json({ limit: '64kb', inflate: false }), async (req, res) => {
    if (!options.secret || !options.allowedChatId || !options.onUpdate) {
      res.status(503).set('Cache-Control', 'no-store').json({ error: 'Telegram webhook is not configured' });
      return;
    }

    const suppliedSecret = req.get('x-telegram-bot-api-secret-token') ?? '';
    if (!secretsMatch(options.secret, suppliedSecret)) {
      res.status(401).set('Cache-Control', 'no-store').json({ error: 'Unauthorized' });
      return;
    }

    const update = req.body as Partial<TelegramUpdate>;
    if (!Number.isSafeInteger(update.update_id)) {
      res.status(400).set('Cache-Control', 'no-store').json({ error: 'Invalid Telegram update' });
      return;
    }

    if (processedUpdates.has(update.update_id as number)) {
      res.status(200).set('Cache-Control', 'no-store').json({ ok: true });
      return;
    }

    const { chatId, chatUsername, userId } = extractActor(update as TelegramUpdate);
    const chatAllowed = isAllowedChat(options.allowedChatId, chatId, chatUsername);
    const operators = options.allowedOperatorIds ?? new Set<string>();
    const operatorAllowed = operators.size === 0 || (userId !== undefined && operators.has(userId));
    if (!chatAllowed || !operatorAllowed) {
      console.warn('[telegram-webhook] ignored unauthorized update', {
        updateId: update.update_id,
        chatId,
        userId,
      });
      res.status(200).set('Cache-Control', 'no-store').json({ ok: true });
      return;
    }

    processedUpdates.add(update.update_id as number);
    if (processedUpdates.size > MAX_PROCESSED_UPDATES) {
      const oldest = processedUpdates.values().next().value as number | undefined;
      if (oldest !== undefined) processedUpdates.delete(oldest);
    }

    try {
      await options.onUpdate(update as TelegramUpdate);
    } catch (error) {
      // Не просим Telegram бесконечно повторять update: черновик живёт только в памяти.
      console.error('[telegram-webhook] update failed:', error instanceof Error ? error.message : String(error));
    }

    res.status(200).set('Cache-Control', 'no-store').json({ ok: true });
  });

  router.all('/', (_req, res) => {
    res.status(405).set('Allow', 'POST').json({ error: 'Method not allowed' });
  });

  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    const status = error.status === 413 ? 413 : 400;
    res.status(status).set('Cache-Control', 'no-store').json({
      error: status === 413 ? 'Payload too large' : 'Invalid request body',
    });
  };
  router.use(handleError);

  return router;
}
