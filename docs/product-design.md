# Bounty Mapper — product design v0.2

Date: October 7, 2026. Updated: October 8, 2026. Status: a design foundation for discussion and iterative development, with subsequent implementation decisions recorded below.

Requirements source: `mapper.md`. User decisions: personal use first; storage on one device; synchronization/demand validation later; AI after the core editor. Other decisions are proposals that may change after development and games. Bounty Mapper is a working name.

## 1. What we are building

A tabletop RPG game master's workspace in which the map is a way to find information. Rooms, characters, doors and rewards link to notes and game state. During play, selecting a map object immediately reveals descriptions, checks, enemies and important details.

The main task is to reduce switching between the map, adventure book and scattered notes during preparation and sessions.

The first user is the project author, a D&D GM. Structure should accommodate other systems, but separate system-specific support is not yet being developed.

**Product hypothesis:** spatial notes let the GM find scene details faster and interrupt play less often. This is a hypothesis, not an established result.

**First useful outcome:** prepare one real adventure map, run a session with it and continue after reloading without losing data.

This does not require a combat engine, D&D rules, shared tabletop, dice management or a public adventure catalog. Those directions are outside the current task.

## 2. Main scenarios

| Scenario | User actions | Expected result |
| --- | --- | --- |
| Prepare an adventure | Create project/map, upload image, enter general context | A working map and top-level notes |
| Annotate a location | Draw region; give number/title; enter GM notes, player text and checks | Scene details available by selecting a room |
| Add objects | Place NPC/enemy/door/reward markers and descriptions | Objects discoverable on map and in lists |
| Run a game | Enter Play; select rooms; read prepared text; change object status | Information at hand; accidental geometry movement blocked |
| Continue later | Reopen after reload | Notes, geometry and state retained |
| Back up | Export project, import archive as a copy | Images/references restored without changing original |
| Develop a campaign | Add floors, move an important NPC, link passages | One character retains shared description while moving |
| Use AI assistance | Select region, inspect context, request/accept draft | Generation supplements preparation without erasing notes |

## 3. Information architecture

Distinguish three concepts called layers in the original sketches:

1. **Project / adventure:** contains maps, context, objects and attachments. One organizational level in MVP; introduce campaign → adventures → projects only if needed.
2. **Map:** a location/floor switched through navigation. A floor is not another floor's graphical layer.
3. **Map graphical layers:** images, regions, markers, links and optional grid. Layer order, visibility and locking control display/editing.

Maps use independent coordinates. An image is an object in that space; scaling/moving it must not silently alter regions. Moving a map together with annotations would be a separate group-transform command later.

Project descriptions establish adventure context; map descriptions establish location specifics; region descriptions establish a scene. Tags describe content and do not replace hierarchy.

## 4. MVP boundaries

MVP is the first version usable in a real game, built from small working iterations.

### Included

- Local projects: create, open, rename, delete.
- Shared project notes and independent map notes.
- One or more independent maps; one background image per map.
- PNG/JPEG/WebP upload, proportional background scaling, image movement/locking.
- Workspace pan, pointer-relative zoom and Show entire map.
- Polygon regions: create, edit vertices, move whole shape, delete, overlap, color/opacity. Initial fill opacity 40%.
- Region card: number/title, GM notes, player description, checks, tags.
- Visual card editor: headings, lists, bold/italic/underline, links, quotes, tables and file/clipboard images. Supported pasted HTML is sanitized; arbitrary HTML/scripts excluded. Old Markdown migrates to one rich JSON representation.
- Standard markers: enemy, boss, door, passage, reward, hero, ally, NPC. Constant screen size, color, name, description, status, position lock.
- Manual marker-region bindings and access to related objects from region cards; accepted BM-007 expands these to several regions.
- Entity separated from its map placement in the data model.
- Collapsible Regions / Markers navigation, name/number/tag search, marker type/status filters, map grouping and result navigation.
- Visible changed/saving/saved/error states and basic undo/redo. Initial autosave plans were superseded by the accepted shared Save/Cancel drafts.
- Play mode: protected geometry, accessible descriptions/statuses.
- Versioned project export/import with images.
- The original first interface was Russian. The current localization iteration adds English as the default without a saved preference and retains Russian; generation language remains a separate future setting.
- After the core scenario: app caching for offline reopening, checked separately. Local data storage alone does not guarantee offline startup.

### After MVP

AI, server/accounts, synchronization, existing-reference integration, arbitrary images per map, attachment gallery, object links/movement log, bulk editing, vertex snapping, custom icons and a separate player screen.

MVP enemies can have manual descriptions/statblock links. Automatic statblock retrieval is not promised before examining the source database.

## 5. Full requirements map

**M** — MVP; **R1** — editor development; **R2** — reference library/data integration; **R3** — AI; **R4** — synchronization/further development. R2/R3 order can change after MVP.

