import cors from 'cors';
import { Router, json, type ErrorRequestHandler } from 'express';
import { createCallClickRateLimiter } from './rate-limit';
import type { AcceptedCallClick } from './types';
import { validateCallClickPayload } from './validation';

export interface CallClicksRouterOptions {
  /** Вызывается уже после ответа 202 и не влияет на открытие tel:-ссылки. */
  onAccepted?: (event: AcceptedCallClick) => void | Promise<void>;
}

/**
 * Проверяем запрос → пишем одну JSON-строку в лог → отвечаем 202 → уведомляем подписчика.
 * Ошибка подписчика не меняет уже отправленный браузеру ответ.
 */
export function createCallClicksRouter(options: CallClicksRouterOptions = {}): Router {
  const router = Router();
  const allowedOrigins = [
    process.env.MEDTAXI_URL,
    ...(process.env.CALL_CLICK_ALLOWED_ORIGINS ?? '').split(','),
    // В production localhost разрешается только явным CALL_CLICK_ALLOWED_ORIGINS.
    ...(process.env.NODE_ENV === 'production'
      ? []
      : [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:3077',
        'http://127.0.0.1:3077',
      ]),
  ].filter((origin): origin is string => Boolean(origin?.trim()))
    .map((origin) => origin.trim().replace(/\/$/, ''));

  // CORS проверяем до обработки события. curl без Origin разрешён для диагностики.
  // Это ограничение браузерных источников, а не авторизация: Origin можно подделать.
  router.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && !allowedOrigins.includes(origin)) {
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }
    next();
  });
  router.use(cors({
    origin: allowedOrigins,
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  }));

  router.post('/',
    // Ограничение действует только на клики, не на callback-формы.
    createCallClickRateLimiter(120),
    // Тело в обоих случаях — JSON. text/plain позволяет браузеру обойти preflight.
    json({ type: ['application/json', 'text/plain'], limit: '16kb', inflate: false }),
    (req, res) => {
      try {
        const validation = validateCallClickPayload(req.body);
        if (!validation.success) {
          res.status(400).json({ error: 'Invalid request', details: validation.errors });
          return;
        }

        // Данные браузера недоверенные; время приёма и User-Agent получаем на сервере.
        // Не пишем IP. JSON.stringify экранирует переносы строк внутри значений.
        const event: AcceptedCallClick = {
          ...validation.data,
          receivedAt: new Date().toISOString(),
          userAgent: req.get('user-agent')?.slice(0, 1024),
        };
        console.log('[call-click]', JSON.stringify(event));

        res.status(202).set('Cache-Control', 'no-store').json({
          accepted: true,
          eventId: validation.data.eventId,
        });

        if (options.onAccepted) {
          // Отделяем Telegram от критического пути: ответ 202 уже сформирован.
          queueMicrotask(() => {
            Promise.resolve(options.onAccepted?.(event)).catch((error: unknown) => {
              const detail = error instanceof Error ? error.message : String(error);
              console.error(`[call-click] Telegram notification failed eventId=${event.eventId}:`, detail);
            });
          });
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error('[call-click] unhandled error:', detail);
        res.status(500).json({ error: 'Internal server error', detail });
      }
    },
  );

  router.all('/', (_req, res) => {
    res.status(405).set('Allow', 'POST, OPTIONS').json({ error: 'Method not allowed' });
  });

  // Ошибки parser остаются внутри нового endpoint и не меняют старую обработку API.
  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    const status = [400, 413, 415].includes(error.status) ? error.status : 500;
    if (status === 500) console.error('[call-click] failed:', error);
    res.status(status).json({ error: status === 413 ? 'Payload too large' : 'Invalid request body' });
  };
  router.use(handleError);

  return router;
}
