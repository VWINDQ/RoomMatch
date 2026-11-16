# RM-09 responsive QA

## Inventory and coverage plan (before execution)

Source: `src/App.tsx`, `src/components/Layout.tsx`, page components and CSS.
The route-inventory test fails when a declared route has no baseline fixture.

| Route | Account / baseline | Additional layout states |
| --- | --- | --- |
| `/login` | guest | validation, password visibility, protected-route redirect |
| `/register` | guest | validation, password visibility, bottom action |
| `/rooms` | owner | search empty/error, filter sheet validation/scroll/close |
| `/rooms/:id` | owner, room 1 | member/applicant controls, withdrawal/leave modal, missing room, gallery |
| `/favorites` | owner, saved room | empty/error, broken image |
| `/my-listings` | owner | empty/error, create shortcut, delete confirmation |
| `/my-listings/new` | owner | required errors, image picker, bottom save/cancel |
| `/my-listings/:id/edit` | owner, room 1 | prefilled long text, non-owner denial |
| `/requests` | owner, incoming | sent applicant, approve/reject/withdraw dialogs, empty/error |
| `/matches` | member | membership card, empty/error, profile fallback |
| `/friends` | owner | discover, incoming/outgoing/history, accepted, search empty/error, profile/withdraw dialogs |
| `/profile` | owner | edit, preferences (same route), validation, long bio/contact, empty optional values/error |
| `*` | signed-in redirect | unknown route returns to rooms |

Every concrete route has baseline coverage at 360×800, 390×844, 844×390,
768×1024, 820×1180 and 1280×800. Interaction and image tests run at all six.
Additional boundary checks cover rooms, room details, profile, friends and listing form at
380/381, 420/421, 480/481, 640/641, 700/701, 767/768, 900/901, 1023/1024,
1100/1101, 1180/1181, 1499/1500, 1579/1580 from CSS media queries.
There is no separate Preferences route or more-menu drawer in this version.

## Environment and execution

- Configure `TEST_DATABASE_URL` with a dedicated database ending in `_test`.
- `npm run test:e2e:install` installs Chromium once.
- `npm run test:e2e` builds then runs Playwright; append `-- --project=mobile-360`
  to select a project. Direct `npx playwright test` requires a current build.
- Each worker uses the shared PostgreSQL fixture core, its own random schema,
  and an explicit database passed to a localhost API on an OS-assigned free port.
  The API serves `dist/` itself, so no development proxy or existing server is reused.
- Accounts/auth tokens exist only in worker/browser memory. No storage-state files,
  credentials, traces or videos are produced. Screenshots/reports stay ignored.
- Worker teardown closes its own server/pool and drops only its owned schemas.
- A run-owned schema ledger also cleans schemas from replaced workers; upload
  directories are under that same disposable run directory. Development uploads
  are never used.
- Existing node:test fixtures retain their automatic cleanup hook.

Assertions cover document and workspace overflow, visible navigation, real trial clicks for
hit targeting, bottom controls, field focus, and dialog bounds. Internal scrolling
is allowed. Screenshots are evidence, not approved visual-snapshot baselines.
Broken-image interception targets only `https://rm-fixture.invalid` URLs and checks
fallback content, bounded requests and absence of page errors.

## Results after approved UI fixes

Verified on 2026-11-17 (Asia/Bangkok), using Node 26.13.0, Playwright 1.65.1
and Playwright Chromium on Windows. The complete current suite passed in one run:
**283 passed, 0 failed, 0 skipped, 0 flaky** (retries remain disabled).

| Project / viewport | Passed | Failed | Baseline routes exercised |
| --- | ---: | ---: | --- |
| mobile-360 / 360x800 | 43 | 0 | 12/12 |
| mobile-390 / 390x844 | 43 | 0 | 12/12 |
| landscape / 844x390 | 43 | 0 | 12/12 |
| tablet-768 / 768x1024 | 43 | 0 | 12/12 |
| tablet-820 / 820x1180 | 43 | 0 | 12/12 |
| desktop / 1280x800 | 43 | 0 | 12/12 |
| CSS boundaries + inventory guard | 25 | 0 | 5 layouts at each of 24 widths |
| **Total** | **283** | **0** | **72 principal route/viewport baselines** |

