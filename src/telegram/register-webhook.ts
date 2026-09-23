import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

interface TelegramApiResponse {
  ok: boolean;
  description?: string;
}

const requireEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const main = async (): Promise<void> => {
  const token = requireEnv('FREEZE_MASTER_TELEGRAM_TOKEN');
  const secret = requireEnv('TELEGRAM_WEBHOOK_SECRET');
  const publicBackendUrl = new URL(requireEnv('PUBLIC_BACKEND_URL'));
  if (publicBackendUrl.protocol !== 'https:') {
    throw new Error('PUBLIC_BACKEND_URL must use HTTPS');
  }

  const webhookUrl = new URL('/api/telegram/webhook', publicBackendUrl).toString();
  const response = await axios.post<TelegramApiResponse>(
    `https://api.telegram.org/bot${token}/setWebhook`,
    {
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    },
    { timeout: 10_000 },
  );

  if (!response.data.ok) throw new Error(response.data.description || 'Telegram rejected setWebhook');
  console.log(`[telegram-webhook] configured: ${webhookUrl}`);
};

main().catch((error: unknown) => {
  const description = axios.isAxiosError<TelegramApiResponse>(error)
    ? error.response?.data?.description || error.message
    : error instanceof Error ? error.message : String(error);
  console.error('[telegram-webhook] setup failed:', description);
  process.exitCode = 1;
});
