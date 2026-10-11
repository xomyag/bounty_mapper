# Current UI-03 format

**IndexedDB 9 / Project 2 / ZIP 8.** Project.context and Map.description are rich JSON with image.assetId. Upgrade 8 → 9 converts real contextMd/notesMd using the existing Markdown parser, preserves plain text/line breaks, never interprets HTML and leaves already migrated documents unchanged. All cursor updates share one upgrade transaction; failure preserves the previous database. Project creation, context/map Save and new assets are atomic. ProjectRepository also exposes remove: deleting all project-owned data and its workspaceMode/tagHistory uses one revision-checked transaction. Other projects and shared panel width are unaffected. Details: [UI-03](ui-project-map-context.md).

Region/marker cards pass only changed fields to RegionSession. `editDetails` and `editMarkerDetails` accept partial changes and merge with the session's current draft: a late visual-editor callback must not revert names, tags, the other text field or bindings using a stale React snapshot. Storage format is unchanged.

# UI-02 format history

**IndexedDB 8 / Project 1 / ZIP 7.** Migration 7 → 8 adds empty `Region.shortDescription` and `Entity.checks`, retaining all previous fields/references. Trap checks use RegionCheck with required positive integer DC; new fields save with card/revision. Validation/write failure rolls back the whole transaction. `settings["ui:cardWidth"]` is shared local width, not project/export data. See [UI-02 compatibility and checks](ui-cards-tooltips-traps.md#versions-and-migrations). Earlier format history follows.

# BM-002…010: local storage

BM-010 retained IndexedDB 7 / Project 1 / ZIP 6 and joined UI-01's main snapshot by user authorization. UI-01 temporarily disables Web Locks through `projectLocksEnabled`; both tabs may edit. Transactional revision checks and serialized writes remain mandatory: stale writes are rejected with drafts retained. Quota, permission and newer-database errors have explanations; Markdown migration validates output and rolls back the entire upgrade on failure. Data is never cleared. See [offline shell/limits](reliability-offline.md) and [UI-01 controls/geometry draft](ui-controls.md).

BM-008 left IndexedDB 7 / Project.schemaVersion 1 / ZIP 6 unchanged. Navigation reads one consistent maps/regions/entities/markerPlacements/settings snapshot without blobs. Map creation/renaming writes maps and shared project revision atomically; backgrounds change only on the selected map. Map deletion atomically removes its regions, placements and background, checking all remaining references before removing assets; entities remain. Failure rolls back the transaction. Filters, grouping and per-map cameras live in page memory, not Project/archive. Ordinary switching restores viewport; search centers over it without changing zoom. See [navigation-search.md](navigation-search.md).

Tag history uses existing `settings` key `tagHistory:<projectId>` (up to 512 unique tags, newest first). Only a successful card transaction updates it together with text, tags/assets and revision; failure also rolls history back. Old databases without the key return empty history and a stable existing-tag catalog. No new store/index or version-7 upgrade is needed. This UI metadata survives reload but is not in ZIP/Project: copies use their tags for initial suggestions and then their own history. Canonical spelling, trim and case-insensitive comparison apply during card editing/saving without bulk rewriting old data.

Initial format: `Project.schemaVersion = 1`, IndexedDB version 1, database `bounty-mapper`. There were no previous persisted schemas, so initial creation required no migration. Later structure changes require explicit versions/migrations. Unknown Project versions are rejected; newer databases are not opened as older ones.

`Project`, `Map`, `Asset`, `ImagePlacement` models are in `src/domain/project.ts`, independent of React/IndexedDB. `projects`, `maps`, `assets` use key `id`; the latter two index projectId. Initial UI metadata in settings contained only activeProjectId; BM-008 also stores per-project tag history. It is not part of Project.

`ProjectRepository` provides list, restore, open and save. Reads validate supported version and mandatory Project fields. Names must be nonempty and are trimmed on write. BM-002 context was ordinary Markdown text; UI-03 replaces it with one rich document and safe visual editor.

A new draft has revision 0. Creation/every save increments it. One readwrite save transaction checks previous revision, writes Project and active ID. Success returns only from transaction.oncomplete, not individual put success. Abort/error preserves previous snapshot and metadata. Browser connections close after each operation and on versionchange.

IndexedDB serializes concurrent writes; revision is checked in the same transaction. Stale tabs get an explicit error instead of last-write-wins. Their drafts remain in memory. There is no automatic merging; copy the text and explicitly reread the saved version. This was BM-002's minimum protection; extended tab coordination is isolated in BM-010.

`ProjectSession` separates draft/write state from the repository. Writes from one session do not run concurrently. Input changed while writing remains a draft for the next save; old completion never marks new text saved. Failure retains page-memory input and permits retry. Project switching with an unsaved draft is blocked/resolved explicitly. Historical BM-002 context autosave is replaced in UI-03 by common Save/Cancel with protected transitions.

Tests cover creation/read/edit/selection after reopening the repository, rollback on errors and abort after a successful put, revision conflicts, unavailable storage, failed creation, retained drafts, retry and edits during saving. React tests cover creation/autosave history/remount/open plus visible errors without lost text. Fake IndexedDB/jsdom do not replace real-browser manual acceptance, especially dialogs and focus.

## BM-007 changes

BM-007 IndexedDB version was **7**, Project.schemaVersion 1. Migration 5 → 6 adds entities (id key, projectId index) and markerPlacements (id key, mapId/entityId indexes). Migration 6 → 7 replaces single regionId with regionIds=[regionId] or [] and removes the old field. Other records, rich JSON, images, revision and active selection remain. Record validation failure rolls back the entire upgrade, including already updated rows. Older databases run preceding migrations and receive empty object collections. v5/v6 preservation is checked separately.

Entity stores type, name, shared rich description, status and tags. MarkerPlacement stores coordinates, mapId/entityId, regionIds[], color, locked and order. A region's objects are computed from its ID in regionIds. Writing validates legal statuses and references to map, every region, entity and assets of one project; duplicate binding IDs are forbidden. Objects, new images and revision save in one transaction together with regions. Even the final project put failure rolls everything back. Deleting a region removes only its binding, preserving others and placements/entities; undo restores links. Deleting a placement retains Entity. Background replacement/deletion retains Assets used by entity rich descriptions.

ZIP snapshot reads new collections with existing data in one readonly transaction. The whole copy import, including new IDs and every region-list reference, is atomic. ZIP was **6**; reading 1…4 adds empty object arrays, v5 migrates a single binding. A new entity draft and its movements live only in memory until Save, never in the snapshot. Unused saved entities/assets remain. Details: [markers.md](markers.md).

## BM-009 changes

IndexedDB **7**, Project.schemaVersion **1** and ZIP **6** remained unchanged. `WorkspaceMode` is UI metadata, `workspaceMode:<projectId>` in existing settings, values prepare | play. Missing keys mean Preparation; no upgrade is needed. The setting persists after transaction completion, separately from Project revision, and is not exported. Imported copies start in Preparation. Write failure retains the old mode/draft; read failure blocks geometry and offers retry.

Quick status changes/undo use a projects/entities transaction: check revision, entity ownership, previous status and permitted target status; write Entity and increment Project revision. Return only after oncomplete; a late Project failure rolls Entity back. Description, tags, images, regions and placements are not rewritten. The UI retains the old status until confirmation and offers retry on failure. ZIP snapshots include confirmed statuses. Status history is separate from geometry and lives only in current-project memory. See [play-mode.md](play-mode.md).

## BM-003 changes

IndexedDB increased to **2**. Migration 1 → 2 adds imagePlacements with a unique mapId index (one background per map); existing projects, selection and stores are not recreated. Project.schemaVersion remained 1 because Project structure was unchanged. ImagePlacement was introduced; a future archive format was not specified here.

`MapImageRepository` reads the first map by order/id and replaces/removes its background (later navigation targets the selected map). The first successful upload atomically creates Map, Asset and ImagePlacement. The original is a blob; signature/declaration MIME is checked, then actual decoding determines dimensions and SHA-256. SVG/PDF and mismatched types are rejected.

replace/remove check and increment Project revision in the same map-changing transaction, preserving BM-002 concurrency protection. Old asset deletion belongs to replacement's transaction: quota, abort or any failure retains previous background, metadata and revision. Removing the image retains the map; reupload reuses its ID. At BM-003, assets served only backgrounds; shared attachments were not implemented yet.

During file preparation/writing, `ProjectSession.mutateProject` blocks editing/project switching. Success gives the session current revision so the next context save does not conflict with its own upload. Failure keeps the previous image visible and retains the selected file in page memory for retry. Late reads for a previous project are ignored after switching.

ImagePlacement stores independent x/y, width/height and rotation. New backgrounds use (0,0) and original dimensions; replacement retains x/y and adopts the new raster's dimensions. Pan/zoom never change these properties. Map.coordinateBounds records the background rectangle on write; image removal retains the last bounds.

Konva Stage applies one x/y/scale camera to layers, with equal scaling on both axes. Pure screen↔world, zoomAt and fitBounds are in domain/viewport.ts. Camera is per-mapId memory UI state; first map opening, project switching and reload fit the background. BM-007 refinement prevents workspace resizing from resetting it: saving, statuses, field editing/clearing, card opening/closing and resize retain x/y/scale. BM-010 removes background from the camera key: replacement, removal and successful image retry retain the current map viewport. Show entire map explicitly fits, including after adding an image to an already open empty map. Object URLs are revoked after decoding; Stage is destroyed when closing the map.

Additional tests cover coordinates, blob round-trip, separate project maps, atomic replacement/removal, no orphan assets, real v1 migration, revision conflicts and file preparation failures. Playwright checks PNG/JPEG/WebP canvas pixels, aspect ratio, pan/pointer zoom, unchanged geometry, reload, project switching, corrupt files and forced write errors.

## BM-004 changes

IndexedDB stayed 2; Project/Map/Asset/ImagePlacement models remained unchanged. External ZIP format 1 was introduced independently of IndexedDB/Project.schemaVersion. See [format and limits](backup-format.md).

`ProjectBackupRepository.snapshot` reads Project, all its Map/Asset records and related ImagePlacements in one readonly transaction. It is structured consistent data, not canvas state. Before reading, ProjectSession.flush completes current text writing and, if necessary, writes later edits. Failed writing stops export and retains the draft. Current-session changes are blocked while generating the archive; other tabs can continue, but the read snapshot is immutable.

Import validates ZIP/JSON/images before creating new IDs in memory. Project receives a copy suffix, revision 1 and new timestamps. Map names/notes, geometry, metadata, tags/caption and original image bytes survive. References are remapped consistently. insertCopy uses add rather than put, so an ID collision cannot overwrite existing records. Project, maps, assets, placements and new activeProjectId are added in one readwrite transaction. Success follows oncomplete; any failure rolls back the entire copy and selection metadata. Localization changes only the newly added copy suffix, never existing user names.

Import writes no archived settings. Success opens the copy with closed UI panels. Resolve the current draft before importing; failure retains previous project, selection and image. For multiple imported maps sharing an asset, background replacement/deletion removes it only after the last reference, preserving the other map's image.

## BM-005 changes

IndexedDB **3**: migration 2→3 adds regions (id keyPath, mapId index) without changing projects/maps/images/selection. Direct v1 upgrade sequentially adds placements and regions. Project.schemaVersion remained 1. Regions persist separately, change shared Project revision and join consistent-snapshot/atomic-import transactions. Background removal/replacement never changes their coordinates.

ZIP became 2 with required regions; v1 explicitly converts to an empty list. Unknown versions are rejected. Draft outlines, camera, selection and undo history are not saved/exported. See [model, invariants, commands and limits](regions.md).

## BM-006 changes

BM-006 IndexedDB was **5**. Its earlier, unaccepted implementation used v4 gmNotesMd/playerDescriptionMd. Upgrade from v3/v4 creates rich JSON gmNotes/playerDescription, titleCustomized, checks and tags: missing fields become empty and old Markdown preserves supported formatting. Md fields are removed; geometry, properties and revision remain. Migration is one upgrade transaction; direct v1/v2 upgrade first adds placements/regions. Project.schemaVersion remained 1.

Document images use assetId and originals use the existing assets store. Save writes document, new assets and revision atomically in projects/maps/regions/assets; late failure leaves neither partial text nor new orphan assets. Cancel removes only the in-memory draft. Removing a node does not delete a saved shared Asset; unused assets are not automatically cleaned. Background removal/replacement checks image-placement and region-document references to preserve shared images.

ZIP became v4; reading v1/v2/v3 remained. Old archives migrate in memory before atomic import. Card drafts must be explicitly saved/canceled before export; they are neither included nor autosaved. Import remaps rich JSON image.assetId together with project/map/region/check/asset IDs. Failure leaves existing data/active project. See [region-details.md](region-details.md).

## Interface language

Language is separate browser-origin UI metadata in localStorage under `bounty-mapper:interface-language`, with stable values en/ru. Missing/invalid preferences default to English. Switching changes only labels and html.lang, retaining project data, cards/drafts, search and camera. Preference-write failure is visible and retryable without reverting the active language. This adds no store, Project field or archive field: **IndexedDB 9 / Project 2 / ZIP 8** remain unchanged. Language is not exported/imported; adventure text, tags, checks and persisted names are never translated. See [localization.md](localization.md).
