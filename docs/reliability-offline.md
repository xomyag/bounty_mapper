# BM-010: reliability and offline startup

The BM-010 snapshot was merged into main with UI-01 by explicit user authorization after project checks. UI-01 passed manual acceptance. No server or synchronization was added; tab coordination is temporarily disabled while revision checking remains.

UI-02 updated versions to IndexedDB 8 / ZIP 7 with atomic entity-check/summary migration. Transaction guarantees, legacy archive support and the offline shell below remain. See [UI-02 format](ui-cards-tooltips-traps.md#versions-and-migrations) and [current UI-03 format](ui-project-map-context.md#storage-and-compatibility).

## Saving and recovery

All repositories confirm success after `transaction.oncomplete`. A final successful put does not establish a successful transaction: a late failure rolls back project, entity/placement, documents/images and related metadata together. Context writes are serialized and retain later input as a draft; shared revision is checked inside every data-changing transaction. A stale save is rejected instead of overwriting a fresh snapshot.

Failures retain text and inserted images in the page's in-memory draft, keep its card open and allow Save retry. Geometry, images and statuses show the last confirmed result and a retryable error. Quota, permission denial, transaction abort and a newer local database have explanatory errors. Failed/retried writes preserve canvas/viewport. Fit after successful background replacement retry was also fixed: the camera belongs to the map, not assetId. Replacement/removal retains the view; Show entire map fits it explicitly. Forced reload, tab close or browser termination can still lose an unsaved draft; drafts are not autosaved to disk.

## Versions and migrations

BM-010 retained **IndexedDB 7 / Project.schemaVersion 1 / ZIP 6**: no new store or project structure was required. Real upgrade history: 1 — projects/maps/assets/settings; 2 — imagePlacements; 3 — regions; 4 — card Markdown fields without a new store; 5 — rich JSON; 6 — entities/markerPlacements; 7 — regionId → regionIds[]. Migrations apply sequentially by oldVersion within one upgrade transaction. Later UI-02/03 formats are linked above.

Markdown v4 uses the existing parser to preserve headings, lists, emphasis, links, quotes and tables; tags, checks, maps, blobs and geometry remain. Old Markdown external-image links stay textual, as accepted in BM-006, rather than becoming downloaded attachments. Rich JSON v5/v6 already references images through Asset and is not reconverted. Single/absent regionId v6 becomes a list/empty list without changing text, status or coordinates. Migrated card results are also validated before writing; failure rolls back prior cursor changes and store creation. Failed migration/unknown version never clears the database.

ZIP 6 continued to read real formats 1…5. A consistent readonly snapshot includes the latest saved data for every map, region, document, original image, entity, placement, status and regionId. Copies receive new project/map/region/check/entity/placement/asset IDs, including assetId inside documents. Import validates the whole archive before writing the copy and active ID in one transaction. Settings (mode, suggestion history) and cameras are excluded; object tags are included. [ZIP limits and validation](backup-format.md) remain without weakening.

## Tab coordination — temporarily disabled by UI-01

The current app does not connect BrowserProjectAccess: `projectLocksEnabled = false`. Its banner and ownership transfer are hidden; both tabs can edit. There is neither synchronization nor collaborative editing; atomic revision checks still reject stale writes and retain failed drafts. The following describes the isolated mechanism when the setting is restored to true.

On supported browsers, the owner holds exclusive Web Lock `bounty-mapper:editor:<projectId>` until project switching, release or tab close. Another tab gets view mode with an explanation and Request editing access. Sessions/handlers enforce restrictions, including context menus, keys, drag and statuses, not just buttons. Search, map switching, hover, cards, camera and export remain available. Another project can be edited independently.

Release editing is unavailable during unfinished writes/drafts/tools. Owner close or crash releases the browser lock. Acquisition rereads current Project, maps, objects and images before allowing editing; the old card closes and the existing map viewport remains. Viewing tabs do not synchronize automatically: reopen the project or request ownership for a fresh snapshot. Without Web Locks, the UI explains transactional-revision fallback: conflict drafts remain and there is no silent overwrite.

## Production shell

Vite build creates `dist/sw.js` with a hashed version and all output resources, including lazy canvas/editor chunks. Service Worker works on HTTPS or localhost; first opening requires network and successful caching. Ready to work offline appears only after the entire shell is confirmed present. Failed loading/caching shows an error and retry; incomplete new cache is removed while the previous working version and IndexedDB remain unchanged.

The shell and local system fonts require no CDN. Maps/attachments load from IndexedDB, not network-response cache. Once ready, offline reload works on the same origin/profile, including an unopened visual editor. The dev server installs no Service Worker. Clearing browser data, storage eviction or private profiles can remove data/cache: download ZIPs regularly.

A new app installs into waiting state. Check for updates checks availability; Apply update requires finished writes, saved/canceled changes and completed tools. Reload happens only through that action, rechecking drafts on controller change. An update in another tab never reloads an editing page; old chunks are retained while several tabs are open. The next activation with one tab cleans previous shell caches. Applying an update is an ordinary reload with closed panels and an initial map view, not viewport persistence through reload.

## Testing a write failure

On a test project, run this in DevTools Console:

```js
window.bmOriginalPut = IDBObjectStore.prototype.put;
IDBObjectStore.prototype.put = function (...args) {
  if (this.name === 'projects') {
    throw new DOMException('Test storage quota exceeded', 'QuotaExceededError');
  }
  return window.bmOriginalPut.apply(this, args);
};
```

Edit the open card's name/text and Save: the draft/camera must remain with a quota explanation. Restore writing and retry Save:

```js
IDBObjectStore.prototype.put = window.bmOriginalPut;
delete window.bmOriginalPut;
```

The substitution affects only this page. Do not reload with an unsaved draft for this test.

## Automated checks

Existing atomicity, delayed-save, card/image/status failure, coordinate and viewport checks remain. Added coverage: full round-trip of all documents/images/multiple bindings; all-store rollback at import's last write; current text after retry and a late obsolete save; real Markdown migration with tags/checks/blobs; invalid-outline rollback and newer database without clearing; lock/release/reacquire/fallback; incomplete cache, old chunks and update protection.

After build, `PLAYWRIGHT_PREVIEW=1 npm run test:e2e` checks the complete browser suite (PowerShell environment syntax is in README). Production scenarios disable real-browser network, reload the shell, read images/editor, save/export; check forced owner-tab close and rereading before reacquisition; replace the worker on an isolated local test origin and verify explicit update application. Tab close is automated; a separate browser-process crash is not simulated. Injected quota refusal checks error handling rather than filling the actual disk. Browser coverage is Chromium/Edge only.

Primary technical sources: [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API), [Service Worker install](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/install_event), [skipWaiting](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting).
