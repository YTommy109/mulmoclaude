// Production `translateBatch`: spawns the `claude` CLI in print
// mode with a JSON schema so the response array length is
// guaranteed to match the request. Same auth model as the rest of
// the server (no API key required).
//
// Patterned after `server/workspace/chat-index/summarizer.ts`.

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { CLI_SUBPROCESS_TIMEOUT_MS } from "../../utils/time.js";
import { errorMessage } from "../../utils/errors.js";
import { formatSpawnFailure } from "../../utils/spawn.js";
import { isRecord } from "../../utils/types.js";
import { ClaudeCliNotFoundError } from "../../workspace/journal/archivist-cli.js";
import type { TranslateBatchFn } from "./types.js";

const SYSTEM_PROMPT =
  "You are a translation engine. The user input is a JSON object with `targetLanguage` (BCP-47) " +
  "and `sentences` (an array of English source strings). Translate each sentence into the target " +
  "language and return strict JSON matching the provided schema. The output `translations` array " +
  "MUST have the same length and order as the input `sentences` array. Preserve placeholders " +
  "such as `{name}`, `{count}`, `%s`, and HTML tags verbatim.";

const SCHEMA = {
  type: "object",
  properties: {
    translations: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["translations"],
};

// Small per-call cap. A few dozen short UI strings on haiku costs
// fractions of a cent; this guards against runaway prompts only.
const MAX_BUDGET_USD = 0.5;

interface ClaudeJsonEnvelope {
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
}

export function parseTranslations(stdout: string): string[] {
  let parsed: ClaudeJsonEnvelope;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch (err) {
    throw new Error(`[translation] failed to parse claude json output: ${errorMessage(err)}`);
  }
  if (parsed.is_error) {
    throw new Error(`[translation] claude returned error: ${parsed.result ?? "unknown"}`);
  }
  if (!isRecord(parsed.structured_output)) {
    throw new Error("[translation] structured_output missing or not an object");
  }
  const { translations } = parsed.structured_output as Record<string, unknown>;
  if (!Array.isArray(translations) || !translations.every((value): value is string => typeof value === "string")) {
    throw new Error("[translation] translations is not a string array");
  }
  return translations;
}

function buildArgs(promptInput: string): string[] {
  return [
    "--print",
    "--no-session-persistence",
    "--output-format",
    "json",
    "--model",
    "haiku",
    "--max-budget-usd",
    String(MAX_BUDGET_USD),
    "--json-schema",
    JSON.stringify(SCHEMA),
    "--system-prompt",
    SYSTEM_PROMPT,
    "-p",
    promptInput,
  ];
}

function spawnClaudeTranslate(promptInput: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // Run from tmpdir so claude does not load the project's
    // CLAUDE.md / plugins / memory and inflate the context.
    const proc = spawn("claude", buildArgs(promptInput), {
      cwd: tmpdir(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGKILL");
      reject(new Error(`[translation] claude translate timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err: Error & { code?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(new ClaudeCliNotFoundError());
      } else {
        reject(err);
      }
    });
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(formatSpawnFailure("[translation]", code, stdout, stderr)));
        return;
      }
      resolve(stdout);
    });
  });
}

export const defaultTranslateBatch: TranslateBatchFn = async ({ targetLanguage, sentences }) => {
  const promptInput = JSON.stringify({ targetLanguage, sentences });
  const stdout = await spawnClaudeTranslate(promptInput, CLI_SUBPROCESS_TIMEOUT_MS);
  return parseTranslations(stdout);
};
