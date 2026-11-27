# Phase 1 independent review pass — 2026-11-17

**Verdict: PASS WITH CONDITIONS. Do not authorize the Phase 1 commit until R1–R3 below are resolved and reviewed.** No critical/high security or inventory-integrity defect was found. Two medium account-flow defects were reproduced in a browser; the existing tests do not cover them.

This is a separate read-only verification pass by the same assistant that implemented the patch, not a second-person sign-off. Implementation code, existing reports and the original audit were not edited. This review report is the only intended new repository file.

## Identity, scope and provenance

- Branch: `fix/audit-p1-business-functionality`.
- Current HEAD: `687115016c0c8855fcf1450d9f91644b196f996c` (`fix: remove direct mongodb type dependency`).
- Original Phase 0 baseline: `c389bace330824c4373dadf548d2063e68249173`; `git merge-base --is-ancestor` exits 0. The intervening committed change is the MongoDB type-only build fix; it is not part of the uncommitted Phase 1 patch.
- Reviewed the entire tracked diff, all three untracked source/test files, the Phase 1 package/report, original audit, requirements/context/instructions, and surrounding auth, address, order, schema and index code. Compared the package's recorded diff with the current diff: identical. All three new source files are represented in the package.
- Scope: 22 tracked modifications plus 3 new implementation/test files; A2/A3/A6/B7/B8. No new runtime/development dependencies. Client package change only adds the new test file to the test command.

## Findings and required fixes

### R1 — MEDIUM: a successful account mutation followed by a failed refresh silently logs the customer out

**References:** `client/components/auth/AccountEditor.tsx:24–28`, `client/components/auth/AuthProvider.tsx:33–44`, `client/components/auth/RouteGuard.tsx:17–20`.

Every new account action awaits `refresh()` after the mutation. The existing refresh implementation catches all errors, clears `user`, and resolves successfully. Consequently a PATCH can succeed, its follow-up GET `/api/auth/me` can return 503, and the account page redirects to login without an inline retry message. The new caller cannot distinguish that failure and proceeds toward a success notice. The underlying refresh behavior predates Phase 1, but invoking it after every new account mutation exposes the defect in the new flow.

**Reproduction:** production-built local client, synthetic API responses intercepted in Playwright: PATCH `/api/users/me` returned 200; the next GET `/api/auth/me` returned 503. Observed `mutationSucceeded=true`, `redirectedToLogin=true`, `inlineRetryError=false`. This does not mean the authentication cookie was revoked or the server mutation rolled back; the client lost its authenticated state.

**Required fix:** distinguish a genuine 401 from a transient readback failure. Retain the authenticated state on network/5xx errors and surface a retryable refresh/readback status. Account mutation completion must not depend on a refresh that silently resolves as logout. Add a browser regression where the write succeeds and only the subsequent profile read fails; retain the existing write-failure test too.

### R2 — MEDIUM: saved optional delivery fields are invisible and cannot be corrected or cleared

**References:** `client/components/auth/AccountEditor.tsx:30–40`, `client/components/auth/AccountEditor.tsx:55–69`, `client/components/checkout/AddressForm.tsx:25–69`, `server/src/services/order.service.ts:101–108`.

The server accepts and stores valid `line2`, `city`, `state`, `postalCode`, `country` and `label` fields. The new editor copies them into state and sends them back in every PATCH, but renders only fullName/phone/line1 and lists only fullName/line1. The previous read-only account list displayed line2/city/country. A customer with an existing apartment/city value can change the visible address while unknowingly retaining the old delivery information; that retained information is copied into future order snapshots. Historical orders remain unaffected, as required.

**Reproduction:** supplied a valid saved address with `line2='Old apartment'` and `city='Old city'`; neither appeared in the account editor/list. Changed Address to `New street`, saved, and captured the outgoing PATCH: both old optional values were still present. No control exists to edit or clear them. The issue affects addresses with populated optional fields; new minimal three-field addresses are unaffected.

**Required fix:** keep the three-field primary flow if desired, but disclose the complete saved address and provide an explicit way to edit/clear populated optional delivery fields (for example an optional details disclosure). Do not silently discard legacy values or alter historical snapshots. Test a populated optional address, moving to a new location and clearing stale fields, through the browser and API.

### R3 — LOW: implementation report incorrectly describes HEAD and commit/push history

**References:** `AUDIT_PHASE1_IMPLEMENTATION_REPORT.md:5–7`, `AUDIT_PHASE1_IMPLEMENTATION_REPORT.md:101` (handoff wording); `REVIEW_PACKAGE_PHASE1.md:3`.

