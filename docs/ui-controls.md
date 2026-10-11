# UI-01: compact controls

UI-01 was manually accepted. The user explicitly authorized committing and transferring the entire current snapshot, including BM-010, to main; an ordinary merge was used. The next branch was `bm-ui-02-cards-tooltips-traps`.

This describes accepted UI-01. UI-02 adds adjustable card width, compact formatting, and traps, updating versions to IndexedDB 8 / ZIP 7; geometry and camera protection remain. [UI-02 changes](ui-cards-tooltips-traps.md).

The header contains the project menu, name, “i” for the existing context editor, mode, search, and map selection on the right. The project menu opens projects, import, and export; production also offers checking/applying offline updates there. The map menu starts with New map, retains separate navigation/rename/delete actions, then image actions naming the target map. Deletion confirmations remain. Arrow keys/Home/End move menu focus; Esc closes it. All actions are available without hover.

Region creation and marker-type selection are at the top left; undo/redo at the bottom left; zoom−/zoom+/fit at the bottom right. These HTML groups overlay the workspace independently of the camera. On wide screens they reserve space for search and cards; on narrow screens panels sit between the upper and lower tool strips. Card size is unchanged in UI-01. Opening panels does not recreate the canvas. Buttons have icons, names, tooltips, and visible focus; their events do not reach the canvas. One dependency, `lucide-react` 1.55.0, supplies control icons. Marker-type icons retain their previous distinct appearances.

An existing contour moves only while its card is in general editing mode, without separately enabling geometry. Other regions, view mode, a closed card, and play allow panning from inside a region. Finishing a drag does not open a card. Vertices and contour creation retain their previous rules.

Moving an entire contour is part of the shared card draft: IndexedDB coordinates and linked markers do not change before Save. Cancel restores geometry together with text and color. Errors retain the draft and permit retry; object/map/mode changes or closing include geometry in the existing choice dialog. Each completed drag can be undone/redone within the draft; Save writes final geometry and fields in one transaction and adds the resulting movement to saved history. Geometry undo does not revert saved text. Text input retains normal text undo.

Play disables creation and map/background changes; camera, maps, search, and view remain available. Undo/redo concern only statuses. Zoom and position remain stable during editing, Save/Cancel, errors, and panel opening.

`projectLocksEnabled = false` in `src/application/features.ts` disables Web Locks integration with ProjectSession and the access-transfer banner. BrowserProjectAccess and its tests remain isolated for re-enabling with one setting. A second tab can edit, but this is not synchronization: an obsolete revision is rejected atomically and text remains in the draft. Writes within a tab remain sequential.

Versions **IndexedDB 7 / Project 1 / ZIP 6** do not change for UI-01. Region already has vertices; draft geometry/history live only in the UI session and do not enter an archive until a successful Save. No new format or migration is needed.

## Manual verification

1. Run `npm run dev`. Create a project through the hamburger menu; create a map or upload an image through its menu. Check context via “i”, import/export, renaming, and map/background deletion confirmations. Try keyboard and touch menus.
2. Create two regions and a linked marker. With the card closed, drag inside a region: the camera moves. Open a filled card in view and repeat. Choose Edit: now only that region moves; the marker stays put.
3. Move the region several times and check draft undo/redo. Cancel the card: original coordinates return. Repeat with text changes and Save; reload retains geometry/text. Reproduce a write failure using [reliability-offline.md](reliability-offline.md): the previous record remains and the draft is retryable.
4. After moving, close the card, choose another object/map or mode: test all three draft decisions. Save/Cancel/errors do not change zoom. In play, regions are fixed, pan from inside them works, and creation/background controls are disabled.
5. Open search and a card, then narrow the window: tools remain accessible. Check zoom−/zoom+/fit, fixed tool groups during pan, and no canvas objects created beneath clicked buttons. Search, filters, grouping, and navigation retain their behavior.
6. Open the project in a second tab: there is no lock banner and editing is available. After a first-tab write, the second tab's obsolete write reports a conflict and retains its draft. Reopening after an explicit discard reads current data.
