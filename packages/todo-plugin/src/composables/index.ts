// Vue composables entry — exported as `@mulmoclaude/todo-plugin/composables`
// so host components (`src/components/TodoExplorer.vue` + the kanban
// subcomponents) can pull `useTodos` without dragging in the
// runtime-loaded server entry or the View/Preview Vue components.

export { useTodos } from "./useTodos";
export type { UseTodosHandle } from "./useTodos";
