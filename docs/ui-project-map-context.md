# UI-03: adventure context, map description and project deletion

UI-03 and fixes passed user manual acceptance; implementation was prepared in `bm-ui-03-project-map-context`. Accepted UI-02 was committed as `1ad2792` and normally merged into main as `cd91543`. No new dependencies were added.

## Shared panel and drafts

The information button beside the project name opens Adventure context; the separate information button beside the map selector opens Map description. These occupy the existing right panel, sharing its saved width and exactly one representation. Saved content is shown first; in Preparation, an empty state offers Fill in. The map name appears in its description heading. Play supports viewing formatting/images; editing becomes available after returning to Preparation.

Project name/context or the separate map description use a shared Save / Cancel draft. They use the same Tiptap editor, formatting, sanitized text/HTML paste, PNG/JPEG/WebP images, safe links, lists and tables. Markdown entry is unnecessary. Saved appears only after transaction completion. Failure retains text and prepared images for retry.

Closing, opening other information/object cards, changing map/project or mode use the existing confirmation: save and continue, discard, continue editing. Transitions are temporarily blocked during image insertion or writing. Tools for the previous object stop after resolving its draft. Ordinary map switching while a description is open shows the selected map's document; adventure context remains shared. Panels and writes neither change canvas/zoom/pan nor invoke Show entire map.

Creation: Projects → name → Create opens a context draft in the common panel. Refine the name, enter text and insert images. Until the common Save, project/assets exist only in memory; saving writes them together and opens the project. Cancel returns to the list without records or attachments. Preparing a new project leaves an existing project unchanged.

## Storage and compatibility

Current versions: **IndexedDB 9 / Project.schemaVersion 2 / ZIP 8**.

- `Project.context: RichDocument` replaces `contextMd`; no second editable copy remains.
- `Map.description: RichDocument` replaces `notesMd`; each map has an independent description. New maps receive an empty document. The old UI never edited notesMd and it was empty; nonempty values in old imports are preserved during conversion.
- The shipped context was Markdown in a textarea. Upgrade 8 → 9 uses the existing Markdown parser: headings, lists, emphasis, links, quotes and tables survive. Plain text preserves line breaks, including blank lines; arbitrary HTML remains literal text. Already converted documents are not converted again. Failure rolls back the entire upgrade and preserves the old database version.
- ZIP 8 contains both document types and original assets. The reader strictly supports ZIP 1…7 / Project 1 by converting legacy fields; ZIP 8 requires Project 2. It validates structure, allowed nodes and current-project asset references. Independent-copy import remaps `image.assetId` in context/map descriptions together with existing object references.
- Export uses a consistent snapshot; save/cancel an unsaved card first. Settings, viewport and drafts are excluded. ZIP/rich-document limits are unchanged: [format](backup-format.md).
- Background deletion/replacement and map deletion also consider references from project context and other map descriptions; used images remain.

## Project deletion

In the project list, opening a project and its ⋯ menu are separate controls without nested buttons. Click/tap and keyboard open the menu. Delete project shows the name and consequences: permanent removal of its maps, regions, marker placements, entities and attachments. Cancel writes nothing.

Confirmed deletion checks revision and uses one transaction across all affected stores. It removes only the project's map records, entities/assets with its projectId, and its `workspaceMode` / `tagHistory` settings. Active ID is cleared only for that project; shared panel width remains. Assets can be shared within a project; model/archive validation forbid cross-project references.

Deleting another project retains the current map, card and viewport. The current project's draft is resolved first; success opens the project list. Repeated execution during writing is prevented. A late failure rolls back every deletion and setting, shows an error and allows retry. There is no trash or restoration.

## Manual check

1. `npm run dev` → http://127.0.0.1:5173. Create an adventure; add formatted context and an image. Cancel: it is absent from the list. Repeat and save; the information button shows saved content in the common panel.
2. Create two maps. Add distinct text/images through each Map description. Switch maps while description is open: heading/content belong to the selected map. Adventure context is shared.
3. Set zoom/pan and panel width. Open context, description and object cards, edit/save/cancel: one panel, unchanged width/camera. With a draft, try closing and navigating to an object/map/project or Play; check all three choices, especially Continue editing.
4. In Play, open both documents: formatting/images are visible without editing. Return to Preparation. Reload and check saved content; panels do not open automatically.
5. Export ZIP, import a copy and edit its context/description. Original content remains and all images load. Old ZIPs still open with converted context and empty descriptions for formerly empty maps.
6. In another project's menu, choose deletion, cancel first, then confirm. Current map/card/camera/images remain. Deleting the current project with a draft requires a decision; confirmation opens the list, and deleting the last project leaves an empty workspace.
7. Quota/late-write failures, retained drafts and migration/deletion rollback are automated. For a manual write failure, follow [storage instructions](reliability-offline.md#testing-a-write-failure), restore the method and retry.

Checks include real legacy Markdown fields, idempotence, independent documents, shared transitions, original images and new copy IDs, creation/save/delete rollback and other-project preservation. Edge covers the creation editor, both documents, Play, width, every camera frame, ZIP and deletion confirmation/cancel. Screenshots are in `test-results/`, excluded from Git.

Final UI-03 run: typecheck, lint, build, 176 unit tests and 43 production Edge scenarios passed. Wide/narrow panel screenshots and deletion-error confirmation were inspected. The build retains Vite's main JS chunk >500 kB warning, which predates UI-03.

Drafts live in page memory: forced close/reload after ignoring the warning loses unsaved input. Saved unused assets are retained under the previous policy; canceled new assets are not written. Undo history is not restored after reload. Offline shell and browser storage limits are unchanged; AI, server, synchronization and trash were not added.
