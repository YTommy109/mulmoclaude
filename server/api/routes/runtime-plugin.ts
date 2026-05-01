// HTTP routes for runtime-loaded plugins (#1043 C-2).
//
//   GET  /api/plugins/runtime/list
//        → { plugins: [{ name, version, toolName, description }, …] }
//
//   POST /api/plugins/runtime/:pkg/dispatch
//        body: <args> directly — same convention as static plugin
//              endpoints (see server/api/routes/plugins.ts), so
//              mcp-server's generic `postJson(endpoint, args)` works
//              unchanged for runtime plugins.
//        → whatever the plugin's `execute()` returns (forwarded as JSON)
//
//   GET  /api/plugins/runtime/:pkg/:version/*
//        Static-mount of the extracted cache directory; the frontend
//        loader uses this for `import("/api/plugins/runtime/<pkg>/<ver>/dist/vue.js")`.
//
// The registry is owned by `server/plugins/runtime-registry.ts` and
// populated at boot from the install ledger. A 404 from any of these
// routes means the plugin isn't installed (or failed to load — see
// boot logs).

import path from "node:path";
import { existsSync, promises as fsp } from "node:fs";
import { Router, type Request, type Response } from "express";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { getRuntimePlugins } from "../../plugins/runtime-registry.js";
import { notFound, serverError } from "../../utils/httpError.js";
import { errorMessage } from "../../utils/errors.js";
import { isRecord } from "../../utils/types.js";
import { log } from "../../system/logger/index.js";
import { WORKSPACE_PATHS } from "../../workspace/paths.js";

const LOG_PREFIX = "api/plugins/runtime";

const router = Router();

interface ListedPlugin {
  name: string;
  version: string;
  toolName: string;
  description: string;
  /** Absolute URL prefix the frontend uses for static-mount fetches. */
  assetBase: string;
}

router.get(API_ROUTES.plugins.runtimeList, (_req: Request, res: Response<{ plugins: ListedPlugin[] }>) => {
  const plugins = getRuntimePlugins().map<ListedPlugin>((entry) => ({
    name: entry.name,
    version: entry.version,
    toolName: entry.definition.name,
    description: entry.definition.description,
    assetBase: `/api/plugins/runtime/${encodeURIComponent(entry.name)}/${encodeURIComponent(entry.version)}`,
  }));
  res.json({ plugins });
});

router.post(API_ROUTES.plugins.runtimeDispatch, async (req: Request<{ pkg: string }>, res: Response) => {
  const pkg = decodeURIComponent(req.params.pkg);
  const plugin = getRuntimePlugins().find((entry) => entry.name === pkg);
  if (!plugin) {
    notFound(res, `runtime plugin "${pkg}" not registered`);
    return;
  }
  const def = plugin.definition as unknown as { execute?: (args: unknown) => unknown };
  if (typeof def.execute !== "function") {
    serverError(res, `runtime plugin "${pkg}" has no execute()`);
    return;
  }
  const args = isRecord(req.body) ? req.body : {};
  try {
    const result = await def.execute(args);
    // Forward whatever the plugin returns as the response body
    // (mirrors static plugin routes — see plugins.ts). MCP server
    // spreads this into the toolResult event downstream.
    res.json(result);
  } catch (err) {
    log.error(LOG_PREFIX, "execute failed", { pkg, error: errorMessage(err) });
    serverError(res, `plugin execute failed: ${errorMessage(err)}`);
  }
});

// Static-mount of the extracted plugin cache. Express resolves
// `:pkg/:version/*` with the wildcard available on
// `req.params[0]`. Path is normalised to prevent traversal outside
// the plugin's cache directory.
router.get(API_ROUTES.plugins.runtimeAsset, async (req: Request<{ pkg: string; version: string; "0": string }>, res: Response) => {
  const pkg = decodeURIComponent(req.params.pkg);
  const version = decodeURIComponent(req.params.version);
  const { 0: subPath } = req.params;
  const root = path.join(WORKSPACE_PATHS.pluginCache, pkg, version);
  const target = path.normalize(path.join(root, subPath));
  if (!target.startsWith(root + path.sep) && target !== root) {
    notFound(res, "asset not found");
    return;
  }
  if (!existsSync(target)) {
    notFound(res, "asset not found");
    return;
  }
  try {
    const data = await fsp.readFile(target);
    const ext = path.extname(target).toLowerCase();
    const contentType = contentTypeFor(ext);
    res.setHeader("Content-Type", contentType);
    res.send(data);
  } catch (err) {
    log.error(LOG_PREFIX, "asset read failed", { pkg, version, subPath, error: errorMessage(err) });
    serverError(res, "asset read failed");
  }
});

function contentTypeFor(ext: string): string {
  switch (ext) {
    case ".js":
    case ".mjs":
    case ".cjs":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".map":
      return "application/json; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

export default router;