`c389bac` remains the valid original baseline, but it is no longer the unchanged HEAD. `6871150` is the current HEAD, and the separate MongoDB type fix was committed and pushed in an explicitly authorized later task. The uncommitted Phase 1 implementation remains uncommitted. The review package's Phase 0 baseline is valid, and its diff still matches the working tree because the type fix was outside its Phase 1 patch.

**Required documentation correction:** identify both original baseline and current HEAD, distinguish the already committed type fix from the pending Phase 1 changes, and date/scope the historical “no commit/push” claim. Do not rewrite the original audit or imply that Phase 1 is on the remote branch.

### R4 — LOW: public-content tests require contact/social configuration to stay empty

**Reference:** `client/lib/__tests__/public-content.test.ts:6–11`.

The test correctly rejects placeholders but additionally requires email/hours to equal empty strings and social count to equal zero. A future owner-approved real contact/profile will fail these assertions. Prefer validating configured values and allowing unset values, rather than permanently asserting absence. This is a maintenance issue, not a current production rendering failure.

## Confirmed behavior and security/concurrency assessment

| Area | Review result |
|---|---|
| A2 server ownership/validation | Existing requireAuth + body Zod + id validation retained. User id comes from auth. Foreign address PATCH/DELETE returns 404; invalid phone/name returns 400. Name-only atomic update avoids stale array writes. |
| A2 address concurrency | Fresh user is loaded inside each transaction. Concurrent add/default/name mutations are tested; writes retry on conflict. Nonempty lists have exactly one default; deleting it promotes a remaining address. Historical order snapshots remain equal in the integration test. R1/R2 concern the UI, not a demonstrated server inventory/auth bypass. |
| A3 | Fake email/hours and hash-only socials removed. Exchange/weekly-arrival assertions removed. Metadata exports and navigation routes remain present. Four production-rendered information pages pass placeholder/setup-copy checks. COD phone confirmation is supported by the supplied business requirements; owner comments remain source comments, not rendered content. |
| A6 | Registration and seed share cost 12. Seed module import does not execute CLI connection/seeding. New demos are drafts. Guarded legacy imageless-demo demotion preserves concurrent legitimate image additions. Repeat execution preserves existing hash, product count and edited stock. No production seed executed. |
| B7 | Owner filter, pending/processing predicate and stockRestored guard are in one transaction. Shipped/already-cancelled orders conflict. Admin shipment/cancel writes the same order and therefore conflicts/retries safely. Archived stock targets and missing-variant rollback checks remain. |
| B8 auth/privacy | The admin router still applies requireAuth and requireRole('admin') before order routes. Tests assert guest 401/customer 403. Customer order service retains its user filter; search does not add a public customer join or disclosure route. |
| B8 query/indexes | Full normalized phone or uppercase full order number uses equality, not regex. List/count share the filter; stable sort uses createdAt/_id. Existing unique orderNumber index is preserved; two new phone compound indexes match sort/status variants. Explain assertion verifies IXSCAN and <=1 document examined for the fixture's limit-one status/phone query. |
| Phase 0 | All 73 prior server and 19 prior client tests remain and pass. Checkout claims/CAS, idempotency, duplicate-key recovery, restoration, archive/restore/delete races and transaction rollback remain covered. The committed Mongoose-derived type fix builds successfully. |

MongoDB compatibility: these are ordinary compound B-tree indexes and equality predicates; no new MongoDB-only feature beyond the established transaction requirement is introduced. Tested on disposable MongoDB 8.2.6. No managed production topology/index state was inspected. The existing unfiltered order feed/count may scan large result sets, and deep offset pagination still costs work; this is not a new claim of constant-cost or globally scan-free pagination. Search itself introduces no unrestricted regex/full-collection matching. Index rollout and realistic load testing remain production gates.

## Executed verification and exact counts

| Command/check | Result |
|---|---|
| Server `npm.cmd test` | **82/82 passed**, 21 suites; 0 failed/skipped/cancelled; exit 0 |
| Client `npm.cmd test` | **22/22 passed**, 2 suites; 0 failed/skipped/cancelled; exit 0 |
| Server `npm.cmd run type-check` | exit 0 |
| Server `npm.cmd run type-check:test` | exit 0 |
| Server `npm.cmd run lint` | exit 0 |
| Server `npm.cmd run build` | exit 0 |
| Client `npm.cmd run type-check` | exit 0 |
| Client `npm.cmd run lint` | exit 0 |
| Client `npm.cmd run build` | exit 0 |
| `git diff --check` | exit 0 |
| Production-rendered about/contact/privacy/shipping-return HTML | PASS: no fake email, placeholder banner or owner/setup instructions |
| Additional browser probes | Two defects reproduced (R1/R2), using synthetic intercepted API responses; these are not extra passing application tests |
| Secret/dependency check | 0 actual env-secret matches; dependency objects unchanged; no private env file in candidate set |
| Source immutability check | Reviewed implementation files and pre-existing reports/instructions have identical before/after SHA256 hashes |

