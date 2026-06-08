<template>
  <div ref="containerEl" class="marp-container">
    <div class="flex items-center justify-end gap-2 px-3 py-2 border-b border-gray-100 shrink-0">
      <span class="text-xs text-gray-500 mr-auto pl-2">{{ t("pluginMarkdown.marpSlidesMode", { count: slideCount }) }}</span>
      <button
        class="h-8 px-2.5 flex items-center gap-1 rounded bg-green-600 hover:bg-green-700 text-white text-sm disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        :disabled="pdfDownloading"
        @click="onExportPdf"
      >
        <span class="material-icons text-base">{{ pdfDownloading ? "hourglass_empty" : "download" }}</span>
        {{ t("pluginMarkdown.marpExportPdf") }}
      </button>
      <span v-if="pdfError" class="text-xs text-red-500" :title="pdfError">{{ t("pluginMarkdown.pdfFailedShort") }}</span>
    </div>
    <div v-if="renderError" class="load-error-banner" role="alert">
      {{ t("pluginMarkdown.marpRenderFailed", { error: renderError }) }}
    </div>
    <div class="marp-frame-wrapper">
      <div v-if="srcDoc" :style="{ height: frameHeight + 'px', overflow: 'hidden' }">
        <iframe
          :srcdoc="srcDoc"
          :style="{
            width: nativeIframeWidth + 'px',
            height: nativeContentHeight + 'px',
            transform: `scale(${slideScale})`,
            transformOrigin: 'top left',
          }"
          sandbox=""
          class="marp-frame"
          :title="t('pluginMarkdown.marpSlidesMode', { count: slideCount })"
        ></iframe>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { usePdfDownload } from "../../composables/usePdfDownload";
import { errorMessage } from "../../utils/errors";
import { rewriteMarkdownImageRefs } from "../../utils/image/rewriteMarkdownImageRefs";
import { applyCustomMarpSize } from "../../utils/markdown/marpCustomSize";

const { t } = useI18n();

const props = defineProps<{
  markdown: string;
  pdfFilename: string;
  baseDir?: string;
}>();

const DEFAULT_SLIDE_WIDTH = 1280;
const DEFAULT_SLIDE_HEIGHT = 720;
const SLIDE_GAP_PX = 16;
const BODY_PADDING_PX = 16;
const WRAPPER_PADDING_PX = 12;
const FALLBACK_WIDTH_PX = 800;
const MIN_SCALE = 0.05;

const containerEl = ref<HTMLElement | null>(null);
const containerWidth = ref(FALLBACK_WIDTH_PX);
const srcDoc = ref<string>("");
const slideCount = ref(0);
const slideWidth = ref(DEFAULT_SLIDE_WIDTH);
const slideHeight = ref(DEFAULT_SLIDE_HEIGHT);
const renderError = ref<string | null>(null);

const { pdfDownloading, pdfError, downloadPdf } = usePdfDownload();

const nativeIframeWidth = computed(() => slideWidth.value + BODY_PADDING_PX * 2);

const slideScale = computed(() => Math.max(MIN_SCALE, (containerWidth.value - WRAPPER_PADDING_PX * 2) / nativeIframeWidth.value));

const nativeContentHeight = computed(() => {
  if (slideCount.value === 0) return BODY_PADDING_PX * 2;
  return slideCount.value * slideHeight.value + Math.max(0, slideCount.value - 1) * SLIDE_GAP_PX + BODY_PADDING_PX * 2;
});

const frameHeight = computed(() => Math.ceil(nativeContentHeight.value * slideScale.value));

// Hard-locked CSP: defence-in-depth on top of `sandbox=""`. Even
// if the iframe boundary ever leaks (e.g. someone removes the empty
// sandbox attribute), the policy still blocks every network egress
// the slide could attempt — `connect-src 'none'` denies fetch /
// XHR / WebSocket / EventSource, and `frame-ancestors 'none'`
// prevents the iframe from being reframed by hostile content.
//
// `img-src` is pinned at runtime to the **parent app's origin** (plus
// `data:`). We can't use `'self'` here: `sandbox=""` srcdoc iframes
// have an opaque origin, and `'self'` resolves against that opaque
// origin (= matches nothing), which would block every workspace
// image including the legitimate `/artifacts/images/...` paths the
// rewriter produces. Pinning to `window.location.origin` lets the
// rewritten same-host URLs load while still denying every other host
// — a malicious deck can't craft `<img src="http://10.0.0.1/...">`
// SSRF probes or fetch external trackers. Style allows inline
// `<style>` blocks (Marp ships theme CSS inline). The `referrer`
// meta below keeps even the same-origin image fetches from leaking
// a referrer URL to the workspace file server.
function buildCsp(): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const imgSrc = origin ? `${origin} data:` : "data:";
  return `default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline' 'self'; font-src 'self' data:; connect-src 'none'; frame-ancestors 'none';`;
}

