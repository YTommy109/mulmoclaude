#!/usr/bin/env node
// @mulmobridge/xmpp — XMPP / Jabber bridge for MulmoClaude.
//
// Connects to any XMPP server (ejabberd, Prosody, dino, Tigase, …) with
// a JID + password and bridges chat-type message stanzas into MulmoClaude.
// Outbound-only TCP over TLS — no public URL needed.
//
// Required env vars:
//   XMPP_JID       — full JID, e.g. mulmobot@example.com
//   XMPP_PASSWORD  — account password (or app-specific password if the
//                    server supports that)
//   XMPP_SERVICE   — connection URI, e.g. xmpps://example.com:5223 (implicit TLS)
//                    or xmpp://example.com:5222 (STARTTLS)
//
// Optional:
//   XMPP_ALLOWED_JIDS — CSV of bare JIDs allowed to converse (empty = all)
//   XMPP_RESOURCE     — resource identifier (default "mulmobridge")

import "dotenv/config";
import xmppPkg, { type XmlElement } from "@xmpp/client";
import { createBridgeClient, chunkText } from "@mulmobridge/client";

const { client, xml } = xmppPkg;

const TRANSPORT_ID = "xmpp";
const MAX_BODY_LEN = 10_000;

const jid = process.env.XMPP_JID;
const password = process.env.XMPP_PASSWORD;
const service = process.env.XMPP_SERVICE;
if (!jid || !password || !service) {
  console.error("XMPP_JID, XMPP_PASSWORD, and XMPP_SERVICE are required.\n" + "See README for setup instructions.");
  process.exit(1);
}

const resource = process.env.XMPP_RESOURCE ?? "mulmobridge";
const allowedJids = new Set(
  (process.env.XMPP_ALLOWED_JIDS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean),
);
const allowAll = allowedJids.size === 0;

const { username, domain } = splitJid(jid);
if (!username || !domain) {
  console.error(`XMPP_JID must be in the form user@domain — got "${jid}"`);
  process.exit(1);
}

function splitJid(fullJid: string): { username: string; domain: string } {
  const atIdx = fullJid.indexOf("@");
  if (atIdx < 0) return { username: "", domain: "" };
  return { username: fullJid.slice(0, atIdx), domain: fullJid.slice(atIdx + 1) };
}

function bareJid(fullJid: string): string {
  const slashIdx = fullJid.indexOf("/");
  return (slashIdx < 0 ? fullJid : fullJid.slice(0, slashIdx)).toLowerCase();
}

const mulmo = createBridgeClient({ transportId: TRANSPORT_ID });

const xmpp = client({ service, domain, username, password, resource });

mulmo.onPush((pushEvent) => {
  sendChat(pushEvent.chatId, pushEvent.message).catch((err) => console.error(`[xmpp] push send failed: ${err}`));
});

// ── Send ────────────────────────────────────────────────────────

async function sendChat(toJid: string, text: string): Promise<void> {
  const chunks = chunkText(text, MAX_BODY_LEN);
  for (const chunk of chunks) {
    try {
      await xmpp.send(xml("message", { to: toJid, type: "chat" }, xml("body", {}, chunk)));
    } catch (err) {
      console.error(`[xmpp] send error: ${err}`);
    }
  }
}

// ── Receive ─────────────────────────────────────────────────────

async function handleStanza(stanza: XmlElement): Promise<void> {
  if (!stanza.is("message")) return;
  const stanzaType = stanza.attrs.type ?? "";
  if (stanzaType !== "chat" && stanzaType !== "normal") return;

  const from = typeof stanza.attrs.from === "string" ? stanza.attrs.from : "";
  const body = stanza.getChildText("body");
  if (!from || !body) return;

  const senderBare = bareJid(from);
  const selfBare = `${username}@${domain}`.toLowerCase();
  if (senderBare === selfBare) return; // ignore echo

  if (!allowAll && !allowedJids.has(senderBare)) {
    console.log(`[xmpp] denied from=${senderBare}`);
    return;
  }

  console.log(`[xmpp] message from=${senderBare} len=${body.length}`);

  try {
    const ack = await mulmo.send(senderBare, body);
    if (ack.ok) {
      await sendChat(senderBare, ack.reply ?? "");
    } else {
      const status = ack.status ? ` (${ack.status})` : "";
      await sendChat(senderBare, `Error${status}: ${ack.error ?? "unknown"}`);
    }
  } catch (err) {
    console.error(`[xmpp] handleStanza error: ${err}`);
  }
}

// ── Lifecycle ───────────────────────────────────────────────────

xmpp.on("error", (err: Error) => {
  console.error(`[xmpp] error: ${err.message}`);
});

xmpp.on("offline", () => {
  console.warn("[xmpp] offline");
});

xmpp.on("online", async (address: { toString: () => string }) => {
  console.log(`[xmpp] online as ${address.toString()}`);
  // Presence broadcast so contacts can see the bot is available.
  await xmpp.send(xml("presence"));
});

xmpp.on("stanza", (stanza: XmlElement) => {
  handleStanza(stanza).catch((err) => console.error(`[xmpp] stanza handler error: ${err}`));
});

// ── Main ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("MulmoClaude XMPP bridge");
  console.log(`JID: ${username}@${domain}/${resource}`);
  console.log(`Service: ${service}`);
  console.log(`Allowlist: ${allowAll ? "(all)" : [...allowedJids].join(", ")}`);

  await xmpp.start();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
