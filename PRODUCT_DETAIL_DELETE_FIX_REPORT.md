# Product detail and admin deletion follow-up

Branch: `fix/audit-p1-business-functionality`.
Base/unchanged HEAD: `2e433dfcaee1927165ee161980c5e5ba57468516`.
Status: **PASS for the local correction and verification; production deployment remains pending.** This follow-up is uncommitted. Previous Phase 1 approval covers its already committed 32-file snapshot; this report describes the additional 10-file patch separately. Historical audits/reviews are unchanged.

## Verified causes and changes

1. **Product detail rendering failure:** public product APIs returned valid JSON, but three live product pages contained a server-render error and no purchase controls, despite HTTP 200. A read-only browser visit to `/products/mens-pant` showed “Could not load this product.” Local development reproduced the actual exception at `client/app/products/[slug]/page.tsx:181`: the server called `pickInitialSelection` exported by a `'use client'` module. Moving the pure calculation and type to `client/lib/catalog/product-selection.ts`, and importing it directly in the server page and purchase panel, fixes that boundary. Selection rules and server-authoritative prices/stock are unchanged. The fixed local page returns 200 with purchase controls; production-built browser tests verify the default in-stock selection and no render/hydration errors.

2. **Admin confirmation accessibility defect:** every ConfirmDialog used the literal id `confirm-title`. The product editor mounts multiple dialogs, so Delete referenced Archive's title. Before correction, browser role/name selection of “Delete product?” failed while category confirmation worked. `useId()` now supplies a unique, hydration-stable title reference for each dialog. Product deletion, ordered-product archiving and deletion error handling all pass through the named native dialog after this change. This label defect does not explain a server category 409.

3. **Reported category conflict:** the supplied request targets Bags (`6aecfacca401947ef8ae0d82`) and returns 409. Public GET checks show zero active products and zero subcategories; these public endpoints cannot establish whether draft/archived products remain assigned. The existing deletion guard counts products in every status. Its conflict message now explicitly states that draft and archived products are included. No deletion guard was removed. To remove an occupied category safely, move all assigned products to another category first. Products used by orders are archived on deletion and retain their category link; historical stock targets must survive.

[React #441](https://react.dev/errors/441) describes a server-component render failure; [React #418](https://react.dev/errors/418) describes a hydration mismatch. The local server stack identified the concrete product-rendering fault. The corrected local browser cases contain neither error; this is not a claim that every live route/browser-extension scenario has been audited or that the fix is already deployed.

## Exact implementation/test files

- `client/app/products/[slug]/page.tsx` — import the calculation from the shared module.
- `client/components/catalog/ProductSelection.tsx` — retain client context/state; remove the server-callable calculation from this boundary.
- `client/components/catalog/PurchasePanel.tsx` — use the same shared calculation for standalone client selection.
- `client/lib/catalog/product-selection.ts` — new pure shared helper/type.
- `client/components/admin/ConfirmDialog.tsx` — unique accessible title ids.
- `server/src/services/admin-catalog.service.ts` — clarify category conflict counts, preserving authorization/dependency/history guards.
- `client/lib/__tests__/product-selection.test.ts` — four new selection regressions.
- `client/tests/catalog.browser.mjs` — six new browser regressions using synthetic local APIs, including real server rendering of the product route.
- `client/package.json` — include the new unit file and add `test:catalog`; no dependency changes.
- `server/test/order-integrity.test.ts` — three new HTTP/database deletion regressions; all existing cases retained.

This report is an untracked review artifact outside that 10-file implementation scope.

## Final verification

| Command | Result |
|---|---|
| Server `npm.cmd test` | **86/86 PASS**, 21 suites; 0 failed/skipped/cancelled |
| Client `npm.cmd test` | **39/39 PASS**, 2 suites; 0 failed/skipped/cancelled |
| Client `npm.cmd run test:catalog` | **6/6 PASS**, 0 suites; 0 failed/skipped/cancelled |
| Client `npm.cmd run test:browser` | **7/7 PASS**, 1 suite; 0 failed/skipped/cancelled |
| Server `type-check`, `type-check:test`, `lint`, `build` | exit 0 each |
| Client `type-check`, `lint`, `build` | exit 0 each |
| `git diff --check` | exit 0 |
| Secret/dependency review | 0 private environment-secret/credential-pattern matches; dependency objects unchanged |

**138 unique passing runner cases:** 83 prior server + 3 deletion = 86; 35 prior client + 4 selection = 39; 7 existing account browser + 6 catalog browser = 13. Iterations and initial failed runs are not counted again. Prior Phase 0/1 checkout, inventory, authentication and concurrency regressions remain passing.

New HTTP/database evidence proves: guest 401/customer 403 for admin deletes; unused product DELETE 204 with variants removed; repeated deletion 404; ordered product DELETE 200/archive preserving order items and cancellation stock restoration; occupied category 409 with unchanged records; empty child/parent deletion 204 after dependencies are removed; repeated category deletion 404. New browser cases exercise product rendering, empty-category removal, visible dependency errors, product 204 navigation, archive explanations and 500 error handling without a false success/redirect. All six browser cases check for uncaught render/hydration errors.

## Reproduction environment and limitations

- MongoDB 8.2.6 disposable replica set `rs0` on localhost:28818, standalone on 28819. Actual dbpaths were verified inside this task's unique temporary directory before fixtures. `MONGODB_TEST_MODE=disposable`; test URIs used `catalog_delete_test` and `catalog_delete_standalone_test`, respectively. Only the disposable instances used an index-build free-space threshold of 100 MB.
- An initial proposed database name containing `product` was correctly refused because it contains the protected `prod` substring; no deletion occurred. The guard was preserved and the test-only name changed. A subsequent setup run hit local disk exhaustion. Removing the stopped dev server's generated `.next/dev` cache recovered about 776 MB; the final full DB suite then passed. Neither initial attempt is reported as a successful run.
- Before the unique-id correction, the initial catalog browser run had 2 passes and 4 failures: three product-dialog name lookups and one cold page-navigation timeout under disk pressure. The page navigation deadline is now 45 seconds; control/action deadlines stay 10 seconds. The final six cases passed against the corrected production build.
- Build-only `API_URL=http://127.0.0.1:4084`; the catalog test owns that GET-only fixture server. Browser bases were localhost:3037. Existing globally installed Playwright/Chromium supplied the browser; no dependency was installed. Browser API writes were intercepted and synthetic. Actual deletion/persistence was exercised separately only on the disposable MongoDB databases through Express routes.
- Live diagnostics used only public GET requests. No production deletion, account write, seed, migration or index operation occurred. The exact reason/count in the live authenticated 409 body still requires the owner's admin response/details; it cannot be inferred from the public active-only product feed.
- Temporary evidence: `C:/Users/mahim/AppData/Local/Temp/abstract-product-delete-3c8c2042d7474f6cbae4c3c86b006f85`. Final server/client/browser logs and initial failure logs are retained there. Owned services, disposable databases, generated client AGENTS.md and temporary scripts are removed. The original root AGENTS.md, AUDIT_REPORT.md and all earlier untracked reports are preserved.

## Deployment handoff

The previous Phase 1 commit `2e433df` was pushed, but these follow-up corrections are not committed/pushed/deployed. A successful branch deployment of the previous commit does not include this patch. Production publication still requires authenticated Vercel access and the existing Render service identity/access requested earlier. Do not merge into main, run production seeds or mutate production records as part of troubleshooting. The phone-index rollout and previously recorded owner business/legal and production smoke/accessibility gates remain separate release considerations.
