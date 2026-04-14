<template>
  <div class="h-full bg-white flex flex-col overflow-hidden">
    <!-- Header -->
    <div
      class="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0"
    >
      <div>
        <h2 class="text-lg font-semibold text-gray-800">Skills</h2>
        <p class="text-xs text-gray-400 mt-0.5">
          {{ skills.length }} available · click one to view · "Run" sends its
          SKILL.md as a message
        </p>
      </div>
    </div>

    <div class="flex-1 min-h-0 flex overflow-hidden">
      <!-- Left: skill list -->
      <div
        class="w-64 shrink-0 border-r border-gray-100 overflow-y-auto bg-gray-50"
      >
        <div
          v-for="skill in skills"
          :key="skill.name"
          :data-testid="`skill-item-${skill.name}`"
          class="cursor-pointer px-4 py-3 border-b border-gray-100 text-sm hover:bg-white transition-colors"
          :class="
            selectedName === skill.name
              ? 'bg-white border-l-2 border-l-blue-500'
              : ''
          "
          @click="selectedName = skill.name"
        >
          <div class="font-medium text-gray-800 truncate">{{ skill.name }}</div>
          <div class="text-xs text-gray-500 truncate mt-0.5">
            {{ skill.description }}
          </div>
          <div class="text-[10px] text-gray-400 uppercase mt-0.5">
            {{ skill.source }}
          </div>
        </div>
        <p v-if="skills.length === 0" class="p-4 text-sm text-gray-400 italic">
          No skills found. Add skill folders under
          <code class="text-[11px]">~/.claude/skills/</code>.
        </p>
      </div>

      <!-- Right: detail pane -->
      <div class="flex-1 min-w-0 overflow-y-auto">
        <div v-if="!selected" class="p-6 text-sm text-gray-400 italic">
          Select a skill on the left to view its SKILL.md.
        </div>
        <div v-else class="p-6">
          <div class="flex items-start justify-between gap-4 mb-4">
            <div class="min-w-0">
              <h3 class="text-xl font-semibold text-gray-800 truncate">
                {{ selected.name }}
              </h3>
              <p class="text-sm text-gray-600 mt-1">
                {{ selected.description }}
              </p>
            </div>
            <button
              class="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 shrink-0 flex items-center gap-1"
              :disabled="detailLoading || !detail"
              data-testid="skill-run-btn"
              @click="runSkill"
            >
              <span class="material-icons text-base">play_arrow</span>
              Run
            </button>
          </div>
          <div v-if="detailLoading" class="text-sm text-gray-400 italic">
            Loading…
          </div>
          <div v-else-if="detailError" class="text-sm text-red-600">
            {{ detailError }}
          </div>
          <pre
            v-else-if="detail"
            class="text-xs text-gray-700 whitespace-pre-wrap font-mono bg-gray-50 p-4 rounded border border-gray-200"
            >{{ detail.body || "(empty body)" }}</pre
          >
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { ManageSkillsData, SkillSummary } from "./index";

interface SkillDetail {
  name: string;
  description: string;
  body: string;
  source: "user" | "project";
  path: string;
}

const props = defineProps<{
  selectedResult: ToolResultComplete<ManageSkillsData>;
}>();

const skills = computed<SkillSummary[]>(
  () => props.selectedResult.data?.skills ?? [],
);
const selectedName = ref<string | null>(skills.value[0]?.name ?? null);
const detail = ref<SkillDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref<string | null>(null);

const selected = computed(
  () => skills.value.find((s) => s.name === selectedName.value) ?? null,
);

// Reset the selection when the tool result is replaced (e.g. the
// user opens a newer `manageSkills` invocation from the sidebar).
watch(
  () => props.selectedResult.uuid,
  () => {
    selectedName.value = skills.value[0]?.name ?? null;
  },
);

// Fetch detail when the selection changes. Failures surface inline
// so the Run button stays disabled and the user sees why.
watch(
  selectedName,
  async (name) => {
    if (!name) {
      detail.value = null;
      return;
    }
    detailLoading.value = true;
    detailError.value = null;
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(name)}`);
      if (!res.ok) {
        detailError.value = `Failed to load skill: ${res.statusText}`;
        detail.value = null;
        return;
      }
      const body: { skill: SkillDetail } = await res.json();
      detail.value = body.skill;
    } catch (err) {
      detailError.value = err instanceof Error ? err.message : String(err);
      detail.value = null;
    } finally {
      detailLoading.value = false;
    }
  },
  { immediate: true },
);

// Run = send the skill invocation as a Claude Code slash command.
// Claude CLI already knows about every ~/.claude/skills/<name>/SKILL.md
// at spawn, so sending `/<name>` is enough — no need to ship the
// body. App.vue listens for the `skill-run` window event and routes
// to its existing sendMessage pipeline. (See論点 1 on PR #224.)
function runSkill(): void {
  if (!selectedName.value) return;
  window.dispatchEvent(
    new CustomEvent("skill-run", {
      detail: { message: `/${selectedName.value}` },
    }),
  );
}
</script>
