# UI-02: cards, tooltips and traps

UI-02 passed manual acceptance on October 11, 2026; after repeated checks it was committed as `1ad2792` and normally merged into main as `cd91543`. UI-01 and the entire previous BM-010 snapshot were committed as `5d51aaa` by explicit user authorization, then normally merged as `1a991a8`. The next stage was `bm-ui-03-project-map-context`.

Regions/markers share the right panel. Drag its left edge with mouse/touch; keyboard: ← increases width by 24 px, → decreases it, Home/End choose limits. On wide screens the minimum is 320 px, maximum 900 px, reserving 240 px for the map; at workspace widths ≤720 px it takes available width with 12 px margins. Resizing clamps display while retaining the preferred width for a larger window. When space is limited, tools use top/bottom strips outside the card. Canvas, camera and drafts are not recreated.

Width saves after drag/keyboard completion in IndexedDB settings key `ui:cardWidth`, shared across this browser origin's projects. Errors are visible with retry; settings are excluded from Project/ZIP. Late reading cannot overwrite an already chosen width; writes are serialized.

The shared Tiptap editor uses Text / Heading 1 / 2 / 3, B/I/U, list icons and quote/link/image/table icons from existing lucide-react. Below 510 px toolbar width, the last four actions move into More. Selection survives menu opening, formatting and link/image insertion. Opening never rewrites existing documents; sanitized HTML, safe links, Asset images and shared Save/Cancel remain. No new dependencies.

`Region.shortDescription` is user-optional ordinary multiline text up to 262144 characters; it is a required string in persisted data. It follows number/title and joins the draft, transition protection and atomic write. Nonempty summary opens the card in view. Hover shows number/title, summary and tags; GM notes are card-only and never automatically copied into summary.

Tooltips intercept no events and stay within workspace bounds. Summary truncates visually to four lines and name to two. Shared badges show up to five tags plus a localized remaining count, with no block for empty tags. Markers also show type/status. Truncation never changes saved text.

New `Entity.kind = trap` has a distinct trap icon, initial armed status (!) and disarmed (✓). It is available in every menu, search/grouping and related list. Checks belong to Entity, not MarkerPlacement/region. Existing RegionCheck is reused: id, condition (purpose), ability (skill/ability), required positive safe-integer dc for traps, result (optional plain-text explanation). Up to 256 records; an empty list is allowed. Other kinds have Entity.checks=[].

Draft DC is a string so incomplete/invalid input remains editable. Empty purpose/skill and noninteger, zero or negative DC are not written; failure creates no partial entity. Common Save/Cancel includes checks, description, tags, position and multiple bindings. Hover shows up to three short checks plus remaining count; explanations are card-only. In Play, checks are read-only; quick status writes immediately with separate undo/redo/error handling.

## Versions and migrations

**IndexedDB 8 / Project.schemaVersion 1 / ZIP 7.** Upgrading a real v7 database adds shortDescription:'' to regions and checks:[] to entities, validating records before writing. Older databases first receive previous rich JSON/multiple-binding migrations within the same atomic upgrade transaction. Failure rolls everything back without clearing source data. Documents, originals, geometry, status, revision and IDs remain.

ZIP v7 includes new fields and retains SHA-256/limits/strict references. Reading real v1…6 adds empty values; v5/older single bindings still become lists. Copy import remaps entity-check IDs with all earlier IDs/references; mode, width, tag history, camera and secrets outside the domain are not exported. GM notes and check explanations are project data and do enter backups.

## Manual check

1. `npm run dev`, open http://127.0.0.1:5173. Create a project, map and two regions. Enter only a summary, save/close/reopen: view mode. Edit/cancel and verify original text. Hover shows summary/tag badges without GM notes.
2. Set zoom/pan. Drag the card divider, use arrows/Home/End, open another card and reload. Shared width restores. At narrow widths, panel/tools remain available without horizontal overflow; draft/camera survive resize/Save/Cancel. As before, outlines move only while their cards are editing.
3. Select editor text; apply B/I/U, a heading and a link through More. Check table, quote, formatted paste and an image; Save/reload retains content/image. Try keyboard, Escape in menus, tag suggestions and ordinary text undo.
4. Add Trap through the panel and right-click. Move it before Save. Add a Detect / Perception check: empty, 0 or 1.5 DC yields an error without writing/losing draft; 15 saves. Add/delete checks, bind both regions and save. Hover shows checks/remaining count, explanations only in the card. Canceling a new marker leaves no entity.
5. In Play, change Armed to Disarmed, undo/redo status. Icon, lists and search update without changing camera; checks cannot be edited. Return to Preparation, edit/cancel checks and repeat after reload.
6. Export ZIP/import a copy. Verify summary, checks, statuses, images, links to both regions and original independence. Old ZIP v6 opens with empty new fields. Inject a failure using [instructions](reliability-offline.md#testing-a-write-failure): draft remains, success is absent; restore writing and retry.

Automated checks cover versions/migrations, failures/full copies, DC/statuses, Save/Cancel, local width, browser formatting/paste/images, tooltip, pre-save drag, links, Play, tools and viewport. Edge `card-enhancements` saves wide/narrow card/trap screenshots to Git-ignored test-results/.

October 11, 2026 results: typecheck/lint/build passed; 164 unit tests and all 40 production Playwright Edge scenarios passed. Card, formatting menu and tooltip screenshots were inspected. Build retains its main chunk >500 kB warning; build/offline checks pass. UI-02 was manually accepted and checks repeated before committing.
