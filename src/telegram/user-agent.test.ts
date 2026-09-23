import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatUserAgent, parseUserAgent } from './user-agent';

test('formats iPhone Safari exactly for the Telegram card', () => {
  const userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) '
    + 'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

  assert.equal(formatUserAgent(userAgent), 'iPhone · iOS 18.5 · Safari 18.5 · mobile');
});

test('recognizes Android model and Chrome', () => {
  const userAgent = 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro Build/AP3A.241105.008) '
    + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.80 Mobile Safari/537.36';

  assert.deepEqual(parseUserAgent(userAgent), {
    device: 'Pixel 9 Pro',
    os: 'Android 15',
    browser: 'Chrome 140.0.7339',
    deviceType: 'mobile',
  });
});

test('recognizes desktop Windows and Edge', () => {
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
    + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.3485.54';

  assert.equal(formatUserAgent(userAgent), 'PC · Windows 10/11 · Edge 140.0.3485 · desktop');
});
