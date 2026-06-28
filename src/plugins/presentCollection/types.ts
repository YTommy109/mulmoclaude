// presentCollection's render/arg types now live in the shared
// @mulmoclaude/core/collection package. Re-exported here so existing relative
// imports (View.vue, Preview.vue, index.ts) keep working unchanged.
export type { PresentCollectionData, PresentCollectionArgs } from "@mulmoclaude/core/collection";