| Category | Passed | Failed |
| --- | ---: | ---: |
| Route baselines | 72 | 0 |
| Interactions, states, permissions, route guard and focused regressions | 102 | 0 |
| Broken-image cases | 84 | 0 |
| CSS boundaries and CSS inventory guard | 25 | 0 |

Before these fixes the latest audit had 215 passed / 56 failed across 271 unique
cases. All of those existing assertions and the long fixture were retained.
Two focused tests add 12 project/test combinations: complete URL/name readability
and modal keyboard/scroll behavior. They do not duplicate the original geometry
regressions or test approval business logic.

Validation and evidence (runtime outputs remain ignored):

- Previously failing groups plus focused regressions: **78/78 passed**.
  Command: `npm run test:e2e -- --workers=3 --grep 'baseline detail-owner|broken fixture image: (gallery|member-profile|detail-owner-profile)|detail member|request owner|long-title|CSS boundary|long URL|approval modal scrolls'`.
  Log: `tmp/rm09-fixes-targeted-final.log`.
- Full suite: `npm run test:e2e -- --workers=3` -> **283/283 passed**.
  Log: `tmp/rm09-ui-fixes-full.log`; canonical JSON: `test-results/results.json`;
  HTML: `playwright-report/index.html` (`npm run test:e2e:report`).
- `npm test`: **234/234 passed**, no skips (`tmp/rm09-ui-fixes-unit.log`).
- `npm run build` (type check and production build): passed.
- `git diff --check`: passed.
- Each run closed its owned servers/pools and removed its own schemas/uploads.
  Final read-only verification found **0 remaining owned audit schemas**, and no
  run-owned schema/upload directories remain. Development data and `.env` were
  not changed; no Docker volumes were removed and no credentials or browser
  storage-state files were written to the repository.

### What automation proves

Document/workspace widths, actual control hit targeting, bottom actions, form field
access/focus, native/custom validation, navigation, modal opening/closing/bounds,
content scrolling, role variants, empty/error layouts and gallery controls pass at
the original viewports/breakpoints. Exact description text and full names remain
available; URL/unbroken text wraps without widening the page. No document/body
horizontal overflow workaround or fixture shortening was introduced.

All 84 broken-image cases pass, including the original no-retry-loop assertions.
Only exact synthetic image URLs are intercepted. The four image implementations
and card/gallery/avatar/dialog/editor contexts remain covered.

The new approval regression verifies Tab/Shift+Tab wrapping, native focus of a
scrollable text region, PageDown and wheel scrolling on 844x390, reachable
approve/cancel/close controls, and opener focus restored after cancel, Escape and
close. No production keyboard handling was changed.

### Visual comparison and limits

Read the original screenshots before editing. Originals are preserved under
`tmp/rm09-before-fixes/` so later Playwright runs cannot overwrite the evidence.
Compared new mobile detail, desktop long-URL/owner panel, and normal/long-title
landscape approval screenshots against those originals. The mobile full-page
image is now **360px wide**, compared with **1483px before**; content occupies more
vertical space because it wraps instead of being lost or clipped. The 844x390
modal now has visible header/footer inside its 20px viewport clearance, with the
body scrolling independently.

After-image examples:

- `test-results/responsive-baseline-detail-owner-mobile-360/detail-owner.png`
- `test-results/room-detail-layout-long-UR-68975-detail-grid-and-owner-panel-desktop/long-url-detail.png`
- `test-results/responsive-long-title-appr-5da1d-keeps-its-actions-reachable-landscape/long-title-approval-modal.png`
- `test-results/approval-modal-approval-mo-a7218-nd-preserves-keyboard-focus-landscape/approval-keyboard-modal.png`