| Sketch requirement | Stage | Decision / clarification |
| --- | --- | --- |
| General user settings | M / R3 | Local preferences; AI keys/task routing later |
| Generated-output language | R3 | Set independently of source-text language |
| Several task-specific bots | R3+ | One text provider first, then text/image profiles |
| Map, floors, navigation | M | Several maps with graphical layers inside each |
| Several images on one map | R1 | Independent objects with order, visibility, locking |
| Delete/scale/move images | M | One background in MVP, common coordinate space |
| Context, structured notes, map tags | M / R1 | General text in MVP; extended fields/map tags in R1 |
| Grid / free annotation | M / R1 | Polygon regions first; configurable grid later |
| Region of independent points | M | Coordinates do not belong to the image |
| Right-click creation / double-click | M | Context menu plus visible button; double-click finishes outline |
| Add/delete/move points | M | At least three distinct vertices, closed simple polygon |
| Point chain / overlapping regions | M | Preserve vertex order; list helps select overlapping regions |
| Snap to neighboring regions | R1 | Screen-space threshold, temporarily disableable |
| Color, 40% opacity, undo, whole-region movement | M | 40% fill opacity means 60% transparency |
| Region links / doors / passages | R1 | Typed transitions, including floors |
| Marker categories, constant size, colors | M | Screen size fixed during zoom; symbol/name identify category |
| Custom icon | R1 | Raster user icons, safe import |
| Marker statuses | M | Valid statuses depend on category |
| Anchor/lock, movement, deletion | M | Lock blocks movement, not card access |
| Multiple selected markers | R1 | Group movement as one undo command |
| “Monster owns reward” links | R1 | Typed entity relationship |
| Editable movement log | R1 | Region transitions, not each drag pixel; manual events separately |
| Important/unique entities and library | R1 | One entity, several representations; moving differs from copying |
| Shared marker description | M model / R1 UI | Entity card separated from local position |
| Map number/title, hover notes, full click details | M | User clarification 2026-10-08; touch notes accessible in card; UI-02 later changes hover to summary/tags |
| Database descriptions/statblocks | R2 | Reference adapter; manual descriptions in MVP |
| GM notes, terrain description, Markdown | M | Separate secrets/player text; accepted editor stores rich JSON |
| Player checks | M | Condition/purpose, ability/skill, DC, result; initial proposal made all but text optional; implemented validation is documented in card specs |
| Generate/regenerate description | R3 | Preview; no automatic overwrite |
| Generate terrain/character | R3+ | Separate tasks/prompts after text generation |
| Analyze text into scenes/prompts | R3+ | Proposed bindings confirmed by GM |
| Attachments: add/delete/caption/tags | R1 | Shared image store, card references |
| Image tag search/reuse | R1 / R2 | Project first, then shared library |
| Copy image to clipboard | R1 | Download fallback and browser capability check |
| Labels: add/delete/rename | M / R1 | Filter tags separate from visible map labels |
| Region monsters/rewards linked to icons | M | Compute from placements.regionIds[], no duplicate lists |
| Saving/deletion/search/filters | M | Initially autosave; accepted explicit card saves, deletion undo, project search |
| Generation considers project/region context | R3 | project → map → region → selected entity |
| Standalone bestiary/artifacts/adventures | R2 | Independent reference app; adapter, not full copied database |
| Frontend/backend/database | M / R4 | Frontend + local DB first; server for AI/sync if needed |

## 6. UX and interaction rules

### 6.1. Workspace

The initial workspace is a full-width map with compact controls: project/map, Preparation / Play, navigation/search, saving state and export. Navigation/details start closed after opening a map. Header contains no room/marker/object list.

Region number/title stay visible. Originally hover showed saved GM notes, shortened if long; UI-02 uses summary/tags instead, with full notes in the card. Hover never selects or opens. One click opens the full card: GM notes, player description, checks, related markers, tags and available attachments. Close explicitly; opening preserves zoom/pan.

Navigation opens by button with Regions / Markers tabs, query, scope (map/project), filters and grouping. Tabs change panel contents while the map remains the workspace. Selecting a result opens its map, focuses the object and shows its card. Closing retains filters.

BM-008 name/number/tag search supports current map or project. Filters combine: map/tags for regions; also type/status/linked region for markers. Several tags explicitly use any/all. Regions group by map/tag; markers by map/type/status/linked region. Repeated representations of multi-bound markers open one placement; counts remain unique. Region number/title remain readable under zoom; label overlap needs real-editor assessment.

Map management is a right-header dropdown showing the current name: New map, then rows with independent navigation/rename/delete actions, no nested buttons or hover requirement. Switching resolves dirty cards, closes them and restores viewport. Deletion confirms the name, atomically removes map/content and preserves shared entities/used images. Deleting current opens the next map; deleting last shows creation. Search has no map management: extra filters/grouping expand separately, with persistent active/reset indicators. Map filters do not switch the workspace.

Shared region/marker tag suggestions offer up to five recent or matching project tags, excluding already added ones. Case-insensitive trimmed comparison prevents duplicates; spelling follows the catalog. Arrows/Enter/Escape control suggestions. History changes only after successful card writing, survives reload and remains unchanged on cancel/error. Old projects/imported copies without history use a predictable existing-tag catalog. History lives in settings outside Project/ZIP; at BM-008 IndexedDB 7 / ZIP 6 stayed unchanged. See [navigation-search.md](navigation-search.md).

