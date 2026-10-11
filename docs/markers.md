# BM-007: markers and entities

BM-007 and its refinements passed manual acceptance on October 11, 2026. Accepted behavior: data changes, writes, object movement and clearing fields preserve the viewport without an intermediate fit; a new marker can move before its first save; multiple bindings, both context-menu levels and card navigation work together. Explicit navigation centers the object without changing scale. A legacy single binding migrates to `regionIds[]`; deleting a region removes only its ID, preserves other bindings, and undo restores the removed link.

Adding a marker starts with a type and a map position. This creates only an in-memory draft: the entity, placement and new images are written in one transaction on Save. Cancel leaves no empty IndexedDB records. A saved marker opens in view mode; all fields share one draft with Save / Cancel. Markers and regions use the same panel, unsaved-changes dialog and BM-006 visual editor. On failure, text, properties and prepared images remain in the draft.

The draft can move before its first save without losing field edits. Moving changes only its in-memory position; the first write saves the final point. Moving is unavailable while writing, preparing an image or when position locking is enabled. Right-click opens two rows: Add region and Add marker, whose submenu lists every type, including the UI-02 trap. Hover, click or ArrowRight opens the submenu; choosing a type creates a draft at the right-click position. Escape or clicking outside closes it; ArrowLeft returns to the first level.

## Model

`src/domain/marker.ts` is independent of React, Konva and IndexedDB.

- `Entity`: id, projectId, kind, name, description, status, tags, checks. Description is BM-006 safe rich JSON with image.assetId; status and shared description belong only to the entity.
- `MarkerPlacement`: id, entityId, mapId, x, y, regionIds[], color, locked, order. Coordinates use map space; color is hex RGB; an empty regionIds list means no bindings. IDs are unique and all bound regions belong to the placement's map. Order determines display order.

Two new enemies always have different entityId values and independent state. Shared templates, a library and creating multiple representations of an entity are outside this stage. Deleting a marker deletes its placement and retains Entity, its description and assets. Unused entities are retained and exported; their library UI is a later stage.

Limits: 4096 entities per project and 4096 placements per map; ZIP additionally limits the project to 4096 placements in total. Coordinates must be finite, with absolute values at most 1e9. Names must be nonempty and at most 512 characters. Tags must be unique, with at most 256 nonempty strings of at most 120 characters. Rich JSON and image limits match the [region card](region-details.md).

UI-02 adds Trap (`trap`): `armed` / Armed (!), `disarmed` / Disarmed (✓). Its checks belong to Entity; other types have empty check lists. Multiple bindings and existing operations apply to the new type. See [fields and migrations](ui-cards-tooltips-traps.md).

## Types, statuses and display

| Type (kind) | Statuses (stored values) | Icon |
| --- | --- | --- |
| Enemy (enemy) | Alive (alive), hidden (hidden), defeated (defeated) | Crossed swords |
| Boss (boss) | Alive (alive), hidden (hidden), defeated (defeated) | Crown |
| Door (door) | Open (open), locked (locked), hidden (hidden) | Door |
| Passage (passage) | Available (available), blocked (blocked), hidden (hidden) | Arrow |
| Reward (reward) | Available (available), concealed (concealed), collected (collected) | Gem |
| Hero (hero) | Present (present), hidden (hidden), gone (gone) | Shield |
| Ally (ally) | Present (present), hidden (hidden), gone (gone) | Heart with a plus |
| NPC (npc) | Present (present), hidden (hidden), gone (gone) | Person |

Vector icon paths are used in menus and Konva. The main circle is 40 screen pixels; its group uses the inverse camera scale while x/y remain map coordinates. Status also has a symbol: !, ○, ▣, +, ✓ or →. Color is user-selected; hidden markers remain visible to the GM. Hover shows the name and status text. On touchscreens, tapping opens the card. Markers sit above regions and stop the event that would open the object beneath them.

## Bindings, movement and history

RegionIds are chosen explicitly with checkboxes for regions of the current map; select several or choose No binding. Placement inside a region, crossing a boundary or overlapping regions never chooses a binding automatically. Each region's related-marker list is computed from the presence of its ID in MarkerPlacement.regionIds, not stored as a second copy. The marker card has a reverse Related regions list in both view and edit mode; drafts use their selected bindings.

Following either link opens the card in the single panel and centers the map on the selected element while retaining scale. A region centers on its label anchor, a marker on its placement coordinates. With unsaved text, navigation and centering wait for the shared dialog: Continue editing and write failure leave the view unchanged; Discard changes or successful Save and continue navigate. Centering happens once; subsequent pan, resize, write and closing the card do not repeat it. A normal map click/tap opens the card without moving the view. This is temporary UI state; the BM-007 IndexedDB 7 / ZIP 6 formats did not change for navigation.

Dragging a saved, unlocked marker changes only its coordinates and creates one undo operation. It does not open the card. Locked prevents movement while preserving card access; attempting to drag a locked marker does not pan the camera. Camera scale and x/y remain stable during save, field edits/clearing, ordinary card opening, closing and workspace resizing. Explicit link navigation centers while preserving scale. Originally fit applied to a new map/background, reload or Show entire map; BM-010 further preserves the camera when replacing/removing an existing background. Status and viewport size are not camera keys.

Regions and placements share the current map's geometry history, capped at 100 operations. Creating a saved marker, moving and deleting it support undo/redo. Deleting a region and removing only its binding ID are atomic; other bindings remain and undo restores the removed one. Text/status changes are not reverted by geometry history; the editor's Ctrl+Z handles text. Later explicit color, lock and binding additions/removals are respected by geometry undo without erasing links hidden by deletion. History is neither persisted across reload nor exported.

## Storage and archive

IndexedDB **6** added `entities` (projectId index) and `markerPlacements` (mapId/entityId indexes). BM-007 **7** migrates single regionId to regionIds=[regionId] or [], removing the old field while retaining records, descriptions, images, revision and project selection. Migration failure aborts the entire upgrade. Projects without markers receive empty collections. Project.schemaVersion remained 1. Saving checks revision, IDs, legal statuses, project ownership of entities/images and that every bound region is on the same map. Project, regions, entities, placements and new assets are written in one transaction. Success appears only after oncomplete; failure retains previous records and revision.

BM-007 ZIP **6** includes entities and markerPlacements with required regionIds. Import accepts v1…4 with empty object collections and v5 by migrating the single binding without loss. Copies receive new project, map, asset, region, entity and placement IDs; entityId/mapId, every regionId and rich JSON image reference are remapped consistently. Entities without placements are included. Unknown statuses, duplicate bindings and broken references are rejected before writing. Limits and atomicity: [backup-format.md](backup-format.md). Later stages' current formats are documented there.

Tests cover independent enemies, every type, draft movement/cancellation, several explicit bindings, locking, shared undo, region deletion, status changes after deletion and restored bindings, failed writes with an image, real v6 database / v5 ZIP migration, migration rollback, reload and ZIP copies. Browser tests check constant icon size, pan/zoom coordinates, frame-by-frame camera stability during saving/field clearing/resize, both context-menu levels, absence of accidental card opening, a single panel and touch. Manual acceptance steps are in [README](../README.md).