Server reconciliation: 6 capability + 2 CAS-filter + 7 DB cleanup/readiness + 18 DB safety + 2 topology + 47 integration/HTTP = **82**. This is original 73 + 9 Phase 1 cases. Client is original 19 + 3 = **22**. Total **104 unique runner tests**. Parameterized bodies/iterations/assertions are not added again. The passing suite does not invalidate the independently reproduced UI gaps; existing client additions are config/source-contract tests, not behavioral React tests.

Disposable review database configuration:

```powershell
$env:MONGODB_TEST_MODE = 'disposable'
$env:MONGODB_TEST_URI = 'mongodb://127.0.0.1:28518/p1_review_test?replicaSet=rs0&directConnection=true'
$env:MONGODB_STANDALONE_URI = 'mongodb://127.0.0.1:28519/p1_standalone_test?directConnection=true'
npm.cmd test
```

Actual replica-set dbpath was verified against this review's unique temporary directory before fixtures. Tests retain the fail-closed Phase 0 guard. Seed tests called only the isolated core on that disposable database. Browser used existing installed Playwright/Chromium against the production-built local Next server on port 3032; requests were fulfilled with synthetic responses. No real account or production service was changed. The client build used an HTTPS canonical origin and an unreachable local API override, not the production API.

## Browser coverage still missing

- Add durable browser cases for R1/R2 after fixing them; prior implementation checks covered mutation-request failure, not successful-write/failed-readback behavior.
- Real-API browser customer cancellation from processing and the simultaneous shipment UI boundary have service/integration coverage, not a dedicated browser race test.
- Prior developer browser evidence covers account CRUD/default and admin search, but the new review does not claim to have independently repeated every previous happy-path real-API scenario. Its extra browser checks target the two identified gaps with intercepted responses.
- Keyboard-only flows, focus movement to errors/edit forms, screen-reader behavior for repeated address action names, 320px layouts and a comprehensive accessibility audit remain unverified. Shared controls provide labels and aria-invalid; that is not complete accessibility certification.

## Commit-file allowlist

**Conditional scope approval only:** after R1–R3 are resolved and reviewed, the following 25 current Phase 1 paths are the implementation/test/documentation set. No unconditional commit approval is issued by this report. Any additional paths required by the fixes (for example AuthProvider/AddressForm) must be included in the corrective review explicitly.

```text
API_DOCUMENTATION.md
DEPLOYMENT.md
client/app/about/page.tsx
client/app/contact/page.tsx
client/app/privacy/page.tsx
client/app/shipping-returns/page.tsx
client/components/admin/AdminOrders.tsx
client/components/auth/AccountPanel.tsx
client/components/auth/AccountEditor.tsx
client/components/layout/Footer.tsx
client/components/orders/OrderDetailClient.tsx
client/config/site.ts
client/lib/api/admin.ts
client/lib/api/user.ts
client/lib/__tests__/public-content.test.ts
client/package.json
server/src/config/password.ts
server/src/models/order.model.ts
server/src/schemas/admin.schema.ts
server/src/scripts/seed.ts
server/src/services/admin-order.service.ts
server/src/services/auth.service.ts
server/src/services/order.service.ts
server/src/services/user.service.ts
server/test/order-integrity.test.ts
```

Reports/packages/instructions are excluded from that code commit unless separately selected: original `AUDIT_REPORT.md`, `AGENTS.md`, all Phase 0 reports/package, Phase 1 implementation report/package and this review. Private `.env` files, dependencies, `.next`, `dist`, runtime logs, screenshots, temporary probe scripts and database files are excluded. No credentials or unrelated implementation files were detected among the 25 paths. Original audit hash remains `95E5F6BFA80C059E0108A825B99DEDE6389B6F9D82E55EBE5D477948060F44AF`.

## Production-release risks and handoff

Owner-approved actual contact details/hours and complete return/privacy terms remain unavailable; omission is preferable to fabrication but is not complete launch policy work. Roll out and verify the phone indexes through the approved deployment process before relying on production-scale search. Existing low-cost admin hashes require controlled verified-owner rotation; repeat seed deliberately does not rotate them. No production migration, seed, data change, merge, deployment or push occurred in this review.

Review evidence is retained outside the project in the unique `abstract-p1-review-*` temporary directory: runner log, browser findings JSON/screenshot and hash checks. Temporary services, dbpaths, fixtures and probe scripts are removed before handoff. Implementation and existing reports are left untouched. **Return for corrective work/owner approval; do not stage or commit Phase 1 yet.**