The v0.2 mockup checks map → hover → click → full card and collapsible navigation. Its data is illustrative; the dungeon diagram is not a book map. Mockup changes do not establish ready storage/editor functionality.

Desktop/laptop mouse/trackpad is first priority. On narrow screens open panels sit above/below the map; complete mobile drawing is deferred. Without hover, one tap opens the card and GM notes. Controls must not rely exclusively on hover/right-click.

### 6.2. Regions

- Add region or context menu starts creation; each single click adds a vertex.
- Double-clicking free space, Enter or Done finishes only a valid outline; the last point is not duplicated.
- Vertices can move during creation. Double-clicking an existing handle deletes it without finishing; deleting from a finished region retains at least three vertices and valid geometry.
- Escape cancels unfinished outlines; drafts are not regions and not exported.
- At least three distinct vertices; zero area/self-intersections forbidden. Different regions may overlap.
- Vertex mode supports edge insertion and deletion while retaining three vertices.
- Whole-region movement preserves shape/description. Bound markers normally stay put because bindings are semantic; joint movement is a later explicit command. UI-01 permits this only within the region card's edit draft.
- Overlap selects the top region; others are accessible from lists. Display order persists.
- Title/tags edit in the card; translucent fill leaves the background visible.
- Palette remains open after choosing color; outside click closes it. Escape closes and returns focus to the color button.

### 6.3. Markers and entities

A marker represents an entity on a map. Adding in MVP creates entity+placement; a later library can reuse an entity.

Enemy/boss: alive, hidden, defeated. Door: open, locked, hidden. Passage: available, blocked, hidden. Reward: available, concealed, collected. Hero/ally/NPC: present, hidden, gone. Text/symbols accompany status, not only color. Hidden is game state; the GM still sees the object. UI-02 adds armed/disarmed traps.

BM-007 bindings are always explicit: select one/several current-map regions or none. Regions under the pointer, including overlaps, are never chosen automatically. Drag preserves bindings. Region deletion removes only its link, retains others and undo restores it.

An NPC's shared description and actual game status belong to Entity, consistent across representations. Position, local label, room binding and lock belong to placement. Ordinary goblins may reference one future template but each has its own entity/status.

Moving a unique NPC to another map changes placement map/coordinates. Another representation adds a placement of the same entity. Independent copying creates another entity. Do not combine these into an ambiguous Duplicate command.

Deleting a region clears its marker links, retaining objects and supporting undo. Deleting a marker removes placement, not automatically Entity. Unused entities remain; their library/separate deletion listing representations is future work.

BM-007 starts a marker with type/point; until Save it is only a draft and Cancel leaves no stored entity. Existing markers open in the BM-006 shared panel's view mode; name, formatted/image description, tags, status, color, regions and lock edit together. Region/marker navigation handles unsaved changes. Icons stay constant screen size; hover shows name/status; marker drag/events cannot open the region beneath. See [model/limits](markers.md).

### 6.4. Notes and Play

Fields: GM notes, Player description, Checks, Objects, Attachments. First four are MVP; separate attachments later. BM-006 explicitly includes images inside both text fields using existing Assets.

Exactly one region panel opens. Empty regions open editing; filled regions viewing. Automatic number/title, color/geometry are not user content; text, customized title, images, checks and tags are. Empty editor blocks are not content. Number/title, both documents, checks/tags, color/opacity share Save/Cancel. Closing/switching dirty cards asks save/discard/continue; failure retains draft. Vertex editing enables explicitly in the same panel without another window.

The visual editor applies commands to selection/block while retaining selection. Clipboard HTML retains supported sanitized styles; plain text stays text; arbitrary website layouts are not guaranteed. File/bitmap images preserve proportions inside text. Documents store assetId; temporary blob URLs are display-only. Removing a reference does not damage a shared Asset. See [model/migration/limits](region-details.md).

Preparation edits geometry/content. Play opens cards, reads prepared content and changes statuses. Geometry requires explicit return to Preparation. Play is the GM's screen and includes secret notes; a separate safe player screen is designed later.

Tags are filterable keywords (trap, faction, important); map labels are title/number. Tags need not appear on the map.

## 7. Data and invariants

The following is the proposed model, not a claim that every future entity is implemented:

| Entity | Main fields | Responsibility |
| --- | --- | --- |
| Project | id, name, rich context, schemaVersion, revision, createdAt, updatedAt | Adventure/context |
| Map | id, projectId, name, rich description, order, coordinateBounds | Map/floor |
| ImagePlacement | id, mapId, assetId, x, y, width, height, rotation, order, locked, visible | Image in map coordinates |
| Region | id, mapId, vertices[], order, number, title, titleCustomized, gmNotes, playerDescription, checks[], tags[], color, fillOpacity; UI-02 shortDescription | Shape/content; rich documents reference assetId |
| Entity (BM-007) | id, projectId, kind, name, description, status, tags[]; UI-02 checks[] | Character/door/reward and shared state; rich description references assetId |
| MarkerPlacement | id, mapId, entityId, regionIds[], x, y, color, locked, order | Representation; several same-map regions |
| Asset | id, projectId, mimeType, byteSize, pixelWidth, pixelHeight, checksum, caption?, tags[], blob | Shared original image |
| Reference | sourceId, recordId, kind, sourceVersion?, cachedSnapshot? | External reference record |
| Relation (R1) | id, projectId, fromId, toId, type, notesMd | Transition/ownership/alliance/etc. |
| MovementEvent (R1) | id, entityId, placementId, fromMapId, toMapId, fromRegionId?, toRegionId?, occurredAt, note, origin | Transitions/manual events |
| UserSettings | interfaceLanguage, generationLanguage, preferences | UI preferences; no secrets |

