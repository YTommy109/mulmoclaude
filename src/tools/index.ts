import type { ToolPlugin } from "./types";
import TextResponsePlugin from "@gui-chat-plugin/text-response/vue";
import todoPlugin from "../plugins/todo/index";

const plugins: Record<string, ToolPlugin> = {
  "text-response": TextResponsePlugin.plugin as unknown as ToolPlugin,
  "manageTodoList": todoPlugin as unknown as ToolPlugin,
};

export function getPlugin(name: string): ToolPlugin | null {
  return plugins[name] ?? null;
}

export function getPlugins(names: string[]): Record<string, ToolPlugin> {
  return Object.fromEntries(
    names.flatMap(name => {
      const plugin = plugins[name];
      return plugin ? [[name, plugin]] : [];
    })
  );
}

export function getAllPluginNames(): string[] {
  return Object.keys(plugins);
}