function buildSrcDoc(html: string, css: string): string {
  // Rendered with inlineSVG:false so Marp emits plain <section>
  // elements instead of SVG foreignObject wrappers. The theme CSS
  // sets each section to its native dimensions. The parent scales
  // the iframe down with transform:scale() — no SVG scaling means
  // no Safari bug.
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${buildCsp()}">
<meta name="referrer" content="no-referrer">
<style>
html,body { margin:0; padding:${BODY_PADDING_PX}px; background:transparent; overflow:hidden; }
${css}
div.marpit > section {
  display: block !important;
  margin: 0 auto ${SLIDE_GAP_PX}px !important;
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  border-radius: 6px;
}
/* Constrain inline images so they leave room for surrounding text.
   Sections have overflow:hidden and a plain markdown image is a
   block-level element in the normal flow, so an image clamped at
   max-height:100% would by itself fill the slide and push every
   surrounding heading / paragraph / list off the bottom. Cap at
   60cqh (60% of the section container-query height — Marp sets
   container-type:size on the section). Authors can opt out per-image
   via Marp directives. Twemoji glyphs have a data-marp-twemoji
   attribute and must NOT be scaled to fill the slide. */
div.marpit > section img:not([data-marp-twemoji]) {
  max-width: 100%;
  max-height: 60cqh;
  object-fit: contain;
}
</style></head><body>${html}</body></html>`;
}

function countSlides(html: string): number {
  const sectionMatches = html.match(/<section[\s>]/g);
  return sectionMatches ? sectionMatches.length : 0;
}

const SECTION_SIZE_RE = /div\.marpit\s*>\s*section\s*\{[^}]*?width:\s*(\d+)px[^}]*?height:\s*(\d+)px/;

function extractSlideDimensions(css: string): { width: number; height: number } {
  const match = css.match(SECTION_SIZE_RE);
  if (match) return { width: Number(match[1]), height: Number(match[2]) };
  return { width: DEFAULT_SLIDE_WIDTH, height: DEFAULT_SLIDE_HEIGHT };
}

async function renderMarp(markdown: string): Promise<void> {
  renderError.value = null;
  if (!markdown) {
    srcDoc.value = "";
    slideCount.value = 0;
    slideWidth.value = DEFAULT_SLIDE_WIDTH;
    slideHeight.value = DEFAULT_SLIDE_HEIGHT;
    return;
  }
  try {
    const { Marp } = await import("@marp-team/marp-core");
    // Disable twemoji conversion (default would rewrite Unicode emoji
    // to `<img src="https://twemoji.maxcdn.com/...">`, which our
    // sandboxed iframe's CSP blocks → broken-image icons in slides).
    // Fall back to the OS's native font emoji, matching how every
    // other surface in the app renders emoji.
    const marp = new Marp({ inlineSVG: false, html: false, emoji: { unicode: false, shortcode: false } });
    // Normalise `![alt](path)` refs BEFORE marp parses them — same
    // pre-pass the regular markdown renderer uses (wiki/View.vue,
    // FilesView.vue, markdown/View.vue). Without it, refs like
    // `../images/foo.png` resolve against `about:srcdoc` and 404.
    // Workspace-rooted refs route through `/artifacts/images` (static
    // mount) or `/api/files/raw` (authenticated route).
    const rewritten = rewriteMarkdownImageRefs(markdown, props.baseDir ?? "");
    const sized = applyCustomMarpSize(marp, rewritten);
    const { html, css } = marp.render(sized);
    slideCount.value = countSlides(html);
    const dims = extractSlideDimensions(css);
    slideWidth.value = dims.width;
    slideHeight.value = dims.height;
    srcDoc.value = buildSrcDoc(html, css);
  } catch (err) {
    renderError.value = errorMessage(err);
    srcDoc.value = "";
    slideCount.value = 0;
    slideWidth.value = DEFAULT_SLIDE_WIDTH;
    slideHeight.value = DEFAULT_SLIDE_HEIGHT;
  }
}

// Re-render whenever either the markdown OR the baseDir changes —
// `rewriteMarkdownImageRefs` resolves `../images/foo.png` against
// `baseDir`, so switching between two decks with the same body
// text but different file paths would otherwise reuse stale URLs
// (codex review). Pass `markdown` through verbatim; `renderMarp`
// already reads `props.baseDir` directly.
watch(
  () => [props.markdown, props.baseDir],
  ([source]) => {
    void renderMarp(source as string);
  },
  { immediate: true },
);

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  if (!containerEl.value) return;
  containerWidth.value = containerEl.value.clientWidth || FALLBACK_WIDTH_PX;
  resizeObserver = new ResizeObserver((entries) => {
    const [entry] = entries;
    if (entry) containerWidth.value = entry.contentRect.width || FALLBACK_WIDTH_PX;
  });
  resizeObserver.observe(containerEl.value);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});

async function onExportPdf(): Promise<void> {
  if (!props.markdown) return;
  await downloadPdf(props.markdown, props.pdfFilename, { marp: true, baseDir: props.baseDir });
}
</script>

<style scoped>
.marp-container {
  width: 100%;
  /* Content-height so the grey card ends with the last slide. Parent
     wrapper in View.vue / FileContentRenderer.vue is the centering
     context — it uses `m-auto` to put a short deck mid-canvas (white
     above + below) instead of pinning it to the top with all the
     empty space at the bottom. */
  display: flex;
  flex-direction: column;
  background: #f8fafc;
  border-radius: 6px;
}

.marp-frame-wrapper {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}

.marp-frame {
  border: none;
  background: transparent;
  display: block;
}

.load-error-banner {
  margin: 0.75rem 1rem;
  padding: 0.5rem 0.75rem;
  background: #fdecea;
  color: #b71c1c;
  border: 1px solid #f5c2c7;
  border-radius: 4px;
  font-size: 0.875rem;
}
</style>
