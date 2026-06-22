// Pub/sub publisher for collection record changes. Mirror of
// `server/accounting/eventPublisher.ts`: a module singleton wired once at
// startup that bridges the collection-plugin's host-agnostic
// `publishCollectionChange` to MulmoClaude's WebSocket pub/sub.
//
// The package's write path (`io.ts#writeItem`/`deleteItem`) calls
// `publishCollectionChange({ slug, ids, op })` after a successful write/delete,
// but the package can't reach the host's pubsub directly — so the host installs
// a publisher via `setCollectionChangePublisher`. This catches EVERY writer
// (agent `manageCollection`, UI routes, feed refresh, host-driven `spawn`)
// because all of them funnel through `writeItem`/`deleteItem`.
//
// Channel name + payload shape come from `src/config/pubsubChannels.ts` so the
// publisher can't drift from the View-side subscribers.

import { setCollectionChangePublisher, type CollectionChangePayload } from "@mulmoclaude/collection-plugin/server";
import { collectionChannel, type CollectionChannelPayload } from "../../src/config/pubsubChannels.js";
import { log } from "../system/logger/index.js";
import { errorMessage } from "../utils/errors.js";
import type { IPubSub } from "./pub-sub/index.js";

/** Wire the package's change publisher to `instance`. Call once at server
 *  startup, next to `initFileChangePublisher` / `initAccountingEventPublisher`. */
export function initCollectionChangePublisher(instance: IPubSub): void {
  setCollectionChangePublisher((payload: CollectionChangePayload) => {
    const channelPayload: CollectionChannelPayload = { slug: payload.slug, ids: payload.ids, op: payload.op };
    try {
      instance.publish(collectionChannel(payload.slug), channelPayload);
    } catch (err) {
      // Fire-and-forget, same rationale as the file-change / accounting
      // publishers: dropping one event (a missed live refresh) is better than
      // crashing the write path that triggered it.
      log.warn("collections", "collection-change publish failed; subscribers will miss this event", {
        slug: payload.slug,
        error: errorMessage(err),
      });
    }
  });
}

/** Detach the publisher (test teardown). */
export function _resetCollectionChangePublisherForTesting(): void {
  setCollectionChangePublisher(null);
}
