// Telegram webhook handler — verify secret + extract messages.

import { PLATFORMS, type RelayMessage } from "../types.js";

interface TelegramUpdate {
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string };
    chat: { id: number; type: string };
    text?: string;
  };
}

export function handleTelegramWebhook(
  body: string,
  secretToken: string | undefined,
  headerSecret: string | null,
): RelayMessage[] {
  // Verify secret_token header if configured
  if (secretToken && headerSecret !== secretToken) {
    throw new Error("Telegram secret token verification failed");
  }

  const update: TelegramUpdate = JSON.parse(body);
  if (!update.message?.text) return [];

  const msg = update.message;
  return [
    {
      id: crypto.randomUUID(),
      platform: PLATFORMS.telegram,
      senderId: String(msg.from?.id ?? "unknown"),
      chatId: String(msg.chat.id),
      text: msg.text,
      receivedAt: new Date().toISOString(),
    },
  ];
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  botToken: string,
): Promise<void> {
  // Telegram max message length is 4096
  const MAX_TG_TEXT = 4096;
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += MAX_TG_TEXT) {
    chunks.push(text.slice(i, i + MAX_TG_TEXT));
  }

  for (const chunk of chunks) {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
      }),
    });
  }
}
