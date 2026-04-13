import { Router, type Request, type Response } from "express";
import {
  fromMcpEntries,
  isAppSettings,
  loadMcpConfig,
  loadSettings,
  saveMcpConfig,
  saveSettings,
  toMcpEntries,
  type AppSettings,
  type McpServerEntry,
} from "../config.js";

// Public surface of /api/config. GET returns the full config tree so
// the client can render every section in one request. PUT surfaces are
// per-section to keep payloads small and validation obvious.
export interface ConfigResponse {
  settings: AppSettings;
  mcp: { servers: McpServerEntry[] };
}

export interface ConfigErrorResponse {
  error: string;
}

function buildFullResponse(): ConfigResponse {
  return {
    settings: loadSettings(),
    mcp: { servers: toMcpEntries(loadMcpConfig()) },
  };
}

function isMcpPutBody(value: unknown): value is { servers: McpServerEntry[] } {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  if (!Array.isArray(c.servers)) return false;
  // Full shape validation happens inside fromMcpEntries (throws on
  // anything malformed). Here we just confirm the envelope.
  return c.servers.every(
    (e) => typeof e === "object" && e !== null && "id" in e && "spec" in e,
  );
}

const router = Router();

router.get("/config", (_req: Request, res: Response<ConfigResponse>) => {
  res.json(buildFullResponse());
});

router.put(
  "/config/settings",
  (
    req: Request<unknown, unknown, AppSettings>,
    res: Response<ConfigResponse | ConfigErrorResponse>,
  ) => {
    const body = req.body;
    if (!isAppSettings(body)) {
      res.status(400).json({ error: "Invalid AppSettings payload" });
      return;
    }
    try {
      saveSettings(body);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "saveSettings failed",
      });
      return;
    }
    res.json(buildFullResponse());
  },
);

router.put(
  "/config/mcp",
  (
    req: Request<unknown, unknown, { servers: McpServerEntry[] }>,
    res: Response<ConfigResponse | ConfigErrorResponse>,
  ) => {
    const body = req.body;
    if (!isMcpPutBody(body)) {
      res.status(400).json({ error: "Invalid mcp payload envelope" });
      return;
    }
    try {
      const cfg = fromMcpEntries(body.servers);
      saveMcpConfig(cfg);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : "saveMcpConfig failed",
      });
      return;
    }
    res.json(buildFullResponse());
  },
);

export default router;
