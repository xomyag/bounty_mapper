# Local list order and last open level

Implemented on `bm-list-order-last-map` and manually accepted. The user authorized committing this stage, an ordinary merge into main and production publication after passing checks. Deployment success must be confirmed separately. No new dependencies, sample adventures, backend or synchronization were added.

## Ordering

Each map/project row has its own labelled drag handle. Dragging the handle shows a gold insertion line and never opens the row or starts renaming. Row actions provide Move up / Move down, including native keyboard and touch access; unavailable boundary actions are disabled. New map remains the first service item outside the sortable map list. Map reordering is available only in Preparation; Play reads the saved order.

Map order uses the existing `Map.order`. A single revision-checked transaction reads fresh stored maps, changes only their order values and advances the stored project revision. It never writes cached map documents or an old project context. All indices are normalized together; a late error rolls back the complete operation. Lists remain in the previous confirmed order while saving, report progress and show an error on failure. Reordering does not navigate, adopt/recreate the map, resolve card drafts or change selection/camera. Card content remains editable after the transaction.

New maps append after the maximum existing order. Batch level imports retain selected source order and append to the end. Full project ZIP import/export preserves map order; a copied project's new IDs do not change it. Navigation results and map groups use the same map order, while the other grouping choices retain their own ordering.

Project order is a separate local ID list. On first use without a saved order, it preserves the previous updatedAt/getAll sequence. That sequence is then fixed; editing a project's timestamp does not resort it. New projects and full-project imports append atomically with their creation. Deletion removes only the deleted ID and preserves the remaining order. Concurrent membership changes reject a stale reorder instead of dropping a project/map from the list.

## Why the first level used to open

The previous project-open effect called `MapImageSession.load(projectId)` without a map ID. `IndexedDbMapImageRepository.loadMap` therefore deliberately picked the first map by order. There was no per-project remembered selection, and `ViewportMemory` was page-memory only. Reloading/reopening consequently repeated the first-map fallback and a new fit.

Loading now reads local workspace metadata before requesting an image/map. It resolves a valid saved ID, or the first available map in user order, and hydrates its saved camera before exposing the map to the canvas. The selected background is decoded before adoption. No intermediate first map is displayed. Empty projects use the existing empty state.

The shared map/card/search navigation prepares the destination before adopting it. Only after that map and its objects have loaded successfully does the app confirm its ID. This also handles new maps, successful batch imports and replacement selection after deletion. Cancelled draft decisions and failed reads/decoding never change the saved ID. Ordinary data saves, reorder, mode/language changes and rerenders do not call a new project load or remember a first-map fallback. Selection writes are serialized and deduplicated so a slow earlier write cannot overwrite a later transition. A failed settings write leaves the last confirmed preference, reports an error and offers explicit Retry without losing the displayed data.

Cameras remain outside adventure data. Render changes coalesce into queued local settings transactions; errors are visible and retry retains the newest in-memory view. Switching between maps/projects retains their independent cameras. A page reload restores the last successfully written view. Explicit Show entire map still fits; explicit object navigation centers over the target map's restored scale. Deletion removes the deleted map's camera/pending write without affecting other maps.

## Storage and compatibility decision

**IndexedDB 9 / Project 2 / ZIP 8 remain unchanged.** This iteration adds optional version-1 UI metadata keys to the existing settings store, without altering project/asset records or adding stores:

- `projectOrder`: ordered project IDs, lazily seeded from the legacy listing; removed IDs are pruned and missing current projects append predictably.
- `mapWorkspace:<projectId>`: `{ mapId?, cameras: { [mapId]: { x, y, scale } } }`. Missing/invalid selections fall back in user order; missing/invalid cameras use the existing fit. Only finite cameras with positive scale are read.

No database upgrade is required for these additive settings. Existing records remain intact. An incompatible future preferences shape must use a new versioned key or explicit migration. Deleting a project removes its workspace key together with mode/tag preferences and its ID in projectOrder, in the same transaction. Deleting a map removes its camera and matching saved selection. Neither key is exported; imported adventures start with their first ordered map until a local transition is remembered. Map order already belongs to the archive format.

## Verification and manual scenario

Unit coverage includes before/after ordering, legacy project-order seeding, stable order after edits, new/imported project append, deletion, stale membership rejection, late-write rollback, fresh map documents, ZIP order and batch append. Workspace checks cover independent projects, camera restoration before map exposure, no first-map write on load/failure, cancelled/failed/successful shared transitions, missing/deleted targets, cleanup and camera retry.

EN/RU browser scenarios use real handle drags with a visible insertion line, keyboard row actions, a dirty card during map reorder, failed storage/retry, no navigation on reorder, independent projects, saved cameras after reload and ZIP copies. A mutation observer checks that reload exposes only the remembered map ID.

Pre-acceptance verification: **214 unit tests passed**, typecheck and lint passed, root and `/bounty_mapper/` production builds passed. The complete Chromium preview suite passed **51 scenarios** (the Pages-only scenario was skipped there and passed separately in Edge). Both EN/RU ordering scenarios were also repeated in Edge after clarifying the dirty-card availability hint. Real mouse drags, keyboard actions, Game restrictions, order failures/retry and camera restoration were exercised; 375 px layouts and the gold insertion line were visually inspected. Earlier marker/search fixtures now select their intended start map explicitly and calculate reload clicks from the restored camera instead of assuming a first-map fit. No commit, merge, push or publication was performed before manual acceptance.

1. Run `npm run dev`. Create three levels and open the second. Zoom/pan and leave a card draft. Drag a level by its handle; inspect the insertion line. Open its row actions and use Move up/down by keyboard and touch. The service item stays first, the active level/view/draft stay intact. Save/cancel the draft normally.
2. Try a draft-protected map transition and choose Continue editing: reload must still restore the old level. Then complete the transition; reload restores that level and view directly. Repeat a transition from project-wide search or a linked object, and verify centering/scale. Switch mode/language, save a card and reorder again without changing the selected level.
3. Create another project and set a different last level/view. Reorder projects by handle and row actions without opening one. Reload, reopen both projects and verify independent selections/views. New/imported projects append; deleting one preserves the rest.
4. Export/import a project with a custom level order; verify that order in the header/search. Import several levels into it: they append in source order. Delete an inactive level (no view change), then the active/last level and finally all levels; verify the next ordered level or empty state, including after reload. Repeat in Play: map ordering is unavailable, navigation still works.
5. Simulate a write failure. Reordering retains the confirmed order and reports the failure. Restore storage and retry. Camera/selection preference failures also show Retry; they never alter adventure content. No real user storage needs to be cleared for these checks.

Known limits: these preferences are local to the browser origin/profile and are not transferred by ZIP. Card drafts, temporary selection and undo history remain page-memory only. The existing Vite large-chunk warning is unchanged.
