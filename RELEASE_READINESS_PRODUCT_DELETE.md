# Product detail/admin deletion release preparation

## Release state

**Commit/push/PR: PASS. Production readiness: pending external verification. Production deployment: not approved or performed.**

- Release branch: `fix/product-detail-admin-delete`.
- Commit: `ac3eb04eea815e6902eb1591215d17087878709d` — `fix: restore product details and clarify admin deletion`.
- Parent/current base: `e715b4b00a367209c9476c44c1911e7827cee263` (remote main when prepared).
- Draft PR: https://github.com/mahimrahman659-sudo/Abstract-Lifestyle/pull/3.
- Phase 0 is already merged via PR #1; Phase 1 is already merged via PR #2. The original work branch at `2e433df` was an ancestor of current main, with an identical source tree. A fresh branch avoids including those completed phases again.
- The complete remote PR diff matches the reviewed local diff, including all 10 remote blob SHAs. Scope: **10 files, 236 insertions, 28 deletions**. Mergeability was clean; no merge was performed.
- All previous audit/review reports and root AGENTS.md remain untracked and unchanged. No credentials, env files, generated outputs, dependencies or review artifacts were committed.

## Exact committed allowlist

1. `client/app/products/[slug]/page.tsx`
2. `client/components/catalog/ProductSelection.tsx`
3. `client/components/catalog/PurchasePanel.tsx`
4. `client/lib/catalog/product-selection.ts`
5. `client/components/admin/ConfirmDialog.tsx`
6. `server/src/services/admin-catalog.service.ts`
7. `client/lib/__tests__/product-selection.test.ts`
8. `client/tests/catalog.browser.mjs`
9. `client/package.json`
10. `server/test/order-integrity.test.ts`

The patch moves variant-selection initialization into a pure shared module, fixes duplicate dialog title ids, and clarifies category dependency conflicts. It preserves stock calculations, admin authorization, transaction guards and historical-order archiving. It does not make occupied categories deletable or permanently remove products referenced by orders.

## Fresh verification and CI

| Verification | Result |
|---|---|
| Server `npm.cmd test` | 86/86 pass, 21 suites, no failed/skipped/cancelled cases |
| Client `npm.cmd test` | 39/39 pass, 2 suites, no failed/skipped/cancelled cases |
| Client `npm.cmd run test:catalog` | 6/6 pass, production-built local client and synthetic APIs |
| Client `npm.cmd run test:browser` | 7/7 pass, existing account regressions |
| Supplemental local accessibility runner | 3/3 pass |
| Server type-check, test type-check, lint, build | exit 0 each |
| Client type-check, lint, production build | exit 0 each |
| Cached whitespace, exact staged scope/content, secret/dependency checks | pass; zero private secret matches; dependency objects unchanged |
| Full PR diff and all remote file blobs | exact match; only the 10 listed paths |
| GitHub status `Vercel` | success — deployment completed for the PR head |
| GitHub check `Vercel Preview Comments` | completed/success |
| GitHub Actions workflows | none configured; no server/unit CI run is claimed |

**138 repository tests + 3 supplemental accessibility cases = 141 passing runner cases.** The bounded load/readiness exercise below is a separate experiment, not additional runner cases. Earlier temporary logs had been cleared, so the implementation was re-read and all verification rerun before this commit.

Vercel build status: https://vercel.com/abstract-lifestyle1/abstract-lifestyle/DrHtf2f7QKbdiM2ygmPSkB5dQszc.

Preview URL: https://abstract-lifestyle-git-fix-product-d-e74187-abstract-lifestyle1.vercel.app.

The Preview API requests return a **302 to Vercel SSO protection**. Following that redirect yields login HTML, not API health. The green build is not evidence of a successful authenticated runtime smoke test. Protection was not bypassed or disabled.

## Readiness findings

