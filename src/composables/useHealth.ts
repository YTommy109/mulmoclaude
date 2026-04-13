// Composable for the server /api/health probe.
//
// Owns two refs that the UI reads (gemini key availability + sandbox
// toggle) plus the one-shot fetch that populates them on mount. On
// fetch failure we assume Gemini is unavailable so dependent UI
// (e.g. the "generate image" plugin buttons) falls back gracefully
// — the sandbox flag keeps its initial `true` so the lock indicator
// doesn't momentarily flash "sandbox disabled" on a transient error.

import { ref, type Ref } from "vue";

interface HealthResponse {
  geminiAvailable?: unknown;
  sandboxEnabled?: unknown;
}

export function useHealth(): {
  geminiAvailable: Ref<boolean>;
  sandboxEnabled: Ref<boolean>;
  fetchHealth: () => Promise<void>;
} {
  const geminiAvailable = ref(true);
  const sandboxEnabled = ref(true);

  async function fetchHealth(): Promise<void> {
    try {
      const res = await fetch("/api/health");
      if (!res.ok) throw new Error("health check failed");
      const data: HealthResponse = await res.json();
      geminiAvailable.value = !!data.geminiAvailable;
      sandboxEnabled.value = !!data.sandboxEnabled;
    } catch {
      geminiAvailable.value = false;
    }
  }

  return { geminiAvailable, sandboxEnabled, fetchHealth };
}
