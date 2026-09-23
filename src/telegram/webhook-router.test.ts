import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import express from 'express';
import { createTelegramWebhookRouter } from './webhook-router';
import type { TelegramUpdate } from './types';

const secret = 'test_webhook_secret';
const allowedChatId = '-100123456';
const updates: TelegramUpdate[] = [];
let server: Server;
let endpoint: string;

before(async () => {
  const app = express();
  app.use('/api/telegram/webhook', createTelegramWebhookRouter({
    secret,
    allowedChatId,
    allowedOperatorIds: new Set(['112233']),
    onUpdate: (update) => {
      updates.push(update);
    },
  }));
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/telegram/webhook`;
});

after(async () => {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

const postUpdate = (update: unknown, suppliedSecret = secret) => fetch(endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Telegram-Bot-Api-Secret-Token': suppliedSecret,
  },
  body: JSON.stringify(update),
});

test('rejects requests with an invalid webhook secret', async () => {
  const response = await postUpdate({ update_id: 1 }, 'wrong');
  assert.equal(response.status, 401);
  assert.equal(updates.length, 0);
});

test('accepts an authorized update and ignores its duplicate', async () => {
  const update: TelegramUpdate = {
    update_id: 2,
    message: {
      message_id: 10,
      text: '/start',
      chat: { id: allowedChatId, type: 'private' },
      from: { id: 112233 },
    },
  };
  const first = await postUpdate(update);
  const duplicate = await postUpdate(update);
  assert.equal(first.status, 200);
  assert.equal(duplicate.status, 200);
  assert.equal(updates.length, 1);
});

test('accepts an update when the configured chat is a public @username', async () => {
  const usernameUpdates: TelegramUpdate[] = [];
  const app = express();
  app.use('/api/telegram/webhook', createTelegramWebhookRouter({
    secret,
    allowedChatId: '@MedTaxi2',
    allowedOperatorIds: new Set(['112233']),
    onUpdate: (update) => {
      usernameUpdates.push(update);
    },
  }));
  const usernameServer = app.listen(0, '127.0.0.1');
  await once(usernameServer, 'listening');

  try {
    const usernameEndpoint = `http://127.0.0.1:${(usernameServer.address() as AddressInfo).port}/api/telegram/webhook`;
    const response = await fetch(usernameEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': secret,
      },
      body: JSON.stringify({
        update_id: 4,
        callback_query: {
          id: 'callback-4',
          data: 'medtax:start:8039e6de-b47c-4c6e-8507-b128e1739e6c',
          from: { id: 112233 },
          message: {
            message_id: 12,
            chat: { id: '-100987654', type: 'supergroup', username: 'medtaxi2' },
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(usernameUpdates.length, 1);
  } finally {
    await new Promise<void>((resolve, reject) => {
      usernameServer.close((error) => error ? reject(error) : resolve());
    });
  }
});

test('silently ignores a user outside the operator allowlist', async () => {
  const response = await postUpdate({
    update_id: 3,
    message: {
      message_id: 11,
      text: '/start',
      chat: { id: allowedChatId, type: 'private' },
      from: { id: 999999 },
    },
  });
  assert.equal(response.status, 200);
  assert.equal(updates.length, 1);
});