IDs are stable. Coordinates are numbers in map space; screen zoom/pan is separate view state. Initially place an image at (0,0), treating original pixels as starting units. Scaling changes ImagePlacement, not all project coordinates.

Invariants:

- Region/bound placement belong to one map; entity/map belong to one project.
- No missing asset/entity/map references; deletion is a coordinated command.
- Valid polygon, finite coordinates, opacity 0…1.
- Unique expresses intent to use one entity, not a prohibition on several representations; UI distinguishes movement from another representation.
- Store project documents/assets, not a serialized Konva business model.
- User changes support undo/redo; one drag is one command, not hundreds of records. MVP history may reset on reload.
- R1 important-object library starts project-local; no implicit cross-project shared editing.

## 8. Technical approach

### 8.1. MVP on one device

Initial proposed stack: React + TypeScript + Vite; Konva/react-konva for maps; IndexedDB; Vitest logic and Playwright key scenarios. Dependency versions are chosen/pinned at repository creation after compatibility checks.

Konva was selected as an interactive-geometry candidate: its official React example covers selection/movement/resizing. A small polygon/zoom/large-image prototype was required before final adoption. Notes/lists remain HTML, not canvas.

```text
UI (React panels/canvas)
  → application (commands, undo/redo, validation)
  → domain (projects, geometry, entities, rules)
  → ports (ProjectRepository, AssetRepository, ReferenceProvider, GenerationProvider)
  → adapters (IndexedDB/archives; later API/providers)
```

Suggested minimal layout (actual feature directories evolved with implementation):

```text
src/domain/             models and pure functions
src/application/        commands and scenarios
src/storage/            IndexedDB, migrations, export/import
src/features/projects/  project listing/opening
src/features/map/       canvas, viewport, regions, markers
src/features/inspector/ object cards
src/features/search/    search and filters
src/shared/             shared controls
docs/                   design, tasks, decisions
tests/e2e/              persistence and core scenarios
```

No microservices, universal plugin system or speculative server. Clear data/storage boundaries matter. Stable IDs/revision help future synchronization but do not implement it.

### 8.2. Saving and portability

IndexedDB stores structured data/image blobs. UI-03 context, map description and object cards use common drafts and explicit Save/Cancel; new images save with documents. New projects exist only in memory until Save; cancellation writes nothing. Geometry saves on command completion. UI states: Changed, Saving, Saved on this device, Save failed; failures never masquerade as success. Export first resolves changed cards.

UI-01 lets both tabs edit with Web Locks temporarily disabled; transactional revision checks prevent concurrent stale overwrite. There is no collaboration/synchronization. Silent last-write-wins is unacceptable for notes.

Backups are ZIPs with manifest.json, project.json, assets/. Manifest specifies version, files, sizes/checksums. User settings/AI secrets are excluded; export takes a consistent snapshot.

Import validates version, structure, references/content and count/size limits. New formats are not interpreted as old ones. Only after validation create an independent project with consistent remapped IDs. Errors retain existing projects. Import merging waits for a separate clear scenario.

Schema changes require migration/old-data export planning. Browser storage belongs to origin/profile; changing domain/port does not transfer it. Stable app URLs and backups are operational requirements.

Browser quotas/eviction vary. Persistent-storage requests may be declined and do not replace export. Quota errors preserve the saved snapshot and allow retry or export of available data. This follows from local storage, not a need for cloud.

### 8.3. Images and performance

Start with raster uploads, not SVG/PDF. Verify decoding, MIME and dimensions. Store originals as Assets and derive previews separately. Do not draw all full attachments simultaneously; release object URLs on close.

Preliminary acceptance targets, requiring measurement on the user's device: 4096×4096 map, 100 regions, 200 markers; selection under 200 ms; pan/zoom without noticeable stalls. These are a test budget, not proven performance or guaranteed limits. Approve file limits after prototype/memory evaluation.

## 9. Reference library and existing project

Sketches mention a bestiary/artifact/adventure app but provide no code, records or API. Its technology, ID stability, model and content-use rules are unknown; integration cannot yet be called ready/easy.

First R2 step: inspect a small anonymized creature/item/adventure example plus storage/startup, then choose:

| Existing reference source | Preferred integration |
| --- | --- |
| Local JSON/other files with stable IDs | Importable package and read adapter |
| App with API | API adapter, local selected-record cache |
| UI only | Manual links/export first; automation needs separate work |

The reference app remains independent: search → record → statblock. Bounty Mapper stores references and optional offline snapshots. Source updates are offered, not silently substituted over edited content. Map/user notes remain usable if reference source is unavailable.