| Gate | Evidence and remaining action |
|---|---|
| Backend/frontend contract compatibility | PASS for the scoped patch: endpoint shapes/status codes are unchanged; the server change only appends conflict copy. Local HTTP tests verify 204 deletion, 200 archiving, 409 dependency conflicts and 401/403 authorization. Product SSR and account/editor browser regressions pass. This does not establish the exact deployed Render revision. |
| Scoped accessibility | PASS: unique accessible dialog names, native modal tab cycle, Escape cancellation without a DELETE, focus restoration, keyboard variant selection, stock-based disabling, and no horizontal overflow at 320/375/768/1440px under the synthetic fixture. No render/hydration errors in the catalog browser cases. Full assistive-technology and authenticated Preview sign-off remain separate. |
| Current public production health | Latest read-only check at `2026-11-18T13:24:09.449Z`: `/api/health` returned 200 `{ ok: true, transactions: true }`; public product list returned 200 with 3 products. No production write/checkout/delete was performed. |
| Intermittent production 429 responses | Earlier lightweight health/catalog checks returned text/plain 429 through Vercel, then recovered. This is not proof that the origin application rate limiter caused them. Inspect platform/origin logs, request volume and proxy configuration before release; do not disable rate limits to hide the symptom. |
| Phone indexes | Source and disposable explain tests pass. Production index existence is **unverified** without confirmed service/database access. Read actual `orders` indexes and confirm the two compound keys below before relying on search performance. Do not run `syncIndexes` against production; it can remove other indexes. Any required additive index write needs approved maintenance scope. |
| Platform configuration | Render service identity/access and authenticated Vercel access remain pending. Confirm roots, deployment revision, environment values, proxy/CORS/cookie configuration, production branch and auto-deploy behavior. Do not infer configuration from local env files or a successful Preview build. |
| Load/capacity | Bounded disposable concurrency passed, as below. A production traffic target, isolated staging environment, representative data and acceptance thresholds are not supplied. This is not a production throughput/capacity sign-off. |
| Failover/recovery | Controlled application DB disconnect/reconnect readiness passed. Actual managed-cluster multi-node election, provider failover and backup/restore checks are **not performed**; require an approved isolated staging environment/provider controls. |
| Owner business/legal information | Previously recorded verified-contact/legal/return-policy decisions remain owner release gates. No values or business promises were fabricated. |

Required phone index keys, in order:

```json
{ "shippingAddress.phone": 1, "createdAt": -1, "_id": -1 }
{ "shippingAddress.phone": 1, "status": 1, "createdAt": -1, "_id": -1 }
```

Use read-only index inspection first, then stage/approve any missing additive index creation separately. Existing unique order-number and checkout-id indexes must remain unchanged.

Operational documentation caveat: DEPLOYMENT.md's final legacy password-rotation note still says to rerun the seed after changing ADMIN_PASSWORD. The current insert-only seed deliberately preserves existing hashes, so **that does not rotate an existing password**. Follow the earlier controlled verified-owner credential-rotation guidance. Do not execute production seeding as part of this release. Existing documents were preserved rather than adding an unreviewed documentation file to the 10-file commit.

## Bounded local load and readiness experiment

- A separate guarded disposable database `release_stress_test` on this run's localhost replica set was used; actual dbpaths were verified before fixtures. No production connection or production load was used.
- 12 concurrent one-unit checkouts competed for 5 units: **5 committed orders, 7 conflicts, final stock 0**, measured checkout batch about **953 ms** on this machine.
- 10 concurrent cancellation requests targeted those 5 orders: **5 successful restorations, final stock 5**, all five orders cancelled with stockRestored true.
- Actual local API health transitioned **200 → 503 → 200** through a controlled disconnect and validated reconnect. No stale transaction-ready state was reported.
- A missing description in the initial temporary stress fixture was rejected by normal model validation. The fixture was corrected and the final experiment passed. Supplemental accessibility probes were corrected for the native browser's neutral body tab stop and the unavailable variant button's “Out of stock” label; no implementation was changed for those probe assumptions. Initial probe failures are retained in the evidence logs and are not counted as passing cases.

## Controlled release plan — separate approval required

1. Complete authenticated Preview runtime checks and operator verification of production indexes/configuration. Agree staging load/failover targets and obtain the remaining owner decisions. Resolve or explicitly accept each remaining gate with evidence.
2. Inspect auto-deploy behavior **before merging**. A main merge may trigger both platforms, so do not merge while relying on a manual backend-first sequence. Any changes to auto-deploy controls require the approved release plan.
3. Request separate owner approval identifying PR #3, the exact approved commit/merge result, target Render/Vercel services, any additive index work, monitoring and rollback targets. No merge or production promotion is authorized by this preparation step.
4. After approval, deploy the approved backend revision to Render first. Verify direct health, transaction support, startup logs and expected API contracts. Do not run seed or normalization scripts.
5. Build/promote the approved frontend revision to Vercel with the correct API_URL and HTTPS canonical origin. Verify product pages render actual purchase controls (not merely HTTP 200), public catalog, same-origin API connectivity and approved authenticated flows. Production destructive/data-mutating smoke tests need explicit approval; otherwise exercise them in isolated staging.
6. Monitor SSR/hydration errors, 5xx, 429, checkout conflict rates and readiness. Record prior platform revisions before deployment; roll back through the approved platform process if thresholds fail. Category dependency conflicts and history-driven product archiving remain expected business behavior.

No production deploy, merge, production database/index write, production seed or Phase 2 work occurred. PR #3 remains a draft. The commit and PR are ready for review; production release remains pending access, gate evidence and separate approval.

## Evidence and preservation

Evidence is retained outside the repository at `C:/Users/mahim/AppData/Local/Temp/abstract-release-prep-00d66316ca0e43d0bd1f08ce96978afe`: fresh server/client/browser/accessibility logs, bounded-load/readiness log, complete PR diff, PR verification JSON, read-only live-check JSON and original file hashes. Disposable services/databases and temporary scripts are removed after verification. Existing audit/review files remain unchanged and excluded from the commit; this report is an untracked readiness artifact.
