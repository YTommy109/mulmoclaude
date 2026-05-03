import { createApp } from "vue";
import App from "./App.vue";
import router from "./router/index";
import { installGuards } from "./router/guards";
import i18n from "./lib/vue-i18n";
import { setAuthToken } from "./utils/api";
import { readAuthTokenFromMeta } from "./utils/dom/authTokenMeta";
import { loadRuntimePlugins } from "./tools/runtimeLoader";
import { installHostContext, type EndpointRegistry } from "./plugins/api";
import { API_ROUTES } from "./config/apiRoutes";
import { BUILTIN_ROLE_IDS } from "./config/roles";
import { PAGE_ROUTES } from "./router";
import { getAllPluginNames } from "./tools";
import "./index.css";
import "material-icons/iconfont/material-icons.css";
import "material-symbols/outlined.css";

import.meta.glob(["../node_modules/@gui-chat-plugin/*/dist/style.css", "../node_modules/@mulmochat-plugin/*/dist/style.css"], { eager: true });

// Bearer auth bootstrap (#272). The server embeds the per-startup
// token into `<meta name="mulmoclaude-auth" content="...">` when it
// serves index.html. Reading it here and handing to setAuthToken()
// wires every subsequent apiFetch / apiGet / ... to attach an
// `Authorization: Bearer ...` header. A missing or empty token means
// requests will 401 — that's the intended dev-time signal when the
// server isn't running.
setAuthToken(readAuthTokenFromMeta());

// Plugin DI: wire the host's URL map / role IDs / page-name
// constants / plugin registry into the plugin-side resolver BEFORE
// app.mount(). Plugin code reads from this registry via the
// `pluginEndpoints` / `pluginBuiltinRoleIds` / `pluginPageRoute` /
// `pluginAllPluginNames` helpers in `./plugins/api`. Plugin source
// has zero direct dependency on `./config/*` — host wires them in
// here, which is the only place that knows both ends.
//
// The endpoint registry is built explicitly per-plugin (rather than
// a blanket `API_ROUTES` cast) so each plugin's scope name is
// stable regardless of where the host happens to nest the URLs in
// the apiRoutes tree. A plugin under `API_ROUTES.plugins.canvas`
// still gets a clean top-level scope `"canvas"`.
const pluginEndpointRegistry: EndpointRegistry = {
  // Top-level groups owned entirely by one plugin.
  todos: API_ROUTES.todos,
  scheduler: API_ROUTES.scheduler,
  mulmoScript: API_ROUTES.mulmoScript,
  skills: API_ROUTES.skills,
  sources: API_ROUTES.sources,
  html: API_ROUTES.html,
  chart: API_ROUTES.chart,
  wiki: API_ROUTES.wiki,
  roles: API_ROUTES.roles,
  // generateImage + editImages share `image.*`; both ask for scope "image".
  image: API_ROUTES.image,
  // Nested under API_ROUTES.plugins.* — promoted to flat plugin scopes.
  canvas: { dispatch: API_ROUTES.plugins.canvas },
  presentDocument: {
    presentDocument: API_ROUTES.plugins.presentDocument,
    updateMarkdown: API_ROUTES.plugins.updateMarkdown,
  },
  presentSpreadsheet: {
    presentSpreadsheet: API_ROUTES.plugins.presentSpreadsheet,
    updateSpreadsheet: API_ROUTES.plugins.updateSpreadsheet,
  },
  presentForm: { dispatch: API_ROUTES.plugins.form },
  // Cross-cutting host-shared services that plugins reach for
  // (read workspace files, look up MCP tools, save canvas image
  // back to disk). Exposed as their own scopes so plugins don't
  // import `API_ROUTES.files` / `image.update` / `mcpTools` directly.
  files: API_ROUTES.files,
  imageStore: { update: API_ROUTES.image.update },
  mcpTools: { list: API_ROUTES.mcpTools.list },
};

installHostContext({
  endpoints: pluginEndpointRegistry,
  builtinRoleIds: BUILTIN_ROLE_IDS,
  pageRoutes: PAGE_ROUTES,
  getAllPluginNames,
});

// Runtime-loaded plugins (#1043 C-2). Fire-and-forget: kick off the
// list fetch + dynamic imports immediately but do NOT block mount.
// Static plugins are bundled and ready synchronously; runtime
// plugins fill in over the next ~100ms while the app is rendering
// its first paint. By the time the LLM actually calls a runtime
// tool (which requires at least one user message round-trip), the
// registry is fully populated.
//
// Awaiting here would delay first paint even when there are no
// runtime plugins installed (every workspace today), and it shifted
// the timing of `page.goto("/chat")` enough to break the
// today-journal-button E2E spec, which captured the URL before
// app mount completed.
loadRuntimePlugins().catch((err: unknown) => {
  console.warn("[runtime-plugin] boot loader threw", err);
});

installGuards(router);

const app = createApp(App);
app.use(router);
app.use(i18n);
app.mount("#app");
