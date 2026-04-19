// Relay message format — normalized from platform-specific webhooks.

export const PLATFORMS = {
  line: "line",
  telegram: "telegram",
  slack: "slack",
  discord: "discord",
  messenger: "messenger",
} as const;

export type Platform = (typeof PLATFORMS)[keyof typeof PLATFORMS];

export interface RelayMessage {
  id: string;
  platform: Platform;
  senderId: string;
  chatId: string;
  text: string;
  attachments?: RelayAttachment[];
  receivedAt: string;
  replyToken?: string;
}

export interface RelayAttachment {
  type: "image" | "file";
  url?: string;
  mimeType?: string;
}

export interface RelayResponse {
  platform: Platform;
  chatId: string;
  text: string;
  replyToken?: string;
}

export interface Env {
  RELAY: DurableObjectNamespace;
  RELAY_TOKEN: string;
  // LINE
  LINE_CHANNEL_SECRET?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  // Telegram
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
}
