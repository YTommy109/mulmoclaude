// Edgar plugin config: contact info required by SEC EDGAR's
// User-Agent rule. The LLM is responsible for asking the user for
// these values and writing the file via its built-in Write tool —
// the missing-config response below tells it the absolute path
// and the JSON shape.

import path from "node:path";
import { z } from "zod";
import { workspacePath } from "../workspace/paths.js";
import { loadJsonFile } from "../utils/files/json.js";

const ConfigSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

export type EdgarConfig = z.infer<typeof ConfigSchema>;

const CONFIG_REL_PATH = "config/plugins/edgar/config.json";

/** Absolute path the plugin reads from / Claude must write to. */
export function configAbsolutePath(): string {
  return path.join(workspacePath, CONFIG_REL_PATH);
}

/** Best-effort read. Any failure (missing file, malformed JSON,
 *  schema mismatch) collapses to `null` so the dispatch returns
 *  the self-healing instructions instead of throwing. */
export function readConfig(): EdgarConfig | null {
  const raw = loadJsonFile<unknown>(configAbsolutePath(), null);
  if (raw === null) return null;
  const parsed = ConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Self-healing payload returned when config is missing. The LLM
 *  reads `instructions`, asks the user for name + email, calls
 *  its built-in Write tool with the absolute `path`, and retries
 *  the original tool call. */
export function missingConfigResponse(): {
  error: "config_required";
  instructions: string;
  path: string;
  schema: { name: string; email: string };
} {
  return {
    error: "config_required",
    instructions:
      "The SEC EDGAR API requires an identifying contact on every request. Please ask the user for their full name and email address, then write a JSON file at the absolute path below with the exact schema below, then retry the original tool call. Do not proceed without asking the user — never invent a name or email.",
    path: configAbsolutePath(),
    schema: { name: "<user's full name>", email: "<user's email address>" },
  };
}

/** Build the User-Agent header value SEC requires on every request. */
export function userAgentFromConfig(cfg: EdgarConfig): string {
  return `${cfg.name} ${cfg.email}`;
}
