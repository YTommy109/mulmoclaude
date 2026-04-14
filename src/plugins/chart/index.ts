import type { ToolPlugin } from "../../tools/types";
import toolDefinition, { TOOL_NAME } from "./definition";
import View from "./View.vue";
import Preview from "./Preview.vue";

export interface ChartEntry {
  title?: string;
  type?: string;
  option: Record<string, unknown>;
}

export interface ChartDocument {
  title?: string;
  charts: ChartEntry[];
}

export interface PresentChartData {
  document: ChartDocument;
  title?: string;
  filePath: string;
}

const presentChartPlugin: ToolPlugin<PresentChartData> = {
  toolDefinition,

  async execute(_context, args) {
    try {
      const res = await fetch("/api/present-chart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!res.ok) {
        // Server responds with { error: string }; fall back to
        // statusText if the body is missing or malformed.
        const body = (await res.json().catch(() => null)) as {
          error?: string;
          message?: string;
        } | null;
        const message = body?.error ?? body?.message ?? res.statusText;
        return {
          toolName: TOOL_NAME,
          uuid: crypto.randomUUID(),
          error: message,
        };
      }
      const result = await res.json();
      return {
        ...result,
        toolName: TOOL_NAME,
        uuid: crypto.randomUUID(),
      };
    } catch (error) {
      return {
        toolName: TOOL_NAME,
        uuid: crypto.randomUUID(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  isEnabled: () => true,
  generatingMessage: "Rendering chart…",
  viewComponent: View,
  previewComponent: Preview,
};

export default presentChartPlugin;
export { TOOL_NAME };
