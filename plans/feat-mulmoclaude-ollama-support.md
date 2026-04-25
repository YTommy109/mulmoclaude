# feat: MulmoClaude × Ollama (local LLM) support

## Status

**Investigation only — no implementation yet.**

This plan documents what it would take to make MulmoClaude itself usable against a local Ollama backend (today only the standalone `claude` CLI works against Ollama; see `.claude/skills/setup-ollama-local/SKILL.md` and `docs/tips/claude-code-ollama.md`).

## Background / Why this is hard

MulmoClaude does not call the Anthropic API directly. The server **spawns the `claude` CLI as a child process** ([server/agent/index.ts](../server/agent/index.ts)) and pipes stream-json over stdin/stdout. Two consequences:

1. **The model selection is whatever `claude` defaults to.** [`buildCliArgs` in server/agent/config.ts](../server/agent/config.ts) does not pass `--model`.
2. **Backend selection is whatever env vars the parent process has.** When MulmoClaude is started normally, those are the cloud Claude defaults.

For local Ollama to work end-to-end, both the spawned CLI's model flag and its env have to point at the local server. Docker sandbox mode adds a third concern: env vars are not forwarded into the container, and `localhost:11434` from inside the container is not the host's Ollama (`host.docker.internal` would have to be added).

There is also a UX problem inherited from the Claude Code × Ollama work: even on `qwen3.5:9b` (the lightest verified-working model), the **first turn takes 10+ minutes** and subsequent turns 1–3 minutes on a MacBook Air M4 32GB. MulmoClaude's chat UI is interactive; users will not enjoy this. The implementation should at minimum make the trade-off explicit.

## Goal

Let a user opt into a local Ollama backend via settings or env, and have every spawn of `claude` (both bare and inside the Docker sandbox) route to that backend with the chosen model. Cloud usage remains the default and is not regressed.

## Scope tiers

The work has three natural cut points. Recommend stopping at Tier 2 unless there's clear demand.

### Tier 1: env + CLI flag pass-through (~50–100 LoC, ~half a day)

Just enough that a power user editing `settings.json` can switch to Ollama.

- [server/system/env.ts](../server/system/env.ts): add `ollamaBaseUrl?`, `ollamaModel?` (or a `llmProvider: "cloud" | "ollama"` discriminator) read from `process.env`.
- [server/agent/config.ts](../server/agent/config.ts):
  - `buildCliArgs`: when local mode, append `"--model", ollamaModel`.
  - `buildDockerSpawnArgs`: when local mode, add `-e ANTHROPIC_AUTH_TOKEN=ollama -e ANTHROPIC_API_KEY= -e ANTHROPIC_BASE_URL=http://host.docker.internal:11434` and `--add-host host.docker.internal:host-gateway` (Linux/Mac).
- [server/agent/index.ts](../server/agent/index.ts) `spawnClaude`: pass `env: { ...process.env, ANTHROPIC_* }` when local mode is enabled (non-Docker path inherits naturally; the Docker path is handled in step above).
- [server/system/config.ts](../server/system/config.ts): add `llm` object to settings schema (e.g. `{ provider: "cloud" | "ollama", ollamaBaseUrl?, ollamaModel? }`).

Done = manually editing `~/mulmoclaude/config/settings.json` flips the backend.

### Tier 2: settings UI + connection check (~300–500 LoC, ~2–3 days) — **recommended**

Make the option discoverable and at least somewhat safe.

Adds on top of Tier 1:

- New Vue section under [`src/components/`](../src/components/) (alongside the existing settings panes). Inputs for provider radio, base URL (default `http://localhost:11434`), model dropdown.
- `GET /api/settings/ollama/models` route that proxies `GET <baseUrl>/v1/models` and returns the list. Used to populate the dropdown.
- `POST /api/settings/ollama/test` route: makes a minimal `/v1/messages` request, returns `{ ok, kvSize, contextLength, error? }`. Used by a "Test connection" button.
- i18n: every new string lands in all 8 locales (`src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts`) — see CLAUDE.md i18n rules.
- Status indicator in the chat header showing **Cloud** vs **Ollama (model name)** so the active backend is never ambiguous.
- Warning copy in the UI explaining the slowness trade-off and that some MulmoClaude plugins/skills depend on tool calling that local models handle poorly.
- Tests:
  - Unit: env parsing, settings round-trip, CLI args construction in both modes (mirrors existing `test/agent/config.test.ts`-style coverage).
  - E2E: a fixture that mocks `localhost:11434` and verifies the settings UI flow + "Test connection" path.

### Tier 3: production polish (~1000+ LoC, 1–2 weeks)

Everything below is optional and only worth doing if local backend becomes a first-class story.

- **Timeout adjustments**: extend the SSE/agent loop timeouts when `provider === "ollama"` so the 10-minute Claude Code default does not kill the first turn.
- **Warm-up on boot**: when local mode is active, send a one-shot `/v1/messages` `"hello"` at server startup so the KV cache is primed before the first user turn.
- **Cloud fallback**: detect Ollama down / model missing and either fall back to cloud (with a banner) or surface a clear actionable error.
- **Plugin/skill compatibility flags**: maintain a list of plugins that depend on tool-use formatting and silently disable them in local mode (or warn in the UI).
- **Recommended-models check**: on save, compare the chosen model against an allowlist (qwen3.5+, MoE variants confirmed to handle thinking blocks correctly) and warn if unverified.
- **Progress UI**: parse the Ollama log stream and surface a "processing prompt X/Y tokens" hint in the chat UI so users understand why the first turn takes 10 minutes.
- **Docs**: update [docs/developer.md](../docs/developer.md), [README.md](../README.md), and the README translations under `packages/`.

## Open questions

- Do we want `provider` per-role (so e.g. the `general` role uses cloud and a `local-fast` role uses Ollama), or globally?
- Should the Docker sandbox mode be supported for local Ollama at all? Forwarding `host.docker.internal` makes the container less isolated; there's an argument for "local Ollama only works without sandbox".
- Settings file location: should the `llm` section live in the existing `settings.json`, or in a new `llm.json` to avoid bloating the main file?

## Non-goals

- Supporting OpenAI / other non-Anthropic-compatible backends. Out of scope; would need a different abstraction.
- Optimising local model performance. That's an Ollama / hardware concern, not a MulmoClaude one.
- A full provider-abstraction layer. We're piggy-backing on Claude Code's existing Anthropic-compatibility env vars deliberately.

## References

- Findings (Japanese): [`docs/tips/claude-code-ollama.md`](../docs/tips/claude-code-ollama.md)
- Findings (English): [`docs/tips/claude-code-ollama.en.md`](../docs/tips/claude-code-ollama.en.md)
- Setup skill (Claude Code only): [`.claude/skills/setup-ollama-local/SKILL.md`](../.claude/skills/setup-ollama-local/SKILL.md)
- Ollama Claude Code integration: https://docs.ollama.com/integrations/claude-code
