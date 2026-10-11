# Bounty Mapper backup format v8 (reads v1…7)

UI-03 adds the sole rich documents `Project.context` and `Map.description`, including embedded images. v1…7 / Project 1 archives convert real Markdown contextMd/notesMd fields; v8 requires Project 2. Asset references are validated and remapped in copies. See [UI-03](ui-project-map-context.md).

UI-02 added `Region.shortDescription` and `Entity.checks`. v1…6 archives receive empty values; current archives require the new fields. Trap (`trap`) is supported since v7, with required positive safe-integer dc in its checks. Entity check IDs are also remapped on copy import. Card width is excluded. See [UI-02](ui-cards-tooltips-traps.md).

ZIP contains `manifest.json`, `project.json` and `assets/<number>.png|jpg|webp`. Empty assets/ is allowed and exported even without images. fflate writes/streams ZIP decompression; it is not part of the domain model.

BM-009 retained v6: confirmed game status remains Entity.status and joins the snapshot with description images. Preparation / Play and undo history are UI settings excluded from ZIP; copies start in Preparation. Older archives continue through their migrations, including single marker bindings.

`manifest.json`:

```json
{
  "format": "bounty-mapper-project",
  "formatVersion": 8,
  "createdAt": "2026-10-08T00:00:00.000Z",
  "files": [
    { "path": "project.json", "byteSize": 1234, "sha256": "<64 hex characters>" },
    { "path": "assets/0.png", "byteSize": 5678, "sha256": "<64 hex characters>" }
  ]
}
```

Sizes are uncompressed bytes; SHA-256 uses original bytes. Manifest lists every content file, including project.json. It does not hash itself; an empty directory is not a content file. Extra files, duplicate paths, missing entries and mismatched sizes/checksums are rejected.

Current `project.json` has exactly seven fields:

- `project`: id, name, context (rich JSON), schemaVersion, revision, createdAt, updatedAt.
- `maps`: all project maps with id, projectId, name, description (rich JSON), order, coordinateBounds.
- `imagePlacements`: id, mapId, assetId, x, y, width, height, rotation, order, locked, visible.
- `assets`: original metadata — id, projectId, mimeType, byteSize, pixelWidth, pixelHeight, checksum, tags, optional caption and archive path. JSON contains no Blob; bytes live in assets/.
- `regions`: all saved regions with id, mapId, vertices[{x,y}], order, number, title, color, fillOpacity, titleCustomized, gmNotes, playerDescription, checks, tags and shortDescription. gmNotes/playerDescription use rich JSON `{type:'doc',content:[...]}`; images use `{type:'image',attrs:{assetId,alt}}`. A check has exactly id, condition, ability, result and optional dc. Drafts are excluded.
- `entities`: id, projectId, kind, name, rich description, status, tags, checks. Existing kinds have empty checks; traps use id/condition/ability/dc/result. Includes entities without placements. [Types/statuses](markers.md).
- `markerPlacements`: id, entityId, mapId, x, y, color, locked, order, required regionIds[]. An empty list means unbound; several regions may be selected. Description/status are not duplicated. Unsaved markers/entities are excluded.

Export produces external version 8 / Project.schemaVersion 2. Import accepts it and versions 1…7 / Project 1, converting old fields. v1 strictly validates the old four fields without regions, then adds regions=[]. v2 requires regions and strictly validates their eight old fields, then adds empty documents/checks/tags. v3 requires gmNotesMd/playerDescriptionMd/checks/tags; Markdown converts with supported formatting and Md fields do not remain a second text copy. v4 requires documents/titleCustomized. Old titleCustomized is determined against the historical Russian automatic title `Область N`. v1…4 lack entities/markerPlacements and receive empty collections after validation. v5 requires seven fields and the former placement structure with optional regionId; a link becomes regionIds=[regionId], absence becomes []. v6 requires seven fields and regionIds, without legacy regionId. v7 requires region shortDescription and entity checks; v1…6 get empty values without copying notes. v8 replaces Project.contextMd / Map.notesMd with sole context/description documents; reading converts Markdown and empty descriptions become empty documents. Unknown versions/fields are rejected. UI settings, camera, selection, unsaved forms, undo history and extra secret fields are absent. Export uses an explicit domain-field allowlist, including checks. Save/cancel a changed card before snapshotting.

Validation checks required types, nonempty IDs/names, valid dates, finite coordinates, positive dimensions, integer revision/order, unique IDs/paths. Maps/assets belong to one project; each placement references existing map/asset; each map has one background. Several maps may share an asset. Empty maps and assets without active placements are retained.

Every region has unique id, existing mapId, positive integer number, nonempty title, hex RGB color and fillOpacity 0…1. Polygons pass the editor's simplicity/area/vertex checks. Correct checksums do not make invalid geometry/references acceptable. Different regions may overlap. Project limits: 2048 regions, 65536 vertices total, 512 vertices per region, absolute coordinates at most 1e9. See [regions.md](regions.md).

Import checks the ZIP directory before extraction, supports Store/Deflate and rejects ZIP64/encryption. Only the two service JSON files and numeric assets/ paths are allowed; nothing is extracted into the filesystem. Small input chunks are decompressed with actual output-size checks; falsely small header sizes cannot bypass limits.

Limits: ZIP 128 MiB, expanded total 256 MiB, image 64 MiB, project.json 4 MiB, manifest.json 512 KiB, 512 ZIP entries, 128 maps, 256 assets. Image dimensions are capped at 64×1024×1024 pixels; after SHA-256/MIME/signature checks, decoding verifies actual dimensions against metadata.

Each entity belongs to the project, has permitted kind/status and a valid rich document. Each placement references existing project map/entity; every regionIds entry points to a region on the same map. The list allows up to 2048 unique nonempty IDs; duplicates/missing references are forbidden. IDs are unique within each collection. A project allows 4096 entities and 4096 placements. Color is hex RGB, locked boolean, order a nonnegative safe integer, coordinates finite with absolute values ≤1e9. Images in Project.context, Map.description and Entity.description must reference project assets. Invalid links/statuses are rejected despite correct checksums.

Only after all checks is an independent copy created: new projectId, mapId, assetId, placementId, regionId, entityId, markerPlacementId and check IDs. Every reference is remapped, including all regionIds, entityId and image.assetId inside adventure context, map descriptions, region text and entity descriptions. The project receives a localized copy suffix, revision 1 and new timestamps; other user data/original images remain unchanged. The whole copy then writes in one IndexedDB transaction. Validation failure starts no write; transaction failure leaves no partial copy and changes neither existing projects nor active selection.

New fields are validated even with correct checksums: only allowed rich JSON nodes/marks/attributes, safe links and existing project image.assetId. Document limits: 10000 nodes, depth 32, 262144 text characters, 524288 JSON characters. Check text is at most 262144 characters; a region allows up to 256 unique-ID checks with optional nonnegative safe-integer dc and 256 unique nonempty tags of up to 120 characters. Trap DC has the stricter positive-required rule above. Arbitrary HTML/blob URLs are not stored text formats. See [region-details.md](region-details.md).

Tests cover multi-map round-trip with/without images; region/marker/entity fields; metadata/bytes; independent copies; consistent snapshots; latest text before export; no drafts; flush refusal; old versions; corrupt archives/unknown versions; invalid geometry/links/statuses/sizes; decompression limits; late writes. Browser scenarios download ZIPs and import real images/regions/markers in Edge. Interface language remains local UI metadata and adds no archive field or schema version.