The initial audit also visually reviewed all 12 baseline routes in each of six
viewport groups. This is sampled visual QA, not pixel-by-pixel approval of every
captured state. No screenshot snapshot baseline has been generated or approved.
Real iOS/Android devices, WebKit and Firefox have not been tested; this result
covers the requested Chromium viewport matrix.

## Root causes and approved fixes

### R09-01: room details expand with long content (resolved)

Fixture: `/rooms/1`, long Thai title/locality/owner profile and a valid description
containing `LongUnbrokenText` repeated 12 times (within the description limit).
At 360px the document grew to 1483px; at 820px it grew to 1500px. Desktop's
shell can hide document overflow while `.workspace` still scrolls horizontally
(1508px content inside a 1046px workspace at the 1280px desktop viewport).
The layout checks assert both containers, without treating intentional gallery
thumbnail scrolling as a defect.

Relevant styles: `.detail-layout`, `.detail-main`, `.description` and owner/sidebar
content in `src/styles.css`; mobile uses a `1fr` track with content-based minimums.
This is a verified layout issue, not a PostgreSQL or image-loading error.
Reproduce: run `npm run test:e2e -- --project=mobile-360 --grep "baseline detail-owner"`.
Before: `tmp/rm09-before-fixes/detail-mobile.png` and `detail-desktop.png`.
After: `test-results/responsive-baseline-detail-owner-mobile-360/detail-owner.png`.

Fix in the first hunk of `src/ux.css`:

- Allow detail grid/flex children to shrink with `min-width: 0`; make the inner
  detail grid track `minmax(0,1fr)` as well as constraining the outer grid items.
- Inherit `overflow-wrap: anywhere` inside the detail page, so long words/URLs
  contribute a breakable minimum width. Preserve description newlines with `pre-wrap`.
- The member name's existing `nowrap`/ellipsis rule and its flex child's automatic
  minimum width were a second intrinsic-width source. Wrap the full name instead
  of truncating important information.
- No document/body horizontal overflow rule was added, and no fixture was shortened.

`tests/e2e/room-detail-layout.spec.mjs` extends the real fixture response with a
long URL while retaining all previous content. It checks exact description text,
the complete member name and paragraph/member/owner bounds. Existing route,
broken-image and breakpoint regressions are reused without weakening assertions.

### R09-02: generic confirmation modal exceeds short viewport (resolved)

At 844×390 open Requests → incoming → approve a pending request. The generic
`.modal-card` measured y=-9.59px and bottom=399.61px in the initial reproduction;
its top/bottom edges extend outside the viewport. Unlike friend/requester-profile
dialogs, the generic modal has no viewport max-height and independently scrollable body.
The bounds assertions and viewport-only screenshots demonstrate the clipping;
this is not a screenshot-only inference that buttons are inaccessible.
Reproduce: `npm run test:e2e -- --project=landscape --grep "request owner and seeker modals"`.
Evidence: `test-results/responsive-request-owner-and-seeker-modals-landscape/approve-modal.png`.
With the long room title, the dialog measured y=-39.13px and bottom=429.14px;
the title and action area are visibly clipped. Evidence:
`test-results/responsive-long-title-appr-5da1d-keeps-its-actions-reachable-landscape/long-title-approval-modal.png`.

Before images are preserved as `tmp/rm09-before-fixes/approval-landscape.png` and
`long-approval-landscape.png`. The paths under `test-results/` now contain after images.

Fix in the second hunk of `src/ux.css`: cap the card at `100dvh - 40px` and lay
it out vertically, keep header/footer from shrinking, and give only `.modal-body`
a shrinkable, vertically scrollable area. Footer buttons can wrap on narrow screens;
the title can wrap while the close button keeps its width. Existing desktop sizes,
focus trap, Escape handling and focus restoration remain in place; no component
JavaScript was changed.

