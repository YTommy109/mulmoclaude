// Plugin-local i18n. Translation tables travel with the plugin
// bundle; the host's vue-i18n is not touched. The plugin reads the
// host's locale via `useRuntime().locale` and looks up its own
// table reactively. Same pattern as bookmarks-plugin.
//
// {error}, {done}, {total} are interpolation placeholders. The
// `format(template, params)` helper does the substitution at the
// call site so plugin code reads as `t.value.apiError({error: msg})`.

import { computed } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import en from "./en";
import ja from "./ja";
import zh from "./zh";
import ko from "./ko";
import es from "./es";
import ptBR from "./pt-BR";
import fr from "./fr";
import de from "./de";

const MESSAGES = { en, ja, zh, ko, es, "pt-BR": ptBR, fr, de } as const;
type LocaleKey = keyof typeof MESSAGES;

function isSupportedLocale(value: string): value is LocaleKey {
  return value in MESSAGES;
}

export function useT() {
  const { locale } = useRuntime();
  return computed(() => (isSupportedLocale(locale.value) ? MESSAGES[locale.value] : MESSAGES.en));
}

/** Tiny `{name}` placeholder substitution — the plugin's locale
 *  strings use the same syntax as vue-i18n templates so the keys
 *  carry over from the host's i18n verbatim. */
export function format(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
}
