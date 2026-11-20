# RM-13: confirm leaving an unsaved listing

## Implementation

Both create and edit use `useListingLeaveGuard` in `ListingFormPage.tsx`.
After the actual form mounts (after an edit loads), it captures the input,
textarea and select values, listing status and ordered image identities.
Navigation compares current values to that baseline, rather than setting a
permanent dirty flag. Reverting values or image order is therefore pristine.
Saved images compare by URL; new files compare by stable selection ID. Uploading
a file does not mark the listing saved if the subsequent save fails.

Reading controls directly also retains disabled field values during save;
`FormData` would omit those fields. Errors, focus and image validation feedback
do not themselves count as edits. No draft storage or database changes exist.

The entry point now uses `createBrowserRouter`/`RouterProvider` with one catch-all
route around the existing `App`. The route definitions, protection, shell and
session provider remain in place. This is the small provider change required by
the installed router's `useBlocker`, rather than rewriting every route or
intercepting anchor clicks/history globally.
Reference: [React Router useBlocker](https://reactrouter.com/api/hooks/useBlocker).

The blocker retains the selected navigation, including browser Back/Forward.
The existing `Modal` displays **ยังไม่ได้บันทึกประกาศ** with **ยกเลิกการแก้ไข**
and **บันทึกและไปต่อ**. Close, backdrop and Escape return to editing with the
current values and selected images. The dialog reuses Modal's focus management
and viewport limits, with centered styling scoped to the listing warning.

`beforeunload` calls preventDefault/returnValue only if the current snapshot is
dirty. Refresh, closing and full-document departures use the browser's native
warning; its wording and availability are browser-controlled.

Save and continue submits the same form and proceeds to the blocked destination
after a successful API save. Validation, upload and save failures close the
warning, expose the form feedback and preserve the edits for retry. Both action
buttons are disabled while saving, and the submit handler prevents duplicate
requests. An upload finishing after unmount cannot initiate a new save from that
form.

## Automated coverage

`tests/e2e/listing-leave.spec.mjs` has 13 scenarios, using the existing isolated
PostgreSQL fixtures, API and server lifecycle. Mutable listings are created by
each test through that test API and deleted afterwards; worker cleanup also
removes only its owned schema/upload directory. No development server/database
or fallback connection is used.

| Scenario | Assertions |
| --- | --- |
| Create/edit pristine and revert | Initial exit has no warning; every text/number field, select and status change warns; reverting them permits exit; validation alone is pristine |
| Create/edit stay/discard | Menu exit warns; stay preserves values; latest attempted destination wins; close/Escape stay; focus restoration, Tab wrapping, hit targeting and modal bounds |
| Browser history | Back and Forward both stay/proceed to the original entries; discarded form is empty on return |
| Selected files | Adding files warns; stay preserves blob previews/order; reordering works; removing additions restores pristine |
| Saved images | Reordering and removal warn; restoring original order is pristine |
| Create/edit save failure/retry | Real upload and API save; forced first save failure stays dirty; retry succeeds without warning; persisted title after refresh; no duplicate upload |
| Native beforeunload | Pristine/reverted reloads have no dialog; dirty reload and tab-close warn; dismissal preserves values; accepting reload discards them |
| Pending save | Disabled inputs stay dirty, repeated submit sends once, successful response clears an open warning |
| Cross-tab session | Switching accounts clears private form values; external logout reaches login without trapping the session |
| Save and continue | Validation and API failures expose feedback on the form; retry submits once, persists the listing and reaches the selected destination |

Existing node tests retain their assertions. The two static form-render harnesses
use `createMemoryRouter`/`RouterProvider` to match the new required router context.
The extracted submit-handler harness supplies the mount/save guard dependencies
and additionally checks that only success marks the form saved.

During test development, selectors were corrected to avoid the meta description
and the image group's shared accessible label. Dialog opening and route commits
are awaited before keyboard/history actions. A cancelled native reload is tested
by waiting for its actual dialog, since it has no completed load event to await.
No time-based sleeps, weakened assertions, retries or skipped tests were added.

## Verification

Verified on 2026-11-17 (Asia/Bangkok), Windows, Playwright Chromium.

- Targeted existing form/submit checks: **15/15 passed** during implementation.
- Final focused RM-13: **39/39 passed** across 360x800, 844x390 and 1280x800.
  Log: `tmp/rm13-targeted-final.log`.
- Full Playwright suite: **379/379 passed**, 0 failed/skipped/flaky, retries disabled
  (`tmp/rm13-e2e-full.log`, `test-results/results.json`). Each main viewport has
  59 passing cases: 360x800, 390x844, 844x390, 768x1024, 820x1180 and 1280x800;
  25 additional breakpoint/inventory cases pass. This includes 78 RM-13 cases
  and the existing 301 cases. Run because the shared router provider changed.
- Final `npm test`: **234/234 passed**, no skipped tests (`tmp/rm13-unit-final.log`).
- Standalone `npm run build`: **passed** (`tmp/rm13-build-final.log`).
- `git diff --check`: **passed**.
- Final read-only test-database verification found **0 remaining E2E fixture
  schemas**; no `tmp/roommatch-e2e-*` resource directories remain. Each run closed
  its servers/pools and removed its owned schemas/uploads. No `.env`, development
  data or Docker volumes were changed.
- Visually reviewed the 360x800 create and 844x390/1280x800 edit dialogs: text, close and
  both actions fit, with visible focus. Automation also asserts bounds and actual
  hit targeting. Images remain ignored under these run-local paths:
  - `test-results/listing-leave-RM-13-create-f6420-the-chosen-menu-destination-mobile-360/leave-create-modal.png`
  - `test-results/listing-leave-RM-13-edit-s-91152-the-chosen-menu-destination-landscape/leave-edit-modal.png`
  - `test-results/listing-leave-RM-13-edit-s-91152-the-chosen-menu-destination-desktop/leave-edit-modal.png`

**RM-13 is complete within this verified scope.** No pending implementation or
failed verification remains; browser/platform limits are listed below.

```powershell
node --env-file=.env --test tests/listing-submit.test.mjs tests/listing-form-render.test.mjs tests/listing-error-feedback.test.mjs
npm run test:e2e -- --workers=3 --project=desktop --project=mobile-360 --project=landscape tests/e2e/listing-leave.spec.mjs
npm run test:e2e -- --workers=3
npm test
npm run build
git diff --check
```

Logs, screenshots and reports remain ignored. Do not stage test resources,
credentials, browser state, `.env`, `dist/`, `tmp/` or `test-results/`.

## Limits

- Chromium viewport automation is not real-device, WebKit or Firefox verification.
- Browsers require prior user activation for native beforeunload warnings and may
  suppress them, especially on mobile process termination. Custom Thai wording is
  only used by the in-app dialog, never promised for native browser warnings.
- Discard does not undo a save request already delivered to the server. That
  request may finish persisting; its late response cannot redirect the departed
  page. No draft, transactional cancellation or request-idempotency feature was
  added by RM-13.
- Authentication invalidation/account changes take precedence: the protected
  route unmounts the old user's form rather than preserving their private edits
  in another account's session.

## Proposed commits for the actual diff

No staging, commit or push has been performed. Keep the provider, form, guard and
their tests together so that each resulting commit builds and tests independently.

```powershell
# 1. RM-13 implementation and directly related regression/harness updates
git add -- src/main.tsx src/pages/ListingFormPage.tsx src/lib/useListingLeaveGuard.ts tests/e2e/listing-leave.spec.mjs tests/listing-submit.test.mjs tests/listing-form-render.test.mjs tests/listing-error-feedback.test.mjs
git diff --cached
git commit -m "feat(listings): confirm leaving unsaved listing changes"

# 2. Behavior, verification and limits
git add -- docs/RM13_UNSAVED_LISTING.md
git diff --cached
git commit -m "docs(qa): record RM-13 navigation guard coverage"
```
