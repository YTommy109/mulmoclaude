/**
 * Text Response Plugin - Type Definitions
 */

export interface TextResponseData {
  text: string;
  role?: "assistant" | "system" | "user";
  transportKind?: string;
  // Workspace-relative paths of files the user attached when sending
  // this turn (paste/drop/file-picker). Persisted on the user message
  // so the chat history can render an icon / thumbnail chip alongside
  // the bubble. Empty / undefined for assistant and system turns.
  attachments?: string[];
}

export type TextResponseArgs = TextResponseData;
