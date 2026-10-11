# Bounty Mapper development rules

- Before working, read `docs/product-design.md`, `README.md`, and the affected code. The user's explicit instructions determine the current scope.
- One iteration / task / PR covers one clear user scenario with observable acceptance criteria. Implement only the agreed BM-ID; do not start subsequent tasks automatically.
- Keep the application runnable after every iteration. The initial screen is a map with compact controls; navigation and cards stay closed until an explicit user action. Do not add a demonstration object database.
- The first interface version was Russian. The current agreed interface supports English (the default without a saved choice) and Russian. Controls must have clear names, visible keyboard focus, and honest availability states.
- Work on a separate branch. Do not commit, merge, push, or publish without an agreed process or the user's explicit instruction.
- Domain code must not depend on React, Konva, or a concrete storage implementation. Add layers and directories when the task requires them; do not implement future architecture in advance.
- Separate project data from UI state (selection, panels, viewport) and image previews. Do not use the canvas tree as the business model.
- Document model and public contract changes. Every storage format change must include an explicit versioning and migration decision.
- Do not show “Saved” before a write is confirmed. Do not overwrite data automatically or conceal storage and import errors.
- Do not add API keys, secrets, or real adventure materials to the repository. AI, servers, and synchronization belong only to their corresponding future tasks.
- Add dependencies only when required by the current scenario and explain their purpose. Pin versions and update the lockfile together with `package.json`.
- Before delivery, run `npm run typecheck`, `npm run lint`, and `npm run build`. Verify behavior with a short manual scenario; add meaningful tests for new logic and risks, rather than tests that repeat markup.
- Independent review is especially useful for storage, import, migrations, and geometry: check data preservation, coordinates under zoom, and real scenarios. Delegation and parallel work require agreed task boundaries.
- Report what changed, verification results, limitations, and manual verification steps. Update README when commands change; record significant product decisions in the documentation. When something is unclear, look for the answer in documentation and code first.
