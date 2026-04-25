// `notify` MCP tool — exposes the server's notification bus to the
// agent so the user can ask "通知して" / "monitor the build and tell
// me when it's done" and the agent has a direct way to fire.
//
// Calls `publishNotification` with `kind: "push"`, which fans out
// to:
//   - Web bell (always)
//   - Bridge (if a transportId is supplied)
//   - macOS Reminders (#789, if MACOS_REMINDER_NOTIFICATIONS=1
//     + darwin)
//
// No active-user suppression — the original `/notify` skill had a
// client-side "user typed recently → silent" gate, but the agent
// is the wrong place to second-guess the user's intent. If the user
// asked for a notification, fire it. (The web bell tab dedupes its
// own visual badge anyway.)
//
// `body` is optional and only forwarded when non-empty. `title` is
// required and trimmed.

import { publishNotification } from "../../events/notifications.js";
import { NOTIFICATION_KINDS } from "../../../src/types/notification.js";

export const notify = {
  definition: {
    name: "notify",
    description:
      "Send the user a push-style notification (web bell + macOS Reminders if MACOS_REMINDER_NOTIFICATIONS=1 + bridge). Use to report completion of long-running tasks, surface monitoring results, or proactively notify the user when they may be away from the keyboard.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short notification headline. Keep it concise — emojis OK.",
        },
        body: {
          type: "string",
          description: "Optional longer detail line. Omit when the title is self-explanatory.",
        },
      },
      required: ["title"],
    },
  },

  prompt:
    "Use the `notify` tool whenever you would otherwise reach for an external notification mechanism — task completion announcements, monitoring summaries, scheduled reminders firing now, or any moment where the user explicitly says 'tell me when …' / '通知して' / 'remind me'. After firing, briefly tell the user you sent the notification.",

  async handler(args: Record<string, unknown>): Promise<string> {
    const title = typeof args.title === "string" ? args.title.trim() : "";
    if (!title) return "notify: `title` is required (non-empty string).";
    const bodyRaw = typeof args.body === "string" ? args.body.trim() : "";
    const body = bodyRaw.length > 0 ? bodyRaw : undefined;

    publishNotification({
      kind: NOTIFICATION_KINDS.push,
      title,
      body,
    });
    return body ? `Notification sent: ${title}\n${body}` : `Notification sent: ${title}`;
  },
};