Actual enemy state belongs to Entity; species parameters such as goblin belong to templates. Integration must not duplicate full records in every region. Distribution rights for bundled materials are checked before public distribution; this does not block manual local MVP notes.

## 10. AI as preparation assistance

First AI iteration: text only, one provider, one Player-description draft task, after testing the editor in a game.

Flow: select region → open generation → inspect included context → choose language/tone/length → request draft → compare → accept/insert alongside/reject. Regeneration creates another variant. Canceling may not cancel incurred cost; UI must not promise that.

Context: project description → map notes → selected region → explicitly selected objects. Tags/neighbors are optional, never the whole adventure by default for every room. GM notes may contain secrets: player-text generation is instructed to omit them, but the GM must review the result.

Later profiles: textGeneration/imageGeneration, possibly different providers. Profiles contain provider/model/language/task parameters. Key secrets remain outside projects/archives/URLs/logs.

Proposed API-key approach when adding AI: backend/BFF receives tasks and calls providers. Single-owner servers can use environment keys; public BYOK requires user-secret management/access isolation. Direct browser integration is not declared universally safe: browser support, CORS and provider rules need checking.

Then terrain/character image generation → normal Asset → variants/captions; later text analysis proposes scenes/regions/prompts. Generated bindings are confirmed; AI never automatically changes geometry/game state.

Requests need states, context/cost limits, refusal handling, accepted-result logs and prompt versions. Exact models/prices/parameters are selected at integration, not fixed in advance.

## 11. Roadmap and checkpoints

Completion of scenarios determines the plan, not promised calendar dates. AI-assisted development uncertainty comes mainly from integration, fixes and feedback, not code-generation speed.

| Stage | Result | Advancement criterion |
| --- | --- | --- |
| P0: design/prototype | This document, mockups, questions, canvas/storage probe | Clear scenario, MVP boundaries and risky assumptions |
| M1: project/image | Create project/map, upload, pan/zoom, save, early export | Reload/round-trip preserve image/context |
| M2: regions/notes | Polygon, editing, Markdown (later visual editor), undo | A real map can be annotated/saved |
| M3: objects/play | Markers, region bindings, statuses, search, Play | Room flow without external notes |
| M4: session readiness | Import, errors, offline, migration, backup | Prepare/run one adventure and restore data |
| R1: editor improvements | Many images, relations/transitions/attachments, important NPCs, log, grid/snap | Address observed preparation problems |
| R2: reference library | Standalone library, map references/cache | Direct/room access without duplicated state |
| R3: AI | Text, then images/analysis | Drafts reduce preparation without damaging material |
| R4: devices | Accounts, server, files, sync, backup | Correct transfer, explained/resolvable conflicts |
| R5: demand validation | Small external group, usage observation | Reuse and clear requests before expansion |

R1 is a prioritization set, not one huge release. After a session choose the one/two most obstructive limits. R2/R3 may swap. R4 requires an actual second-device need; a server does not imply public availability.

## 12. First development tasks

Each row is a small vertical outcome: working UI/data/checks together. Split large tasks before assigning an agent.

| ID | Task | Depends on | Acceptance |
| --- | --- | --- | --- |
| BM-001 | Repository/app/startup documentation | — | Startup opens, build/typecheck/lint pass, reproducible instructions |
| BM-002 | Project/Map/Asset, IndexedDB repository | 001 | Project after reload; rejected write shows no success |
| BM-003 | Image upload, canvas, viewport | 002 | Image visible; pan/zoom preserve world geometry; reload |
| BM-004 | First export/import archive, schemaVersion | 003 | Copy contains image/notes; corrupt archive leaves DB unchanged |
| BM-005 | Polygon creation/editing | 003 | 3+ vertices, Escape, closure, movement, undo, reload |
| BM-006 | Label, hover, single visual-editor card | 005 | Empty edit/filled view, Save/Cancel, safe HTML/images, Markdown migration, stable viewport |
| BM-007 | Entity/MarkerPlacement and bindings | 006 | Different enemy/door statuses, locking; region deletion retains NPC |
| BM-008 | Collapsible Regions / Markers navigation | 007 | Map first; no header list; search/filters/grouping; correct map/card |
| BM-009 | Play | 007 | Geometry protected, statuses save, notes accessible |
| BM-010 | Storage/archive/offline reliability | 004–009 | Full round-trip, atomic quota/import failures, tab protection, production offline reload, explicit updates, real old-schema migrations |
| BM-011 | Game pilot/next backlog | 010 | Observations/decisions; next iteration based on a concrete problem |

**First technical investigation:** polygon hit-testing, zoom/pan, coordinates and blob persistence on one image with several regions. It may be early BM-003 work; do not turn it into an editor library.

**First completed slice:** BM-001…004 opens the app, creates a project, uploads a map, writes context, reloads, exports/restores. It validates the foundation but is not yet the GM's MVP.

### BM-010 implementation and acceptance history

