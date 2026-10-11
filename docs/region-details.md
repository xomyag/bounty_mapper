# BM-006: the single region card and visual editor

UI-02 adds a region summary, shared adjustable card width and a compact toolbar with More. Hover shows the summary and tags instead of GM notes. UI-02 versions were IndexedDB 8 / ZIP 7; the sections below record earlier stages. See [current cards and migrations](ui-cards-tooltips-traps.md); UI-03's current overall formats are documented in [backup-format.md](backup-format.md).

UI-01 includes whole-outline movement in the shared draft: only the editable region moves, Save writes geometry with fields, and Cancel restores it. Failures and transition confirmation retain the same draft. Fields and format did not change. See [current controls](ui-controls.md).

BM-006 and refinements were manually accepted by the user. Their clarification replaces Markdown source/preview with a visual editor and card autosave with a common Save / Cancel draft.

BM-007 uses the same editor, common dialog and panel for marker cards. Region view adds a computed related-marker list; selection replaces the only panel's content with unsaved-changes handling. BM-007 versions were IndexedDB 7 / ZIP 6; versions below describe BM-006 migrations specifically. Multiple bindings and stable cameras during field clearing/saving are documented in [markers.md](markers.md).

## Interaction

Number and title remain on canvas. BM-006 hover shows only saved GM notes, up to 450 plain-text characters; the full text is in the card. UI-02 later replaces this hover content with the summary and tags. Click/tap opens exactly one HTML panel. After creation, reload and project switching it is closed. Opening/closing preserves the camera. Finishing a drag, vertex handles and the palette cannot accidentally open it.

An empty region opens for editing; a filled one opens in view with Edit and Delete region. Content includes a user-changed title, text, image, checks or tags. Automatic number/title, geometry, color, opacity and empty editor paragraphs do not count. `titleCustomized` records a meaningful title change; old records compare against the historical Russian automatic title, `Область N`.

All properties share one panel: number, title, notes, player description, checks, tags, color and fill. View renders the saved formatted document; edit creates a shared draft. Save writes all fields and new images in one transaction; Cancel restores saved values. Color is not saved separately. The palette remains open after selection and closes on an outside click or Escape.

Closing/switching a changed card offers Save and continue, Discard changes or Continue editing. Write failure retains the draft and pending transition. Drafts are tied to region ID and input version; a late write completion cannot move text into another region. Transitions are blocked during writing/image preparation. Export, project switching and geometry commands require saving/canceling the changed card. At BM-006, project context retained its earlier autosave; UI-03 later changes it to the shared explicit Save/Cancel flow. Cards never autosave.

Vertex mode is explicitly enabled from this panel. Selection, card mode and canvas mode are separate states; no second properties panel is created. Geometry history does not undo current text. Ctrl+Z in the editor/ordinary fields handles text; map shortcuts require map focus.

## Text, paste and images

The editor is Tiptap 3.31.4 on ProseMirror: StarterKit (including underline/link), TableKit and an Image extension with its own Asset reference. Commands apply ordinary text, H1–H3, bold/italic/underline, lists, quotes and links to the selection/current block. Buttons retain selection. Table insertion is also available. Rendering/storage support H1–H6, code and strikethrough, including migrated old notes.

Clipboard HTML is sanitized with DOMPurify 3.4.16 before editor parsing. Supported blocks, lists, emphasis, links, quotes, tables and a small safe-text-style allowlist survive. Scripts, event handlers, arbitrary CSS, unsafe links and external images are removed. Copying an arbitrary website does not guarantee identical layout. Plain text is inserted as text without Markdown paste rules. Links allow HTTP(S), mailto and relative addresses, excluding control characters; view opens them with `noopener noreferrer`. JSON is separately checked against strict node/attribute allowlists. Arbitrary HTML is neither stored nor executed.

PNG/JPEG/WebP can be inserted from a file or clipboard bitmap, including screenshots. Preparation verifies MIME, signature, decoding, dimensions and SHA-256. Originals remain in draft memory until Save and can be removed before Cancel. Each image is limited to 64 MiB and 64×1024×1024 pixels. Text paste is capped at 262144 characters; clipboard HTML at 1 MiB.

An image is `{type:'image', attrs:{assetId, alt}}` in the document; original bytes are an existing IndexedDB Asset. Temporary object URLs are display-only and revoked on closing, never stored or archived. Images preserve aspect ratio and fit card width. Removing a node removes its reference, not the shared Asset; saved unused assets are currently retained for other references and undo. Background replacement/removal also considers card references. Automatic unused-asset cleanup is outside this stage.

## Model, migrations and atomicity

`Region` adds `titleCustomized: boolean`, `gmNotes: RichDocument`, `playerDescription: RichDocument`, `checks` and `tags`. RichDocument is the sole text source: JSON `{type:'doc', content:[...]}` with allowed nodes/marks; the domain imports neither Tiptap, React nor DOM. Separate editable Markdown and rich-text copies are not stored. A check has id, condition, ability, result and optional dc. Region DC is a nonnegative safe integer; at most 256 unique-ID checks and 256 unique tags of up to 120 characters are allowed.

Documents are capped at 10000 nodes, depth 32, 262144 text characters and 524288 JSON characters. Every image.assetId must belong to the project. New assets, regions and Project.revision are written in one readwrite transaction; any failure rolls everything back. Saved on this device appears after `transaction.oncomplete`. Failure leaves the saved document unchanged and retains the input draft. Drafts live in page memory and cannot survive forced reload; beforeunload warns about unsaved input.

BM-006 IndexedDB version was **5**. Upgrade from v1/v2/v3/v4 preserves stores, geometry, properties and revision. BM-005 regions receive empty documents, checks and tags. Previous BM-006 v4 `gmNotesMd` / `playerDescriptionMd` are parsed with unified/remark-parse/remark-gfm and replaced by rich JSON; headings, emphasis, lists, quotes, safe links and tables retain formatting. Raw HTML becomes ordinary text, unsafe links lose interactivity. Old Markdown images become textual placeholders without downloading external files. Migration runs inside the upgrade transaction. Project.schemaVersion remained 1.

BM-006 exported ZIP **v4** and read v1/v2/v3/v4. v1 receives empty regions, v2 empty documents, v3 migrated Markdown. v4 requires new fields and strict asset references. Independent copies receive new region, check and asset IDs; image.assetId is remapped inside both documents. Every map, field and original image is included in a consistent snapshot; UI drafts, cameras and history are excluded. See [backup-format.md](backup-format.md).

## Checks

Vitest covers card modes, Save/Cancel, delayed transitions, failures/retry, draft ownership by ID, retained text during geometry undo, HTML/URL/JSON validation, Markdown conversion and real v3/v4 migration, atomic image writing, shared assets and ZIP remapping. Playwright checks selection/toolbar, real HTML/plain/bitmap clipboard, file insertion, save/cancel, failed writes/retry with images, reload/ZIP, copy independence, touch and text undo. BM-005 vertex, double-click and palette regressions remain. Manual steps: [README](../README.md#manual-check-bm-006).
