# Bounty Mapper

A tabletop RPG game master's workspace. Product requirements and task order: [docs/product-design.md](docs/product-design.md).

Implemented **BM-001…009**: React + TypeScript + Vite, local IndexedDB projects, Konva/react-konva maps, ZIP backups, polygon regions, markers with a single card panel and searchable navigation. Use Projects to create/open an adventure, Adventure context to view/edit its name and formatted notes, Map description for independent floor notes, and Upload map for PNG/JPEG/WebP. Add region starts an outline. Add marker offers a type/position; its card remains a draft until Save. Click/tap opens cards; hover shows region summary/tags or marker name/type/status/tags. The right-header menu shows the current map: New map creates, separate row actions navigate/rename/delete with confirmation. Navigation and search provides compact search and expandable filters. Tag suggestions are project-wide. Export project includes every map/object/original image; Import project creates an independent copy. Reload restores the selected project and opens its first map with navigation/cards closed.

**BM-009 manually accepted and merged into main.** Preparation / Play in the header restores the project mode after reload. Play protects geometry while retaining maps/search and saved formatted/image cards. Marker view supports immediate status changes and separate status undo. Draft transitions require save/discard/continue without camera/search resets. [Behavior/compatibility](docs/play-mode.md).

**BM-010 joined the full main snapshot by explicit user authorization with accepted UI-01.** Reliability, offline startup and failure retries remain; Web Locks are temporarily disabled while revision checks stay active. [BM-010 limitations](docs/reliability-offline.md).

**UI-01 manually accepted and normally merged into main.** Header: burger, project with context information button, mode, search, map menu. Projects/import/export/offline updates are in the burger; background actions in the map menu. Creation, undo/redo and camera have separate overlay groups. Whole regions move only while their cards are editing; movement joins Save/Cancel and does not move markers. lucide-react 1.55.0 provides consistent control icons. [Behavior/versions/manual steps](docs/ui-controls.md).

**UI-02 accepted, committed (`1ad2792`), normally merged (`cd91543`).** Shared resizable card width, compact formatting, region summary, shared hover tag badges and Trap checks/game statuses. No new dependencies. UI-02 versions: **IndexedDB 8 / Project 1 / ZIP 7** with lossless text/image migration. [Behavior/compatibility/manual steps](docs/ui-cards-tooltips-traps.md).

**UI-03 and fixes manually accepted.** Adventure context and independent map descriptions use the same visual editor/right panel/Save-Cancel draft. Creation with text/images is atomic; cancel leaves no project. Project-list menus support confirmed deletion with rollback. Current versions: **IndexedDB 9 / Project 2 / ZIP 8**, retaining legacy compatibility. [Behavior/migration](docs/ui-project-map-context.md).

**Localization and the empty-map upload state were manually accepted on October 12, 2026; the user authorized merging and production publication.** English is default without a saved preference; English / Русский in the burger switches immediately and restores after reload. Labels, types/statuses, editor, confirmations/errors and offline UI are localized. User names/context/descriptions/tags/checks/imported text are unchanged. Language stays outside Project/ZIP. For a selected map without a background, Preparation shows Add a map image, supported formats and the central Add map image button; it uses the existing upload path without obscuring object interactions. Play shows a message without upload. [Implementation and manual checks](docs/localization.md).

## Requirements

- Node.js 24 LTS and npm. Tested with Node.js 24.21.0 / npm 11.19.0.
- A modern Chrome, Edge or Firefox browser.
- npm registry access to install dependencies.

## GitHub Pages