`tests/e2e/approval-modal.spec.mjs` adds the missing keyboard regression rather
than duplicating the existing geometry tests: Shift+Tab/Tab wrapping, native focus
of a scrollable text body, PageDown and mouse-wheel reading on the short viewport,
hit targeting of approve/cancel/close, and restored opener focus after cancel,
Escape and the close button. The test does not approve a real request.

## Proposed commit split (do not commit yet)

1. `test(e2e): set up isolated Playwright environment`
   - `package.json`, `package-lock.json`, `.gitignore`, `playwright.config.mjs`
   - `tests/support/postgres.mjs`, `tests/support/postgres-fixtures.mjs`
   - `tests/e2e/fixtures.mjs`, `tests/e2e/lifecycle.mjs`
2. `test(responsive): cover all routes across mobile tablet and desktop`
   - `tests/e2e/routes.mjs`, `tests/e2e/responsive.spec.mjs`, `tests/e2e/breakpoints.spec.mjs`
3. `test(images): cover broken-image fallbacks`
   - `tests/e2e/images.spec.mjs`
4. `fix(responsive): wrap long room detail content`
   - First (detail) hunk of `src/ux.css`
   - `tests/e2e/room-detail-layout.spec.mjs`
5. `fix(responsive): keep approval dialogs within short viewports`
   - Second (modal) hunk of `src/ux.css`
   - `tests/e2e/approval-modal.spec.mjs`
6. `docs(qa): record responsive coverage and results`
   - `docs/RESPONSIVE_QA.md`

Commands below are prepared for review only; **none of these commits or staging
commands were executed**. Inspect `git diff --cached` before each future commit
and keep unrelated user work out of the index.

```powershell
# 1. Shared setup and isolated lifecycle (8 files)
git add -- .gitignore package.json package-lock.json playwright.config.mjs tests/support/postgres.mjs tests/support/postgres-fixtures.mjs tests/e2e/fixtures.mjs tests/e2e/lifecycle.mjs
git diff --cached
git commit -m "test(e2e): set up isolated Playwright environment"

# 2. Original route/layout coverage (3 files)
git add -- tests/e2e/routes.mjs tests/e2e/responsive.spec.mjs tests/e2e/breakpoints.spec.mjs
git diff --cached
git commit -m "test(responsive): cover all routes across mobile tablet and desktop"

# 3. Image coverage (1 file)
git add -- tests/e2e/images.spec.mjs
git diff --cached
git commit -m "test(images): cover broken-image fallbacks"

# 4. Answer y for the "Long user content" hunk, n for the modal hunk.
git add -p -- src/ux.css
git add -- tests/e2e/room-detail-layout.spec.mjs
git diff --cached
git commit -m "fix(responsive): wrap long room detail content"

# 5. Stage the remaining "Keep dialog controls visible" hunk.
git add -p -- src/ux.css
git add -- tests/e2e/approval-modal.spec.mjs
git diff --cached
git commit -m "fix(responsive): keep approval dialogs within short viewports"

# 6. Final evidence and instructions (1 file)
git add -- docs/RESPONSIVE_QA.md
git diff --cached
git commit -m "docs(qa): record responsive coverage and results"
```

The existing generic geometry regressions belong to the responsive/image commits;
they are not copied into either fix commit. Only the focused URL/readability and
keyboard/scroll regressions accompany their respective fixes. `src/ux.css` is the
only file shared between the two production fixes and must be staged as hunks.

Do not stage `.env`, browser state, screenshots, `test-results/`, reports, `tmp/`,
or `dist/`. No screenshot snapshot baseline has been created or approved.

## RM-09 status and next work

**Complete for the requested responsive Chromium scope.** Both approved UI groups
are fixed, all 12 routes and original viewport/breakpoint checks pass, and before/
after evidence was reviewed. Real-device and other-browser checks remain outside
this verified scope. Review the six proposed commit groups before creating any
commit; no staging, commit or push was performed by this task.

Reference: [Playwright worker fixtures](https://playwright.dev/docs/test-fixtures).
