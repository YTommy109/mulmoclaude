// Composable that owns the MCP tool state used by the sidebar:
// which tools are currently disabled, their per-tool prompts, and
// the derived `availableTools` / `toolDescriptions` computeds. The
// pure rules live in src/utils/mcpTools so they are unit-testable
// independently of fetch / Vue.

import { computed, ref, type ComputedRef } from "vue";
import type { Role } from "../config/roles";
import {
  availableToolsFor,
  toolDescriptionsFor,
  type ToolDefinitionMetadata,
} from "../utils/tools/mcp";
import { apiGet } from "../utils/api";

interface UseMcpToolsOptions {
  currentRole: ComputedRef<Role>;
  // Injection point for the in-app plugin registry lookup. Real
  // callers pass `(name) => getPlugin(name)?.toolDefinition ?? null`,
  // tests can stub it.
  getDefinition: (name: string) => ToolDefinitionMetadata | null;
}

export function useMcpTools(opts: UseMcpToolsOptions) {
  const disabledMcpTools = ref(new Set<string>());
  const mcpToolDescriptions = ref<Record<string, string>>({});

  const availableTools = computed(() =>
    availableToolsFor(
      opts.currentRole.value.availablePlugins,
      disabledMcpTools.value,
    ),
  );

  const toolDescriptions = computed(() =>
    toolDescriptionsFor(
      opts.currentRole.value.availablePlugins,
      opts.getDefinition,
      mcpToolDescriptions.value,
    ),
  );

  interface McpToolStatus {
    name: string;
    enabled: boolean;
    prompt?: string;
  }

  function hasPrompt(
    tool: McpToolStatus,
  ): tool is McpToolStatus & { prompt: string } {
    return typeof tool.prompt === "string" && tool.prompt.length > 0;
  }

  async function fetchMcpToolsStatus(): Promise<void> {
    const result = await apiGet<McpToolStatus[]>("/api/mcp-tools");
    // Ignore failures and unexpected shapes — all tools remain visible
    // if anything goes wrong. The Array.isArray guard makes explicit
    // the previous behaviour (a try/catch used to silently swallow a
    // .filter TypeError when the response wasn't an array).
    if (!result.ok || !Array.isArray(result.data)) return;
    const tools = result.data;
    disabledMcpTools.value = new Set(
      tools.filter((t) => !t.enabled).map((t) => t.name),
    );
    mcpToolDescriptions.value = Object.fromEntries(
      tools.filter(hasPrompt).map((t) => [t.name, t.prompt]),
    );
  }

  return {
    disabledMcpTools,
    mcpToolDescriptions,
    availableTools,
    toolDescriptions,
    fetchMcpToolsStatus,
  };
}
