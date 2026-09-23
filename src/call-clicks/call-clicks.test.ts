import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, mock, test } from 'node:test';
import express from 'express';
import { createCallClicksRouter } from './router';
import type { AcceptedCallClick } from './types';

const allowedOrigin = 'https://medtaxi.test';
const payload = {
  eventId: '8039e6de-b47c-4c6e-8507-b128e1739e6c',
  trackingId: 'hero',
  phone: '+79895052785',
  page: '/donetsk',
  referrer: 'https://yandex.ru/',
  utm: { source: 'yandex', campaign: 'donetsk' },
  yclid: '1234567890',
  sessionId: '8ff232a0-66fc-4ee0-bcad-64c2b8614452',
  clientTimestamp: '2026-09-20T12:33:59.000Z',
};

let server: Server;
let endpoint: string;
const logs: Array<Record<string, unknown>> = [];
const notifications: AcceptedCallClick[] = [];

before(async () => {
  // Создаём только новый router: тесты никогда не обращаются к настоящему Telegram.
  const previousOrigin = process.env.MEDTAXI_URL;
  process.env.MEDTAXI_URL = allowedOrigin;
  const router = createCallClicksRouter({
    onAccepted: (event) => {
      notifications.push(event);
    },
  });
  if (previousOrigin === undefined) delete process.env.MEDTAXI_URL;
  else process.env.MEDTAXI_URL = previousOrigin;

  mock.method(console, 'log', (prefix: string, data: string) => {
    if (prefix === '[call-click]') logs.push(JSON.parse(data));
  });
  const app = express();
  app.use('/api/call-clicks', router);
  // Если новый router перехватит соседний маршрут, этот тестовый endpoint не ответит.
  app.post('/api/feedback', (_req, res) => {
    res.json({ existingRoute: true });
  });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  mock.restoreAll();
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

function post(body: unknown, origin = allowedOrigin, contentType = 'text/plain;charset=UTF-8') {
  return fetch(`${endpoint}/api/call-clicks`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, Origin: origin, 'User-Agent': 'MedTaxi test browser' },
    body: JSON.stringify(body),
  });
}

test('text/plain JSON logs the click with server time and request User-Agent', async () => {
  const response = await post(payload);
  assert.equal(response.status, 202);
  assert.equal(response.headers.get('access-control-allow-origin'), allowedOrigin);
  assert.deepEqual(await response.json(), { accepted: true, eventId: payload.eventId });
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0].utm, payload.utm);
  assert.equal(logs[0].userAgent, 'MedTaxi test browser');
  assert.equal(Number.isNaN(Date.parse(logs[0].receivedAt as string)), false);
  assert.equal('ip' in logs[0], false);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].eventId, payload.eventId);
  assert.equal(notifications[0].userAgent, 'MedTaxi test browser');
});

test('application/json is accepted too, with optional attribution omitted', async () => {
  const { eventId, trackingId, phone, page } = payload;
  const response = await post({ eventId, trackingId, phone, page }, allowedOrigin, 'application/json');
  assert.equal(response.status, 202);
});

test('invalid payload and untrusted extra fields return 400 without logging', async () => {
  const count = logs.length;
  for (const body of [
    { ...payload, eventId: 'broken-uuid' },
    { ...payload, phone: 'not-a-phone' },
    { ...payload, trackingId: 'button\nforged-log' },
    { ...payload, utm: { source: 'x'.repeat(256) } },
    { ...payload, ip: '192.0.2.1' },
  ]) {
    const response = await post(body);
    assert.equal(response.status, 400);
  }
  assert.equal(logs.length, count);
});

test('malformed JSON returns 400', async () => {
  const response = await fetch(`${endpoint}/api/call-clicks`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Origin: allowedOrigin },
    body: '{broken',
  });
  assert.equal(response.status, 400);
});

test('body larger than 16 KB returns 413', async () => {
  const response = await post({ ...payload, extra: 'x'.repeat(17 * 1024) });
  assert.equal(response.status, 413);
});

test('unknown browser origin is rejected before logging', async () => {
  const count = logs.length;
  const response = await post(payload, 'https://untrusted.test');
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(logs.length, count);
});

test('allowed preflight succeeds', async () => {
  const response = await fetch(`${endpoint}/api/call-clicks`, {
    method: 'OPTIONS',
    headers: { Origin: allowedOrigin, 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), allowedOrigin);
});

test('new router does not intercept /api/feedback', async () => {
  const response = await fetch(`${endpoint}/api/feedback`, { method: 'POST' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { existingRoute: true });
});

test('per-address request limit eventually returns 429 and Retry-After', async () => {
  // В предыдущих тестах уже были запросы с того же адреса; доходим до лимита.
  for (let attempt = 0; attempt <= 120; attempt += 1) {
    const response = await post(payload);
    if (response.status === 429) {
      assert.ok(Number(response.headers.get('retry-after')) > 0);
      return;
    }
    assert.equal(response.status, 202);
  }
  assert.fail('Rate limiter did not reject repeated requests');
});
