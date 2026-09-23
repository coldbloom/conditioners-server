import type { RequestHandler } from 'express';

/** Счётчик запросов одного сетевого адреса в текущем минутном окне. */
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;
const MAX_TRACKED_CLIENTS = 10_000;

/**
 * Простая защита одного процесса: счётчики живут только в памяти и не пишутся в лог.
 * Не доверяем X-Forwarded-For и не меняем trust proxy работающего API.
 * За reverse proxy все посетители могут делить один лимит (120 запросов/минуту).
 */
export const createCallClickRateLimiter = (limitPerMinute: number): RequestHandler => {
  const clients = new Map<string, RateLimitEntry>();

  return (req, res, next) => {
    const now = Date.now();
    let key = req.ip || req.socket.remoteAddress || 'unknown';

    // Ограничиваем память; удаляем истёкшие записи без фонового таймера.
    if (!clients.has(key) && clients.size >= MAX_TRACKED_CLIENTS) {
      for (const [clientKey, entry] of clients) {
        if (entry.resetAt <= now) clients.delete(clientKey);
      }

      if (clients.size >= MAX_TRACKED_CLIENTS) key = 'overflow';
    }

    const current = clients.get(key);
    const entry = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + WINDOW_MS }
      : current;

    entry.count += 1;
    clients.set(key, entry);

    res.setHeader('X-RateLimit-Limit', String(limitPerMinute));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limitPerMinute - entry.count)));

    if (entry.count > limitPerMinute) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    next();
  };
};
