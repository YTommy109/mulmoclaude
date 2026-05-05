// Translation HTTP route — POST /api/translation. Thin handler that
// delegates to the translation service; validation lives there.

import { Router, type Request, type Response } from "express";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { createTranslationService, TranslationInputError } from "../../services/translation/index.js";
import { defaultTranslateBatch } from "../../services/translation/llm.js";
import { log } from "../../system/logger/index.js";
import type { TranslateBatchFn, TranslateRequest, TranslateResponse } from "../../services/translation/types.js";

export interface TranslationRouteDeps {
  /** Override for tests — defaults to the live workspace root. */
  workspaceRoot?: string;
  /** Override for tests — defaults to the production claude-CLI backend. */
  translateBatch?: TranslateBatchFn;
}

interface TranslateErrorBody {
  error: string;
}

export function createTranslationRouter(deps: TranslationRouteDeps = {}): Router {
  const router = Router();
  const service = createTranslationService({
    translateBatch: deps.translateBatch ?? defaultTranslateBatch,
    workspaceRoot: deps.workspaceRoot,
  });

  router.post(API_ROUTES.translation.translate, async (req: Request, res: Response<TranslateResponse | TranslateErrorBody>) => {
    try {
      const result = await service.translate(req.body as TranslateRequest);
      res.json(result);
    } catch (err) {
      if (err instanceof TranslationInputError) {
        res.status(400).json({ error: err.message });
        return;
      }
      log.error("translation-route", "translate failed", { error: String(err) });
      res.status(500).json({ error: "translation failed" });
    }
  });

  return router;
}
