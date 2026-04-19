// LINE webhook handler — verify signature + extract messages.

import { verifyHmacSha256 } from "../crypto.js";
import { PLATFORMS, type RelayMessage } from "../types.js";

interface LineEvent {
  type: string;
  message?: { type: string; text?: string; id?: string };
  source?: { userId?: string; groupId?: string; roomId?: string };
  replyToken?: string;
}

interface LineWebhookBody {
  events: LineEvent[];
}

export async function handleLineWebhook(
  request: Request,
  channelSecret: string,
): Promise<RelayMessage[]> {
  const body = await request.text();
  const signature = request.headers.get("x-line-signature") ?? "";

  // LINE uses base64-encoded HMAC-SHA256
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));

  if (expected !== signature) {
    throw new Error("LINE signature verification failed");
  }

  const parsed: LineWebhookBody = JSON.parse(body);
  const messages: RelayMessage[] = [];

  for (const event of parsed.events) {
    if (event.type !== "message" || event.message?.type !== "text") continue;
    if (!event.message.text) continue;

    const chatId =
      event.source?.groupId ??
      event.source?.roomId ??
      event.source?.userId ??
      "unknown";

    messages.push({
      id: crypto.randomUUID(),
      platform: PLATFORMS.line,
      senderId: event.source?.userId ?? "unknown",
      chatId,
      text: event.message.text,
      receivedAt: new Date().toISOString(),
      replyToken: event.replyToken,
    });
  }

  return messages;
}

export async function sendLineReply(
  replyToken: string,
  text: string,
  accessToken: string,
): Promise<void> {
  // Chunk long messages (LINE max is 5000 chars)
  const MAX_LINE_TEXT = 5000;
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += MAX_LINE_TEXT) {
    chunks.push(text.slice(i, i + MAX_LINE_TEXT));
  }

  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: chunks.map((t) => ({ type: "text", text: t })),
    }),
  });
}

export async function sendLinePush(
  chatId: string,
  text: string,
  accessToken: string,
): Promise<void> {
  const MAX_LINE_TEXT = 5000;
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += MAX_LINE_TEXT) {
    chunks.push(text.slice(i, i + MAX_LINE_TEXT));
  }

  await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      to: chatId,
      messages: chunks.map((t) => ({ type: "text", text: t })),
    }),
  });
}
