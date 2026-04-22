#!/usr/bin/env node
// @mulmobridge/chatwork — Chatwork bridge for MulmoClaude.
//
// Polls each room the bot is a member of for unread messages, forwards
// them to MulmoClaude, and sends replies via the REST API. Outbound-only
// — no public URL required.
//
// Required env vars:
//   CHATWORK_API_TOKEN — API token from My → Service Integration
//
// Optional:
//   CHATWORK_ALLOWED_ROOMS  — CSV of room_ids the bot should listen in
//                             (empty = every room the bot is a member of)
//   CHATWORK_POLL_INTERVAL_SEC — poll interval seconds (default 5)

import "dotenv/config";
import { createBridgeClient, chunkText } from "@mulmobridge/client";

const TRANSPORT_ID = "chatwork";
const API_BASE = "https://api.chatwork.com/v2";
const MAX_MSG_LEN = 40_000; // Chatwork's practical limit is generous; chunk conservatively
const FETCH_TIMEOUT_MS = 15_000;

const apiToken = process.env.CHATWORK_API_TOKEN;
if (!apiToken) {
  console.error("CHATWORK_API_TOKEN is required.\n" + "See README for setup instructions.");
  process.exit(1);
}

const allowedRooms = new Set(
  (process.env.CHATWORK_ALLOWED_ROOMS ?? "")
    .split(",")
    .map((roomId) => roomId.trim())
    .filter(Boolean),
);
const allowAll = allowedRooms.size === 0;
const pollIntervalSec = Math.max(2, Number(process.env.CHATWORK_POLL_INTERVAL_SEC) || 5);

const mulmo = createBridgeClient({ transportId: TRANSPORT_ID });

mulmo.onPush((pushEvent) => {
  sendMessage(pushEvent.chatId, pushEvent.message).catch((err) => console.error(`[chatwork] push send failed: ${err}`));
});

// ── Chatwork REST helpers ───────────────────────────────────────

type JsonRecord = Record<string, unknown>;

function isObj(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

async function cwFetch(method: "GET" | "POST" | "PUT", path: string, form?: Record<string, string>): Promise<unknown> {
  const headers: Record<string, string> = { "X-ChatWorkToken": apiToken! };
  let body: string | undefined;
  if (form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(form).toString();
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ── Bot identity ────────────────────────────────────────────────

async function getBotAccountId(): Promise<number> {
  const profile = await cwFetch("GET", "/me");
  if (!isObj(profile) || typeof profile.account_id !== "number") {
    throw new Error("/me returned unexpected shape");
  }
  return profile.account_id;
}

async function getRoomIds(): Promise<string[]> {
  const rooms = await cwFetch("GET", "/rooms");
  if (!Array.isArray(rooms)) return [];
  return rooms.filter((room): room is JsonRecord => isObj(room) && typeof room.room_id === "number").map((room) => String(room.room_id));
}

// ── Send / receive ──────────────────────────────────────────────

async function sendMessage(roomId: string, text: string): Promise<void> {
  const chunks = chunkText(text, MAX_MSG_LEN);
  for (const chunk of chunks) {
    try {
      await cwFetch("POST", `/rooms/${roomId}/messages`, { body: chunk });
    } catch (err) {
      console.error(`[chatwork] sendMessage error: ${err}`);
    }
  }
}

interface ParsedMessage {
  messageId: string;
  accountId: number;
  accountName: string;
  body: string;
}

function parseMessage(raw: unknown): ParsedMessage | null {
  if (!isObj(raw)) return null;
  const messageId = typeof raw.message_id === "string" ? raw.message_id : "";
  const body = typeof raw.body === "string" ? raw.body : "";
  const account = isObj(raw.account) ? raw.account : null;
  if (!messageId || !body || !account) return null;
  const accountId = typeof account.account_id === "number" ? account.account_id : -1;
  const accountName = typeof account.name === "string" ? account.name : "unknown";
  return { messageId, accountId, accountName, body };
}

async function handleRoomMessage(roomId: string, botId: number, msg: ParsedMessage): Promise<void> {
  if (msg.accountId === botId) return; // ignore our own messages
  const text = stripChatworkTags(msg.body);
  if (!text) return;

  console.log(`[chatwork] message room=${roomId} from=${msg.accountName}(${msg.accountId}) len=${text.length}`);

  try {
    const ack = await mulmo.send(roomId, text);
    if (ack.ok) {
      await sendMessage(roomId, ack.reply ?? "");
    } else {
      const status = ack.status ? ` (${ack.status})` : "";
      await sendMessage(roomId, `Error${status}: ${ack.error ?? "unknown"}`);
    }
  } catch (err) {
    console.error(`[chatwork] message handling failed: ${err}`);
  }
}

function stripChatworkTags(body: string): string {
  // Remove common Chatwork tags: [To:id], [rp aid=id to=mid], [piconname:id], [qt]...[/qt], [info]...[/info]
  return body
    .replace(/\[To:\d+\]\s*/g, "")
    .replace(/\[rp[^\]]*\]\s*/g, "")
    .replace(/\[piconname:\d+\]\s*/g, "")
    .replace(/\[qt\][\s\S]*?\[\/qt\]/g, "")
    .replace(/\[info\]([\s\S]*?)\[\/info\]/g, "$1")
    .replace(/\[title\]([\s\S]*?)\[\/title\]/g, "$1")
    .trim();
}

// ── Poll loop ───────────────────────────────────────────────────

async function pollRoom(roomId: string, botId: number): Promise<void> {
  const result = await cwFetch("GET", `/rooms/${roomId}/messages?force=0`);
  if (!Array.isArray(result)) return; // 204 → null, or no new messages
  for (const raw of result) {
    const parsed = parseMessage(raw);
    if (parsed) await handleRoomMessage(roomId, botId, parsed);
  }
}

async function resolveActiveRooms(): Promise<string[]> {
  if (!allowAll) return [...allowedRooms];
  return getRoomIds();
}

async function pollLoop(botId: number): Promise<void> {
  while (true) {
    try {
      const rooms = await resolveActiveRooms();
      for (const roomId of rooms) {
        try {
          await pollRoom(roomId, botId);
        } catch (err) {
          console.error(`[chatwork] pollRoom ${roomId} error: ${err}`);
        }
      }
    } catch (err) {
      console.error(`[chatwork] poll loop error: ${err}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, pollIntervalSec * 1000));
  }
}

// ── Main ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("MulmoClaude Chatwork bridge");
  console.log(`Allowlist: ${allowAll ? "(all bot rooms)" : [...allowedRooms].join(", ")}`);
  console.log(`Poll interval: ${pollIntervalSec}s`);

  const botId = await getBotAccountId();
  console.log(`[chatwork] bot account_id=${botId}`);
  await pollLoop(botId);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