Save is confirmed by completed transaction; failures retain drafts and allow retry without viewport changes. Background replacement/removal and successful retries retain map camera; fit is first opening or explicit Show entire map. Documents/images/entities/placements/revision write atomically. Serialized context writes and transactional revision checks prevent stale overwrites. Quota, permission, unknown database version and failed migrations are explained; no database clearing.

UI-01 temporarily disables single-editor tabs through projectLocksEnabled=false; banners/ownership transfer are hidden. BrowserProjectAccess remains isolated for one-setting reactivation. Both tabs edit without synchronization; stale transactional writes are rejected with drafts retained. The user explicitly authorized merging the full BM-010 snapshot with accepted UI-01.

Production caches the entire local shell and lazy canvas/editor resources. After first online opening and Ready to work offline, the same HTTPS/localhost origin/profile reloads offline. Maps/attachments use IndexedDB. Dev installs no offline shell. Updates wait for Apply update; drafts, writing and tools block it. Other tabs never auto-reload; their old resources remain.

BM-010 retained **IndexedDB 7 / Project 1 / ZIP 6**. Real old Markdown/single bindings migrate without loss; failed upgrade fully rolls back. ZIP verifies structure, size limits, SHA-256 and links before atomic independent-copy import/remapping. Settings/viewport excluded. No new dependencies. See [details/checks/limits](reliability-offline.md).

## 13. Working with AI agents

### Responsibilities

The user owns product usefulness, real-scenario acceptance and priorities. The primary agent implements one agreed task and assembles the result. A second agent may provide independent review/checks when authorized. Parallel modules require agreed boundaries/contracts; agents must not simultaneously rewrite shared models.

This was the proposed development process at the initial design step, which did not launch a complete product or parallel agent team. Current repository instructions and explicit user scope govern actual work.

### One-task cycle

1. Define concrete behavior, input and acceptance.
2. Read code/docs/local rules and propose a narrow plan.
3. Implement on a separate branch without unapproved scope expansion.
4. Check behavior/tests and report failures honestly.
5. Independent review for risky storage/import/geometry/migration changes when agreed.
6. User checks preview using a short scenario; fix issues in the same task.
7. After acceptance, commit/merge only through the agreed repository process; update tasks/decisions.

Do not ask an agent to build the whole document. Assign one demonstrable task; the app must remain runnable after every step.

### Agent task template

```text
Project: Bounty Mapper.
Read docs/product-design.md, AGENTS.md and the relevant implementation.
Task: [BM-ID and concrete user behavior].
Included: [narrow list].
Constraints: [deferred work; existing contracts].
Acceptance: [observable actions/results].
Check: [appropriate build/typecheck/lint/tests and manual scenario].
Do not change storage format without migration. Do not add API keys or
real adventure materials. Check documentation before asking about ambiguity;
list significant product decisions separately.
Deliver: working slice, changes, check results, limitations and short manual steps.
```

### Original AGENTS.md requirements

- One task/PR — one clear scenario.
- Domain independent of React, Konva, storage.
- Project data separate from UI state/previews.
- Every format change has a version/migration decision.
- No false Saved state or automatic data overwrite.
- Commands, agreed tests/readiness documented in README.
- No unnecessary dependencies without explaining need.
- Models/public contracts require documentation updates.
- Review checks data preservation, zoom coordinates and real flows, not only style.

These were proposed requirements, not an installed instruction file at design time; only confirmed rules were carried into the repository.

## 14. MVP quality and acceptance

Focus checks on costly loss and subtle problems:

- Map UX: no forced card/list, hover preserves selection, one click opens details, number/title visible, panel close retains viewport, two-tab search reaches another map.
- Geometry: screen↔world, valid outline, shape-preserving drag, correct hit-testing after zoom.
- Data: save/reload, images/references in export/import, atomic failed import, migration.
- Game: room → description → enemy → status → reward → reload.
- Undo: region/marker create/delete/move, one action per undo; familiar separate text undo.
- Errors: unsupported image, unavailable/quota storage, invalid archive, unknown version.
- Secrets: Markdown/scripts are not executable; AI keys excluded from archive/repo; no claim of safe player view.
- Accessibility: named controls, visible focus, list alternative to canvas, Escape/Enter, status beyond color.

Final acceptance: two maps, at least five regions, NPC/enemy/door/reward; general/local notes; search; real session; export/restore into a clean test profile. No lost content, images, geometry or statuses.

## 15. Deciding whether to develop further

Before the pilot, record ordinary book/note lookup tasks: room description, enemy, check, reward. Repeat comparable tasks after map preparation. Compare convenience/time without promising “twice as fast.”

After the first session record external-app exits, misplaced information, accidental changes, repeated entry and map preparation time. No data loss is mandatory; preparation savings require observation.

Later external pilot: several GMs prepare their own maps and return next session. Study repeat use/real limits before public-service/payment decisions. Personal MVP analytics can be manual.

## 16. Open decisions

