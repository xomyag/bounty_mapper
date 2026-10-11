# English and Russian interface localization

This iteration was manually accepted on October 12, 2026. The user authorized committing `bm-i18n-english`, an ordinary merge into main and production publication through the existing GitHub Pages workflow after passing checks. Scope: interface localization, English human-maintained documentation and the central upload action for an existing map without a background. No backend, translation service, account/synchronization or adventure translation.

## Preference and rendering

English is default when no valid preference exists. The burger has English / Русский radio menu items without flags, with visible focus/active state and keyboard/touch support. Switching immediately changes interface labels and document.documentElement.lang, retaining project/map, selection, search/filter state, viewport, open card and current draft/editor instance. Reload restores language from browser-origin localStorage key `bounty-mapper:interface-language` (en/ru). A write refusal displays a localized error while keeping the selected language; selecting again retries.

`src/i18n/en.ts` and ru.ts have identical stable keys. Parameters are validated; counters use Intl.PluralRules for English/Russian forms. React reads the language snapshot through useSyncExternalStore. The main entry initializes preference before render. Non-React session/domain error messages use a pure deferred message descriptor; UI resolves it at render so an already visible error switches language too. Plain user strings are not dictionary keys and are not translated. No dictionaries are fetched over the network; both are in the production/offline shell.

New automatic map/region/marker names and imported-copy suffixes use the language at creation. Existing names/content are never rewritten on switching. Model kind/status values, user conditions/skills/results and arbitrary adventure text remain stable. Historical Russian automatic-title comparisons/image placeholders are retained for legacy migration fidelity. Russian test fixtures and the Russian dictionary intentionally remain Russian; maintained documentation, comments and test descriptions are English.

## Data and compatibility

Language is separate UI state, excluded from projects/backups. **IndexedDB 9 / Project.schemaVersion 2 / ZIP 8 are unchanged**; no migration, store/index or dependency was added. Export/import continues to remap links and preserve user data; a copied project uses the browser's interface choice without importing someone else's preferences.

## Central image upload

For a selected existing map without background, Preparation shows Add a map image, PNG/JPEG/WebP guidance and Add map image centered in the visible workspace. It opens the same hidden image-file input as existing menu upload. Cancel leaves everything unchanged. MIME/signature/decode/size checks, original Asset storage and atomic transaction/retry semantics are reused. A successful write hides the prompt; removing the background restores it. Existing regions/markers remain. The overlay does not intercept canvas gestures; only its button accepts pointer input and stops propagation to canvas tools. Play shows a localized no-background message and no upload action. No project/map retains its existing empty state.

## Verification

Unit tests check dictionary key/parameter parity, default/restored language, failed preference persistence/retry, nested deferred errors without user-string translation and plural forms. Browser tests check a live editor draft and identity during switching, reload, both languages' central upload/errors, region/marker/trap cards/check validation, search, status, ZIP round-trip, confirmation, Play restrictions and narrow layouts. Existing geometry/storage/archive/viewport regressions explicitly use Russian. pages-hosting checks scoped assets/worker/icons, offline reload and offline English switching with unchanged user content.

Pre-acceptance verification on October 12, 2026: typecheck, lint and production build passed; all 183 unit tests passed. The complete production browser run passed 46 scenarios, with the Pages-only scenario skipped in the root run and passed separately under `/bounty_mapper/`. After final literal-user-text protection, the 12 affected localization/card/Play scenarios passed again. Central upload cancellation, quota failure/retry and frame-by-frame viewport preservation were verified in both languages. Wide/375 px screenshots were inspected. Both root and Pages builds passed; the final local dist was rebuilt for root preview. At that verification, no commit, merge, push or deployment had been performed. The existing Vite main-chunk >500 kB warning remains.

Use [README manual steps](../README.md#manual-check-localization-and-empty-maps). Existing limitations remain: drafts are page-memory only; language storage can be refused by browser policy; browser-native file pickers/dialog chrome are controlled by browser/OS language, while application text is localized. No translation of user adventure data is provided.
