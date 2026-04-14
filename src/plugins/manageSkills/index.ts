import type { ToolPlugin } from "../../tools/types";
import toolDefinition, { TOOL_NAME } from "./definition";
import View from "./View.vue";
import Preview from "./Preview.vue";

export interface SkillSummary {
  name: string;
  description: string;
  source: "user" | "project";
}

export interface ManageSkillsData {
  skills: SkillSummary[];
}

const manageSkillsPlugin: ToolPlugin<ManageSkillsData> = {
  toolDefinition,
  async execute() {
    // Claude invokes this tool to show the user their skills list.
    // The server exposes GET /api/skills (discovery + merge); we just
    // shape it for the View component.
    try {
      const res = await fetch("/api/skills");
      if (!res.ok) {
        return {
          toolName: TOOL_NAME,
          uuid: crypto.randomUUID(),
          message: `Failed to load skills: ${res.statusText}`,
          error: `Failed to load skills: ${res.statusText}`,
        };
      }
      const body: { skills: SkillSummary[] } = await res.json();
      return {
        toolName: TOOL_NAME,
        uuid: crypto.randomUUID(),
        title: "Skills",
        message: `Found ${body.skills.length} skill${body.skills.length === 1 ? "" : "s"}.`,
        data: { skills: body.skills },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        toolName: TOOL_NAME,
        uuid: crypto.randomUUID(),
        message: msg,
        error: msg,
      };
    }
  },
  isEnabled: () => true,
  generatingMessage: "Loading skills…",
  viewComponent: View,
  previewComponent: Preview,
};

export default manageSkillsPlugin;
export { TOOL_NAME };
