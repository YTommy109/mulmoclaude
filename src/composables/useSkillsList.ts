import { readonly, ref, type Ref, type DeepReadonly } from "vue";
import { apiGet } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

export interface SkillSummary {
  name: string;
  description: string;
  source: "user" | "project";
}

// Module-level shared state so consumers (ChatInput, PageChatComposer,
// SuggestionsPanel) all see the same list. We do not cache: every
// `refresh()` re-hits /api/skills. The first auto-fetch on mount is
// a bootstrap so the panel has something to show on first open.
//
// Error policy: on a failed fetch we keep the previous `skills` value
// (so a transient blip doesn't visually wipe the list) and surface the
// failure through `error`. The Skills tab renders that as a banner so
// the user can tell stale data from current data. A successful refresh
// clears `error`.
const skills = ref<SkillSummary[]>([]);
const error = ref<string | null>(null);
let bootstrapped = false;
let inflight: Promise<void> | null = null;

async function refresh(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const result = await apiGet<{ skills: SkillSummary[] }>(API_ROUTES.skills.list);
      if (result.ok && Array.isArray(result.data.skills)) {
        skills.value = result.data.skills;
        error.value = null;
      } else if (!result.ok) {
        error.value = result.error || "Failed to load skills";
      }
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function useSkillsList(): {
  skills: DeepReadonly<Ref<SkillSummary[]>>;
  error: DeepReadonly<Ref<string | null>>;
  refresh: () => Promise<void>;
} {
  if (!bootstrapped) {
    bootstrapped = true;
    void refresh();
  }
  return {
    skills: readonly(skills),
    error: readonly(error),
    refresh,
  };
}
