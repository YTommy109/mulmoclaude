import { Router, Request, Response } from "express";
import path from "path";
import { workspacePath } from "../workspace.js";
import { loadJsonFile, saveJsonFile } from "../utils/file.js";
import {
  dispatchScheduler,
  type SchedulerActionInput,
} from "./schedulerHandlers.js";
import {
  respondWithDispatchResult,
  type DispatchSuccessResponse,
  type DispatchErrorResponse,
} from "./dispatchResponse.js";

const router = Router();

export interface ScheduledItem {
  id: string;
  title: string;
  createdAt: number;
  props: Record<string, string | number | boolean | null>;
}

const schedulerFile = () => path.join(workspacePath, "scheduler", "items.json");

function loadItems(): ScheduledItem[] {
  return loadJsonFile<ScheduledItem[]>(schedulerFile(), []);
}

function saveItems(items: ScheduledItem[]): void {
  saveJsonFile(schedulerFile(), items);
}

router.get(
  "/scheduler",
  (_req: Request, res: Response<{ data: { items: ScheduledItem[] } }>) => {
    res.json({ data: { items: loadItems() } });
  },
);

interface SchedulerBody extends SchedulerActionInput {
  action: string;
}

router.post(
  "/scheduler",
  (
    req: Request<object, unknown, SchedulerBody>,
    res: Response<
      DispatchSuccessResponse<ScheduledItem> | DispatchErrorResponse
    >,
  ) => {
    const { action, ...input } = req.body;
    const items = loadItems();
    const result = dispatchScheduler(action, items, input);
    // "show" is the only read-only action; everything else mutates.
    respondWithDispatchResult(res, result, {
      shouldPersist: action !== "show",
      instructions: "Display the updated scheduler to the user.",
      persist: saveItems,
    });
  },
);

export default router;