Repository: [xomyag/bounty_mapper](https://github.com/xomyag/bounty_mapper). Site: [Bounty Mapper](https://xomyag.github.io/bounty_mapper/). A successful **Publish GitHub Pages** workflow and a working site confirm deployment; a link alone does not establish a completed deployment. Accepted localization updates use the same publication workflow.

Settings → Pages → Source → GitHub Actions. `.github/workflows/pages.yml` runs on main pushes or manually through Actions → Publish GitHub Pages → Run workflow. It uses Node.js 24, npm ci, unit tests, typecheck, lint, production build and browser checks. After root-path checks it rebuilds with configure-pages' base, verifies resources/offline reload under that path and publishes only dist/. User adventures/images never enter the build.

Updates: work in a separate branch, run checks, complete the agreed merge to main, then git push origin main and wait for a successful workflow. No force push. Existing offline installations apply through Check for updates / Apply update after resolving drafts; editing never causes automatic page reset.

Adventures/original images remain in your browser's IndexedDB. GitHub hosts source/app shell, with no server storage, accounts or synchronization. Moving from localhost to Pages changes origin and does not transfer data: export each needed project locally to ZIP, then import on the site. Use the same process between browser profiles. Paths on one origin do not isolate IndexedDB; offline cache/worker are scoped to the app path. Language preference is local to origin/profile and is not transferred by backups.

Ordinary npm run dev keeps the root path. Check Pages build locally in PowerShell:

```powershell
$env:BM_BASE_PATH = '/bounty_mapper/'
npm run build
Remove-Item Env:BM_BASE_PATH
$env:BM_PAGES_TEST_BASE = '/bounty_mapper/'
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm run test:e2e -- pages-hosting
Remove-Item Env:BM_PAGES_TEST_BASE
```

To return to ordinary preview, rebuild without BM_BASE_PATH. No router/web app manifest; open the subdirectory root URL. Vite rewrites JS/CSS paths, offline resources use the same base, and sw.js registers within that scope. Based on [official Vite instructions](https://vite.dev/guide/static-deploy.html#github-pages) and [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

Favicon is a simplified folded map: gold #dfb577 on dark #171c21. Local public/favicon.svg and 32×32 PNG fallback use Vite BASE_URL at root/Pages and join the existing offline cache. pages-hosting loads/decodes both online and after offline reload. Manually open dev/preview: tab icon visible, favicon.svg/png return 200 in Network. Browsers may cache old icons until reopening the tab.

## Startup

From the project root:

```sh
npm ci
npm run dev
```

Open <http://127.0.0.1:5173>. The server binds locally; an occupied port fails rather than changing the address. Stop with Ctrl+C.

## Checks

```sh
npm run typecheck
npm run lint
npm run build
npm test
npm run test:e2e
```

typecheck covers app/tests/config; lint treats warnings as errors; build checks types and outputs dist/. Vitest uses fake-indexeddb for repositories and Testing Library/jsdom for UI; these are development-only dependencies.

Playwright uses a real browser for rendering, PNG/JPEG/WebP, pan/zoom, regions/vertices, undo/redo, reload, ZIP round-trip, tab conflicts/write failures and both interface languages. Existing Russian regression fixtures explicitly select Russian; localization scenarios check English defaults and both dictionaries. Before first run:

```sh
npx playwright install chromium
```

Windows can use installed Edge without downloading Chromium:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm run test:e2e
```

Playwright starts the local dev server or reuses the project server at 5173. Isolated temporary profiles do not change your projects. Reports/results are Git-ignored. Check the production build after npm run build:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
$env:PLAYWRIGHT_PREVIEW = '1'
npm run test:e2e
Remove-Item Env:PLAYWRIGHT_PREVIEW
```

This starts preview at 4173. reliability-offline checks dist/ on isolated local origins: browser network is disabled, cached/IndexedDB editor/images open, saves/exports work, disabled tab locks and revision-conflict drafts are checked, and real worker updates are tested. These four checks are skipped in dev: changed code first needs a fresh build. Restart your dev server after dependency changes if Vite reports Outdated Optimize Dep.

```sh
npm run preview
```

Open <http://127.0.0.1:4173>. This is local preview, not a publication server.

## Manual acceptance BM-002

1. Open the app: compact Bounty Mapper header above an empty map workspace.
2. Projects → name → Create opens context draft; it is not stored until Save.
3. Edit name/context in the visual editor and Save. Changed → Saving → Saved on this device.
4. Close/reload/open Adventure context: name/text retained, navigation/cards never open themselves.
5. Create another project; reopen the first and inspect context. Reload restores the explicitly selected project.
6. Open the same project in another tab. UI-01 temporarily disables locks; after the first saves, the other's stale write fails with text retained. Cancel explicitly/reopen for fresh data; no synchronization.
7. At 375 px check Tab/Enter, Escape and browser console errors.

Quota, write refusal and transaction abort are automated. Failed drafts remain in open-page memory, not disk; switching projects requires save/discard/continue. Reload with unsaved data invokes the browser warning.

## Local storage

Data belongs to app origin/browser profile. 127.0.0.1, localhost, ports/protocols have separate databases. Clearing browser data removes projects/offline cache. ZIP moves projects between profiles/addresses. Development uses 5173, production offline preview 4173; transfer needed data by ZIP.

Offline startup is production-only. First opening requires network, HTTPS/localhost (including 127.0.0.1) and Service Worker support. Wait for Ready to work offline, then reload on the same origin/profile without network; canvas, editor, maps and inserted images remain local. Dev installs no worker. An installed preview shell can reopen even after stopping its Node server/disabling network. Cache is no ZIP substitute: browsers can evict it/data, especially in private profiles or low storage.

Check for updates checks a new shell. Apply update appears when available and is blocked by dirty cards/context, active tools or writing. Editing never auto-reloads. Applying reloads normally: data/mode survive, panels close and cameras start with their ordinary initial view. Until explicit application, writes/errors retain viewport.

Current versions: IndexedDB 9 / Project.schemaVersion 2 / ZIP 8. Upgrade 8→9 converts Markdown context into Project.context and Map.notesMd into independent Map.description rich JSON; already converted documents remain. Plain text/line breaks never become HTML. Prior region/entity/multiple-binding migrations remain. ZIP 8 reads 1…7, includes both documents/original images and remaps all image.assetId. Context/descriptions/new-project cards save only explicitly; errors retain drafts. Project/data/settings deletion is atomic, preserving others/shared width. Camera/settings are not project data. [Storage](docs/storage.md).

## Manual acceptance BM-003

1. Open/create a project, close context, Upload map and select PNG/JPEG/WebP. Image renders proportionally after preparation/write. Show entire map fits explicitly; adding a background to an already open empty map preserves its current camera.
2. Drag to pan and wheel over a recognizable detail for pointer-relative zoom. Show entire map fits; arrows/+/- work with map focus.
3. Reload: image restores/fits, panels closed. Camera is temporary UI state; pan/zoom do not write image coordinates.
4. Create another project/image and switch; each retains its own map/context.
5. Replace image with another raster and reload. Try SVG/PDF/corrupt PNG: explanatory error, previous map remains.
6. Another tab can replace images, but stale revision is rejected. Quota/write failures retain old image/retry; automated.
7. Remove image and confirm: background disappears, map/project/context remain; reload has no background. Next upload reuses the map. The centered upload prompt returns in Preparation.

One background per map; BM-003 originally opened the first project map. A new raster is at (0,0) with original pixels as independent map units. Replacement retains position/adopts new dimensions. Image itself does not drag; mouse controls the view. Resolve context edits before upload; project switching is blocked during preparation/write.

## Manual acceptance BM-004

1. Upload/edit context, explicitly Save/close the card, Export project and retain ZIP. UI-03 context requires explicit Save/Cancel before export.
2. Inspect manifest.json, project.json, assets/ with originals. Manifest lists content paths/sizes/SHA-256, excluding itself and the empty directory from checksums.
3. Import project: after validation/write an independent “… (copy)” opens with same context/map and closed panels. Suffix follows interface language; source names/text do not translate. Reload and verify.
4. Edit copy context/remove its image; reopen original: unchanged.
5. Import corrupt ZIP or manifest formatVersion:99: explanatory error, no copy, unchanged original/selection. Late IndexedDB write failure is automated.
6. Import into another profile or preview at 4173, even with no project open. Resolve current changes before import.

Backup format 8 also reads v1 (BM-004, no regions), v2 (BM-005, empty later fields), v3 (early BM-006 Markdown), v4 (accepted rich JSON), v5 (early single binding), v6 (multiple bindings), v7 (UI-02 summaries/traps). v1…4 receive empty entities/markers; v5 a list containing the old binding; contextMd/notesMd convert to documents. Save/cancel card drafts before the one-transaction snapshot. Header switches maps. Import remaps project/map/asset/image-placement/region/check/entity/marker IDs and all bindings/text/context/map-description image references. User settings, camera, selection, draft outline/forms, undo and extra secret fields are excluded. Failed export emits no file; failed validation/import leaves existing data unchanged.

Limits: ZIP **128 MiB**, expanded **256 MiB**, image **64 MiB**, project.json **4 MiB**, manifest.json **512 KiB**, **512 entries**, **128 maps**, **256 assets**, **64×1024×1024 pixels** per image. Declared sizes and actual streamed output are checked. Store/Deflate allowed; ZIP64, encryption, duplicate/invalid paths rejected. [Full format](docs/backup-format.md).

## Manual acceptance BM-005

BM-005 with vertex/palette fixes was manually accepted on 2026-10-09; retain these regressions.

1. Add region and at least three vertices. Outline/preliminary edges follow pointer. Move existing handles during creation; double-click a handle deletes without finishing. Enter, double-click free space (last new vertex) or Done closes with number/title/40% fill. Completing double-click adds its point once.
2. Start another outline/Escape: removed, never saved/exported. Two vertices, a line or crossing bow-tie fail validation without creating a region; Escape cancels.
3. Right-click empty map → Add region: menu point becomes first vertex. Create an overlapping region; overlap is legal, the top one selects, lower ones are reachable in free space/navigation.
4. Creation leaves card closed; click opens one panel. Number/title/color/opacity/whole-outline movement share Save/Cancel. Filled cards open view; Edit enables movement. Palette stays after selection; outside click/Escape closes with draft color retained. One completed draft drag undoes/redoes as a whole. View/closed-card interior drag pans. Wheel/camera controls change only viewport.
5. Edit vertices: drag handles, click edge to add. Double-click handle/Delete selected/Delete vertex remove, retaining three vertices and valid geometry. Invalid intersection/zero area rejected. Undo/redo includes these changes. Finish vertex editing; whole movement uses card Edit.
6. Delete/undo a region; with map focus Ctrl+Z, Ctrl+Shift+Z/Ctrl+Y. Reload restores saved regions with closed panels/cleared selection/history.
7. Export/import copy and edit its region; original unchanged. BM-004 archives restore maps/images without regions. Background replace/remove preserves contours.
8. The isolated Web Locks mechanism can make the second tab view-only and reread upon acquisition; UI-01 currently disables it, so both edit with revision-conflict protection. Quota/rollback/draft retention are automated; retry never overwrites another revision.

Saving map objects becomes success only after transaction completion. Failed creation remains a draft; failed edits retain saved geometry/retry. Drafts/form input/retry are page-memory only. History holds 100 current-map geometry operations; new edits clear redo. Card text has separate undo. [Limits/model](docs/regions.md). First map may be created by upload; removing its background still allows regions.

## Manual check BM-006

BM-006 visual editor/images/shared-card refinements were manually accepted.

1. Create two regions, cards closed. Click/tap an empty region: exactly one editing panel with all properties/color/fill, no geometry window.
2. Enter notes; select words and apply bold/italic/underline/link. Headings/lists/quotes affect the block, toolbar retains selection. Add separate description, checks with optional DC, tags, number/title.
3. Paste browser HTML with heading/emphasis/list/link/table: supported formatting stays, external layout may change. Plain paste remains text. Arbitrary HTML/events/unsafe links never execute.
4. Paste clipboard screenshot/Ctrl+V or Insert image PNG/JPEG/WebP. Verify proportions/card width/removal. Cancel restores saved fields/removes new images; reenter/Save, wait for confirmation/view. Filled reopening shows Edit/Delete region.
5. Edit then select another region/close. Check save-and-continue/discard/continue; rapid switches never mix text. Ctrl+Z in text leaves geometry. Empty paragraphs/only number/color changes are not filled content.
6. Pan/zoom and open/close preserve camera. With card closed, interior drag pans and does not open it. Vertex editing uses the same panel. Retain creation-time handle/double-click/palette regressions.
7. Save/reload: formatting/images/checks/tags restore. ZIP copy changes/image deletion leave original intact. v1/v2 get empty fields; v3 ZIP/v4 DB migrate Markdown.
8. Write failure retains input/images without Saved. Dialog-triggered save also retains error/continue path. Forced image failure/rollback/revision conflict are automated.

Card saves only via common button. Export/project changes/geometry commands require saving/canceling changed cards. Writing/image preparation temporarily blocks close/switch. Browser warns on unsaved page exit; forced reload loses memory drafts. UI-03 context uses the same explicit pattern.

Tiptap 3.31.4 (React/ProseMirror/StarterKit/TableKit/Image) edits visually; DOMPurify 3.4.16 cleans HTML. unified 11.0.5, remark-parse 11.0.0 and remark-gfm 4.0.1 migrate old Markdown. Text is solely rich JSON with assetId; originals IndexedDB. Removing a node retains a shared asset; unused saved assets remain. [Details](docs/region-details.md).

## Manual check BM-007

BM-007/refinements accepted October 11, 2026. Its IndexedDB 7 / ZIP 6 use regionIds[]; v6 DB/v5 ZIP single links migrate. Region deletion removes only its link. Writes/movement preserve viewport without flicker.

Link a marker to two regions and set zoom/pan. Related regions → a region → Related markers centers the selected element without scale changes. With dirty text, Continue editing retains text/view; Discard or successful Save and continue navigates. Closing/pan/writing/resize never repeats centering; ordinary click/tap does not reposition.

1. Add two overlapping regions. Add enemy in overlap: one editing card, no automatic links. Enter text/move before first Save: text retained, only draft point changes. Cancel removes it; reload/export contain no draft. Repeat via right-click → Add marker → type at the menu point. First menu row still creates regions; Escape/outside closes.
2. Save two differently named enemies; hidden/defeated statuses are independent and hidden remains visible. Check other types/icons/legal statuses, non-color symbols, persistent palette.
3. Add formatted/pasted/image description, tags and both region checkboxes. No binding clears them. Save enters view after confirmed write. Each region's computed list links to the same panel. Marker above a region opens only itself, including touch.
4. Edit and select another object/close, test three decisions/text undo. Clear/refill fields, save regions/markers, move marker/resize: no camera jumps. Show entire map explicitly fits.
5. Zoom/drag: icon size fixed, links unchanged, no accidental card. One undo reverses drag; redo restores. Lock blocks movement without blocking card.
6. Delete marker/undo; delete one bound region, only its link removed; undo restores region/both links. Entities survive placement deletion.
7. Reload restores fields/images/status/color/bindings/lock, cards closed. ZIP-copy description/status edits do not affect original. BM-006 archives retain regions/no markers.
8. Second tab can edit with UI-01 locks disabled; stale writes report conflict/retain draft. Quota/atomicity automated; forced reload loses memory drafts.

Every new marker gets its own entity. Deletion removes placement only; unused-entity library later. One current-map history combines region geometry and marker create/delete/move, max 100, reset on reload. Card fields are not separate geometry operations. Limits: 4096 project entities, 4096 placements/map, ZIP 4096 total. [Details](docs/markers.md). No BM-007 dependency additions.

## Manual check BM-008

BM-008/refinements accepted 2026-10-11; these scenarios remain regressions.

1. Project opens map/panels closed. Right-header menu marks current, New map first. Rename first/create second/upload; new map opens after write. Renaming another does not switch. Menu/filters update. Check Tab/Enter/arrows/Home/End/Escape/touch without hover. Populate both maps; one marker bound twice, another unbound.
2. Save Trap as a region tag. Empty marker tag field offers five shared suggestions. Type a trimmed mixed-case substring, arrows/Enter select canonical spelling/clear input; equivalent lower-case tag adds no duplicate. Escape closes only suggestions. New tag+Cancel leaves history; Save moves it into recent/reload retains order. Failed writes retain draft/tags without history changes; injection described in BM-010.
3. Navigation/search contains no map management; extra filters closed initially. Match names/numbers/tags case-insensitively, compare map/project scope. Combine map/tags and Any/All. Map filter never switches workspace. Collapse settings: activity/reset stay visible; check unique count/empty state.
4. Marker filters combine map/type/status/tags/region. Check all groups and region By tag. Multi-bound marker appears twice under region grouping but counts once; No region exists. Both rows open the same card/placement.
5. Set distinct viewport on each map; ordinary switching restores each/closes previous card. Project-wide result opens correct map/selection/one card and centers at remembered scale without intermediate fit/flicker. Check region↔marker links and ordinary canvas click/tap without centering. Save/clear/drag retain camera.
6. Dirty card transitions via menu/search: Continue retains text/view; Discard proceeds; Save and continue writes first. Failure stays on source map with text. Resolve card before map create/rename/delete.
7. Back up test project before deletion. Another-map Delete confirmation names target/consequences. Cancel unchanged; confirm removes its objects while preserving current camera/objects/shared images. Delete current: next map's remembered view, card closed. Delete last: empty Create map; creation works again. Failed write leaves no partial deletion/success.
8. Panel close/reopen/tab switching retains settings/canvas. Reload retains data/tag history, panels closed. Import earlier ZIP: all maps/bindings/tags/images remapped. Copy suggestions start predictable, then own history; original/history unchanged.

Navigation/cameras are page-memory only; reload opens first map by order. Tag history is transactional project settings, survives reload and is not exported; tags are. Map switching clears geometry undo; map deletion is not undoable. Map operations are atomic, retaining typed name on error. BM-008 versions 7/6 unchanged because settings already exists; old objects supply fallback. No dependencies. [Details](docs/navigation-search.md).

## Manual acceptance BM-009

1. New project starts Preparation with closed panels; old projects restore their last saved mode. Prepare two maps/regions/two independent enemies/bindings, GM/player content/checks/tags/images, and zoom/pan.
2. With dirty card click Play, check Continue, Save and continue and separately Discard. Text follows choice; card enters view while map/selection/camera/search persist. Discarding unsaved marker leaves no record.
3. In Play try region/marker drag, Delete, vertex double-click and right-click: geometry unchanged. Map create/edit/delete/background actions unavailable. Pan/zoom/hover/tap/maps/project search work; results/links center at old scale in one card. Empty region opens view with empty-state help.
4. Verify distinct GM/player sections, formatting/images. Quick status change updates icon/card/region lists/search only after writing; second enemy unaffected. Status undo/redo and map Ctrl+Z/Ctrl+Shift+Z handle only statuses without camera change. Hidden remains visible.
5. Reload restores Play/statuses with closed panels. ZIP copy has data/bindings/formatting/images/new IDs, starts Preparation. Mode is unarchived local UI state; status history resets on reload.
6. Return Preparation: text/color/vertices/drag/background/map editing restored. UI-01 allows second tab edits; revision conflicts show errors/last confirmed status, retries cannot overwrite fresh revisions. Quota/delay/retry/flicker automated.

BM-009 retained IndexedDB **7**, Project **1**, ZIP **6**; workspaceMode:<projectId> in existing settings defaults Preparation. Status updates atomically write Entity/Project revision. No dependencies. GM-only screen; player view/future BM tasks excluded.

## Manual acceptance BM-010

1. Build/preview at <http://127.0.0.1:4173> online; wait Ready to work offline. Create two maps, formatted/image region and marker linked to two regions. Save, pan/zoom, search/Play.
2. DevTools Network → Offline, reload same address. Map/text/images/editor work. Edit/save/reload again. Export/import ZIP offline, verify data/copy independence.
3. Online, open original in two tabs. No ownership banner; both edit. Save first, then stale second: conflict/draft, no silent overwrite. Cancel/reopen to reread; not synchronization.
4. Inject IndexedDB failure using [instructions](docs/reliability-offline.md#testing-a-write-failure): card/text/camera retained, no Saved. Restore and retry.
5. Corrupt ZIP creates no copy/changes; real old databases/archives, final-write failure and unknown versions automated.
6. Leave draft open, rebuild after small UI text change, Check for updates. No automatic reload; Apply update unavailable. Resolve card, explicitly apply; saved data remains.

## Project structure

```text
src/main.tsx        React entry point and language initialization
src/App.tsx         workspace
src/styles.css      styling/responsiveness
src/i18n/           English/Russian dictionaries, preferences, messages
src/domain/         Project/Map/Asset/Region/Entity/Placement and geometry
src/application/    repository contracts and editing sessions
src/storage/        IndexedDB and transaction validation
src/storage/backup/ ZIP, schema validation, decompression limits
src/offline/        production worker, cache states, explicit updates
build/              offline resource-list generation
src/features/projects/ project selection/deletion/context/description
src/features/map/   canvas, camera, raster validation
src/features/regions/ shared card, visual editor, HTML sanitization
src/features/markers/ entity/placement cards
src/features/navigation/ search, filters, map menu/deletion
src/features/tags/  shared tag input/suggestions
tests/e2e/          browser map/error/localization scenarios
docs/               product/format documentation
AGENTS.md           development rules
```

Important-entity library, relationships, statblocks, separate attachments, AI, snapping and group operations remain later BM tasks. Versions are pinned in package.json/package-lock.json; use npm ci for reproducibility.

## Manual check UI-01

Start dev. Check burger/information/map menus/confirmations/creation/search. Interior region drag with closed/view card pans; Edit moves only that outline. Save/Cancel handles geometry/text together. Check dirty transitions, undo/redo, Play, narrow window and second tab. [Full short scenario](docs/ui-controls.md).

## Manual check UI-02

Open region, set summary, Save/Cancel, hover without GM notes. Resize divider/arrows/window: camera/draft retained. Save/reload restores content/preferred width with closed panels. Check selection/More toolbar. Add trap, correct fractional DC to 15, bind twice, Cancel, game status/undo, reload/ZIP. [Full scenario](docs/ui-cards-tooltips-traps.md#manual-check).

## Manual check UI-03

Create formatted/image context, cancel/save. Add independent descriptions on two maps. View in Play; check shared width, zoom/pan and dirty transitions. Reload/ZIP preserve content/images. Cancel/confirm project deletion: other project/camera retained; current deletion returns list. [Full scenario](docs/ui-project-map-context.md#manual-check).

## Manual check localization and empty maps

1. Run dev at 5173. Without a saved language choice, controls are English. Burger → Русский changes immediately; choose English again and reload to verify persistence. Repeat with project/context/map/object cards and search open.
2. Enter unsaved mixed-language user content/tags/checks; set zoom/pan/search and switch languages. Text, selected object, card draft/editor and camera remain; only controls/type/status/error labels change. Save/reload/ZIP-import verify unchanged content.
3. Create/select a map without background. Central Add map image supports PNG/JPEG/WebP; cancel changes nothing, invalid/corrupt files show localized retryable errors, valid upload hides the prompt. Removing background restores it without removing regions/markers; objects and pan remain interactive outside the button. Play has only the no-image message.
4. In both languages check traps/DC validation, confirmations, filters/groups, long labels and 375 px layout. Build/preview, wait for offline readiness, disconnect/reload and switch languages; both dictionaries are bundled. Repeat pages-hosting for the subdirectory base. No localization changes are published before acceptance.

Known limits remain: memory-only drafts/viewport/undo, browser-origin storage/eviction, temporarily disabled tab ownership, no synchronization/backend. The existing Vite >500 kB main-chunk warning remains; localization adds bundled dictionaries without dependencies or network translation. New automatic region/marker/map names and copy suffixes follow the language at creation; existing saved names never change automatically.
