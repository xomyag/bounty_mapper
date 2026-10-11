# BM-009: preparation and play

The header contains a Preparation / Play switch with a visible active state and `aria-pressed`. New projects and old projects without a setting start in preparation. Each project's last mode is retained after a successful IndexedDB write. The initial screen remains the map with cards and navigation closed.

Switching preserves the map, selection, camera, search, filters, and grouping. An open saved card becomes a view. A changed card uses the shared dialog: Save and continue, Discard changes, or Continue editing. A failed card write blocks the transition and preserves draft text/images. A failed mode-setting write also retains the original mode and draft, even after choosing Discard. Retry is explicit. Repeated confirmations and commands are blocked while writing. Cancelling an unsaved new marker creates neither an Entity nor a MarkerPlacement.

## Play restrictions

Play supports pan, zoom, Fit entire map, the map-switching menu, search, shared centered navigation, hover, click, and tap. A normal object click does not center the camera. A result or link transition uses the destination map's current zoom and remembered viewport, without an intermediate fit.

Object creation/movement/deletion, vertices, color/fill, background changes, and map creation/renaming/deletion are blocked. Map-management buttons remain visible but unavailable with an explanation. Card editing and deletion are hidden. The drawing context menu does not open in play. Restrictions are checked both in session commands and in canvas/keyboard handlers. Entering play cancels unfinished contours, marker-type selection, vertex editing, and active object drags; unsaved geometry is not written. Returning to preparation re-enables editing.

A region card in view shows number/name, separate player-description and GM-notes sections, checks, tags, and computed linked markers. Rich JSON renders headings, lists, formatting, quotes, tables, safe links, and saved images. An empty region opens in view with a preparation hint. A marker card shows saved Entity/MarkerPlacement fields and links to every bound region. This is the GM's screen, including secret notes; there is no player screen here.

## Quick statuses and undo

The marker's Quick status change selector offers only statuses valid for its type. This action is also available in preparation without general editing. Status belongs to Entity: all its placements, icons, cards, related lists, and search results use the same saved data. Other independent enemy entities do not change.

`RegionRepository.saveStatus` writes only the Entity and the new Project revision in one `projects/entities` transaction, checking project ownership, type/status, expected previous status, and revision. While running, the interface shows Saving status and the previously confirmed value. Success follows `transaction.oncomplete`. An error, including a late Project write failure, rolls back both records: the previous status, an explanation, and Retry status change remain; undo history does not advance. Status changes neither move the camera nor recreate the canvas.

The separate status history holds up to 100 operations in memory for the open project, survives transitions between its maps and modes, and resets after reload/reopening. In play, Undo status / Redo status and Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl/Cmd+Y with map focus use only this history; they cannot undo preparation geometry. In preparation, map shortcuts still operate on geometry; the card has a separate status-undo action. Text fields retain normal text undo. Status undo changes only that value in the current Entity, preserving later description/name edits. Explicit status changes through general preparation editing remove that entity's previous commands from status history.

## Compatibility

At BM-009, IndexedDB remains **7**, Project.schemaVersion **1**, and ZIP **6**, with v1…5 reading. Entity.status already exists; no new business-document fields are introduced. `WorkspaceMode` is a `prepare | play` UI setting in existing `settings` under `workspaceMode:<projectId>`, without incrementing project revision. No upgrade is required: a missing key explicitly means preparation. Read failures and unknown values block geometry and offer retry rather than silently enabling editing.

Mode and undo history are excluded from ZIP. An imported independent copy starts in preparation; entity statuses, bindings, and images remain part of the consistent snapshot. Old single bindings still migrate to lists. There are no new dependencies.

Verification: `playMode.test.ts` covers confirmations, delayed/failed writes, command policy, status independence/undo, shared-data preservation, reload/ZIP, and mode settings. `play-mode.spec.ts` uses a real browser for cards/formatting/images, UI/canvas/context/keyboard restrictions, taps, search representations, navigation, errors, ZIP, and frame-by-frame viewport/canvas preservation. BM-005…008 regressions are retained.
