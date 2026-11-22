# UI-01: compact controls

UI-01 was manually accepted. The user explicitly authorized committing and transferring the entire current snapshot, including BM-010, to main; an ordinary merge was used. The next branch was `bm-ui-02-cards-tooltips-traps`.

This records accepted UI-01 controls with later movement changes noted below. UI-02 added adjustable card width, compact formatting and traps. The current Preparation selection iteration **supersedes UI-01's card-only region movement restriction**; [current interaction and checks](object-selection.md).

The header contains the project menu, name, “i” for the existing context editor, mode, search, and map selection on the right. The project menu opens projects, import, and export; production also offers checking/applying offline updates there. The map menu starts with New map, retains separate navigation/rename/delete actions, then image actions naming the target map. Deletion confirmations remain. Arrow keys/Home/End move menu focus; Esc closes it. All actions are available without hover.

Region creation and marker-type selection are at the top left; undo/redo at the bottom left; zoom−/zoom+/fit at the bottom right. These HTML groups overlay the workspace independently of the camera. On wide screens they reserve space for search and cards; on narrow screens panels sit between the upper and lower tool strips. Card size is unchanged in UI-01. Opening panels does not recreate the canvas. Buttons have icons, names, tooltips, and visible focus; their events do not reach the canvas. One dependency, `lucide-react` 1.55.0, supplies control icons. Marker-type icons retain their previous distinct appearances.

An existing contour now moves in Preparation with its card closed or in view. Left drag on empty canvas selects regions/markers; Shift adds/toggles. Dragging a selected object moves exactly the selected unlocked group. Space + left drag or the middle button pans; Play retains protected geometry and camera gestures. Finishing a drag/marquee does not open a card. Vertices and contour creation retain their previous rules.

Contour and mixed-group movement is now a separate saved-map command after dirty-card resolution. If a card is dirty, the attempted gesture is cancelled and the shared three-choice dialog protects it; start a new drag after Save/Discard. One completed drag writes atomically and is one undo/redo operation. Escape before release cancels without a write; failure restores the stored geometry and permits retry. Only explicitly selected markers move, once each; bindings do not add objects. Geometry undo does not revert saved text. Text input retains normal text undo.

Play disables creation and map/background changes; camera, maps, search, and view remain available. Undo/redo concern only statuses. Zoom and position remain stable during editing, Save/Cancel, errors, and panel opening.

`projectLocksEnabled = false` in `src/application/features.ts` disables Web Locks integration with ProjectSession and the access-transfer banner. BrowserProjectAccess and its tests remain isolated for re-enabling with one setting. A second tab can edit, but this is not synchronization: an obsolete revision is rejected atomically and text remains in the draft. Writes within a tab remain sequential.

UI-01 originally kept **IndexedDB 7 / Project 1 / ZIP 6**. The current selection iteration retains the later **IndexedDB 9 / Project 2 / ZIP 8**: temporary selection/preview/history never enter saved records. Existing vertices/placement coordinates are reused; no migration or dependency is added.

## Manual verification

1. Run `npm run dev`. Create a project through the hamburger menu; create a map or upload an image through its menu. Check context via “i”, import/export, renaming, and map/background deletion confirmations. Try keyboard and touch menus.
2. Create two regions and a linked marker. With cards closed, drag a region: it moves and the marker stays put. Use Space/middle drag to pan. Draw a frame and use Shift to build a mixed selection; only selected unlocked objects move together.
3. Check one undo/redo per ordinary/group drag and Escape before release. Edit card text, try a drag, and resolve the three-choice dialog before dragging again. Reproduce a write failure using [reliability-offline.md](reliability-offline.md): the whole group rolls back and Retry remains available.
4. After moving, close the card, choose another object/map or mode: test all three draft decisions. Save/Cancel/errors do not change zoom. In play, regions are fixed, pan from inside them works, and creation/background controls are disabled.
5. Open search and a card, then narrow the window: tools remain accessible. Check zoom−/zoom+/fit, fixed tool groups during pan, and no canvas objects created beneath clicked buttons. Search, filters, grouping, and navigation retain their behavior.
6. Open the project in a second tab: there is no lock banner and editing is available. After a first-tab write, the second tab's obsolete write reports a conflict and retains its draft. Reopening after an explicit discard reads current data.