| Question | Working assumption | Decision point |
| --- | --- | --- |
| Repository/environment | Separate Bounty Mapper repo, local startup/preview | Before BM-001 |
| Test adventure | One user-used real map, kept outside repository | Before BM-003/pilot |
| Images per map | One MVP, several R1 | Fixed for MVP; review after session |
| Existing database format | Unknown; need example/code/export | Before R2 |
| Reference versus AI priority | Choose the larger preparation obstacle | After MVP |
| Grid/game-unit scale | Outside MVP; independent visual annotation | Before R1 grid |
| AI provider/budget | Not selected | Before R3 |
| Sync source of truth | Local DB in MVP; conflict strategy undecided | Before R4 |
| Player display | GM screen only, separate safe view later | Confirmed need |

## 17. Initial next actions

1. Test v0.2 mockup on a room: map first, label, hover, click card, Regions/Markers search.
2. Clarify first-slice boundaries and select a test map.
3. Create separate repo, move design into docs/, add README/confirmed agent rules.
4. Implement BM-001…004 and verify saving/restoration.
5. Add regions/markers/Play one task at a time.
6. Pilot, prioritize improvements, then AI/integrations.

### Starting local development in VS Code

1. Create bounty-mapper folder and open via File → Open Folder.
2. Place this document in docs/product-design.md and source sketches in docs/mapper.md. Editor agents need explicit file access; chat history is not automatically repository context.
3. Open Codex in VS Code; install the official extension/sign in if needed. Reference: [Codex IDE extension](https://developers.openai.com/codex/ide/).
4. Check node --version, npm --version, git --version; install missing tools. Project compatibility is checked in BM-001.
5. First task is only BM-001: React/TypeScript/Vite scaffold, README, agreed AGENTS rules, startup/check commands. Initial UI is compact controls/empty map, no demo database/open sidebars. Initialize Git; publication/commits require agreed authorization.
6. Start/check in browser; later tasks: local project → upload/pan/zoom → save/export → regions → hover/card → markers → search → Play.

One development agent suffices initially. Review attaches to completed slices; parallel work needs independent agreed tasks. AI settings inside Bounty Mapper are unnecessary for coding-agent operation.

## 18. Primary technical sources

Sources were checked for v0.1; they describe tool capabilities, not substitutes for prototypes/tests.

- [IndexedDB API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API): structured browser data/blobs.
- [Storage quotas/eviction — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria): quotas, errors, eviction.
- [StorageManager.persist() — MDN](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist): persistent storage may be declined.
- [React Transformer — Konva](https://konvajs.org/docs/react/Transformer.html): selection/movement/resizing.
- [Pointer-relative zoom — Konva](https://konvajs.org/docs/sandbox/Zooming_Relative_To_Pointer.html): zoom at pointer.

## Decision log

| Date | Decision | Basis |
| --- | --- | --- |
| 2026-10-07 | Personal use first | User answer |
| 2026-10-07 | One device first, synchronization later | User answer |
| 2026-10-07 | AI after editor | User answer |
| 2026-10-07 | Separate maps/floors from graphical layers | Requirements analysis proposal |
| 2026-10-07 | Separate Entity / MarkerPlacement | Shared descriptions/transitions proposal |
| 2026-10-07 | Image-inclusive export in MVP | Verifiable local-storage proposal |
| 2026-10-07 | No backend before AI/synchronization | Agreed personal MVP proposal |
| 2026-10-08 | Map first, panels on request | User clarification |
| 2026-10-08 | Number/title, hover notes, full one-click card | User clarification; later hover revised in UI-02 |
| 2026-10-08 | Regions / Markers navigation, search/filters/grouping | User clarification |
| 2026-10-09 | Accepted BM-005: creation-time vertex movement, double-click handle deletion without completion, persistent palette until outside click | Manual acceptance |
| 2026-10-09 | BM-006 before acceptance: one HTML panel, shared Save/Cancel replaces card autosave, dirty-transition decisions, separate text undo | Explicit user instruction; [details](region-details.md) |
| 2026-10-09 | BM-006 Tiptap WYSIWYG, sanitized HTML/plain/bitmap paste, Asset images, one rich JSON; IndexedDB 5 migrates Markdown v4, ZIP 4 reads v1/v2/v3 | User clarification/compatibility; [format](backup-format.md) |
| 2026-10-09 | BM-006/refinements manually accepted; BM-007 next | User confirmation |
| 2026-10-09 | BM-007 independent Entity/Placement, manual bindings, shared draft/images, fixed icon size; IndexedDB 6 stores, ZIP 5 reads v1…4 | User task; [details](markers.md) |
| 2026-10-10 | BM-007 camera retained on write/clear/resize; draft marker movement; right-click type submenu; multiple regionIds, IndexedDB 6→7 / ZIP 5→6 migrations | User clarification; [details](markers.md) |
| 2026-10-10 | Region ↔ marker links center without zoom changes after resolving drafts; ordinary map opens retain view | User clarification; [details](markers.md) |
| 2026-10-11 | BM-007 accepted: stable viewport, draft movement, multi-bindings/migration/partial unlinking, submenu, two-way centered links | Manual acceptance |
| 2026-10-11 | BM-008 separate tab state, search/AND filters/OR-AND tags, agreed groups; shared draft-aware navigation, per-map view memory, scale-preserving centering, map create/rename without schema change | User task; [details](navigation-search.md) |
| 2026-10-11 | BM-008 refinements: header map menu, confirmed atomic deletion preserving shared data, compact search, common tags; transactional settings history/fallback without new version | User task; [details](navigation-search.md) |
| 2026-10-11 | BM-008/refinements accepted; BM-009 next | User confirmation |
| 2026-10-11 | BM-009 before acceptance: per-project settings mode, Preparation default, Play geometry guard/view cards, atomic Entity statuses/separate undo, stable viewport; versions 7/1/6 unchanged | User task; [details](play-mode.md) |
| 2026-10-11 | BM-009 accepted; BM-010 reliability/backups/offline next | User confirmation |
| 2026-10-11 | BM-010 before acceptance: Web Locks single editor/reread on ownership, quota/version/migration errors, real-format/full ZIP round-trip, production precache/explicit protected update, no schema/dependency changes | User task; [details](reliability-offline.md); Web Locks later disabled by UI-01 |

### UI-01 — compact controls, manually accepted

Header: burger, project/information for previous context, mode, search, map menu right. Projects/import/export live in the burger; backgrounds in map menu with target name/deletion confirmation. Creation, undo/redo and camera tools are grouped over the visible workspace without panels obscuring them.

Existing regions move only in their card's overall edit mode; no separate movement mode. Movement joins Save/Cancel/transition protection; failure retains draft. Bound markers stay put. In view/Play/closed-card states, dragging inside regions pans. Vertex/creation rules remain. Data/viewport independent; IndexedDB 7 / Project 1 / ZIP 6 unchanged. [UI-01](ui-controls.md).

### UI-02 — cards, tooltips and traps, manually accepted

Shared adjustable right-panel width persists as UI preference; width/window changes retain camera/draft. Shared compact editor has More. Region.shortDescription is plain multiline; hover uses it/tags instead of GM notes. Badges show five tags plus remaining count. Entity.kind=trap has armed/disarmed statuses and Entity-owned RegionCheck-compatible checks with required positive integer DC. All menus, bindings, search, Play, storage/archive support it. IndexedDB 8 / Project 1 / ZIP 7; old fields become empty in atomic upgrade. [Full UI-02 task/implementation/manual check](ui-cards-tooltips-traps.md).

Accepted October 11, 2026. Repeated typecheck/lint/build, 164 unit tests and 40 Edge scenarios passed. Next UI-03: formatted context/map descriptions and confirmed project deletion.

### UI-03 — adventure context, map description and project deletion, manually accepted

UI-03/fixes accepted. Repeated typecheck/lint/build, 176 unit tests and 43 production Edge scenarios passed; no new features added during finalization.

Hosting: GitHub Pages via Actions, Node.js 24, lockfile install/checks before publishing dist/. Production-only base preserves local root startup. Worker/cache separate by shell path; IndexedDB remains origin/profile bound. Localhost transfer requires ZIP export/import. IndexedDB 9 / Project 2 / ZIP 8 unchanged by hosting; no accounts/server storage. Addresses/update flow: [README](../README.md#github-pages).

Project/map information buttons open saved content in the shared right panel. Map name appears in its heading; shared width and stable viewport. Preparation provides filling/editing with the same visual editor/Save/Cancel; Play renders formatting/images only. Closing, object/map/project/mode changes use three draft choices; previous-object tools stop after resolution. Map switching updates open descriptions to target content.

IndexedDB 9 / Project 2 / ZIP 8 replaces actual Markdown contextMd/notesMd with sole Project.context / Map.description documents. Plain text/line breaks survive; HTML is not interpreted; existing parser converts old Markdown without reconverting rich documents. Upgrade atomic; ZIP 1…7 supported. Both documents/original images archived with remapped assetId. New maps have empty descriptions; nonempty old imports survive.

Each project menu offers confirmed named deletion with consequences. Maps/regions/placements/entities/assets/project settings delete atomically while preserving other projects. Resolve current drafts first; success opens list. Failure keeps old snapshot/retry, concurrent duplicate operations prevented. Assets are not cross-project; context/description references count for background/map deletion. No trash. [UI-03 checks/limits](ui-project-map-context.md).

### Localization — manually accepted

English is the default without a saved preference; Russian remains available as Русский. The burger offers English / Русский without flags. Switching immediately updates every interface label and html.lang while preserving project/map, viewport, search, selection, open card and live drafts. The browser-origin language preference persists separately from projects, is not archived, and is retryable on storage failure. Generation/adventure text is never translated. Stable dictionary keys support parameters and locale plural rules; type/status stored values are unchanged. Human-maintained documentation is English, with intentional historical migration literals and Russian fixtures retained.

For a selected map without a background, Preparation shows a centered Add a map image prompt, PNG/JPEG/WebP formats and Add map image using the existing upload input/validation/transaction flow. Cancel leaves data unchanged; errors allow retry; success removes the prompt, removal restores it. Existing objects remain interactive outside the button. Play shows only a no-background message. No project/map uses its existing empty state. **IndexedDB 9 / Project 2 / ZIP 8 remain unchanged; no dependencies, external services or network translation.** The user manually accepted localization and the empty-map state on October 12, 2026 and authorized ordinary merging and production publication after passing checks. See [localization.md](localization.md).
