# MYRA

Internal platform for the MYRA private-stylist service. Next.js 14, Supabase, Anthropic, Cloudinary, and Higgsfield support the wider admin platform. See `SETUP.md` for the original environment walkthrough; this README is the operator guide for the **Outfit Quality Lab** added under the Private Stylist admin.

## Prerequisites

- Node.js 24 and npm.
- Access to the connected MYRA Platform Supabase project.
- An authenticated MYRA admin account.
- No Higgsfield CLI access is needed to operate or validate the composition-only Quality Lab. Higgsfield and Cloudinary remain in use by unrelated admin tools.

## Environment variables

Copy `.env.local.example` to `.env.local` and fill in values. Configuration uses the following variable **names**; values are never committed, logged, or documented:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server only — never exposed to the browser)
- `ADMIN_USER_ID` (the single admin auth user ID)
- `ANTHROPIC_API_KEY` (machine checks)
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (server only; used by unrelated media workflows, not by Quality Lab operations)
- `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` (existing non-secret public image configuration)

## Install and run

```bash
npm ci
npm run build
npm start -- --port 3100
```

The app must run on **port 3100** for Quality Lab validation. **Port 3000 is off-limits**: it belongs to the pre-existing development server and must never receive Quality Lab validation traffic, be stopped, or be reconfigured.

The Quality Lab lives at `/admin/private-stylist` → **OUTFIT QUALITY** tab. Every page and mutation is admin-only: the admin layout requires the verified session user to equal `ADMIN_USER_ID`, and every server action re-checks the session before any service-role work. Reviewer identity always comes from the verified session, never from request input.

## Operating the Quality Lab

Everything is **manual and bounded**. There is no scheduler, no always-on worker, and no automatic progression between stages.

1. **Create a draft batch** (Batches view): choose the dataset partition, exactly one context (a real member or an evaluation profile), an explicit stylist (no default, never a silent Chloe fallback), and a target count. Bounds: **1–150 candidates per batch**. Creating a batch generates nothing.
2. **Start** freezes the selected stylist's snapshot (rules, brief, masks, learned model, confirmed inspiration, envelope, and model/prompt versions). A stylist without enough confirmed inspiration runs **RULES ONLY** with a visible warning; no other stylist's inspiration is ever substituted.
3. **Generate next chunk** processes at most **25 candidates** per explicit action. Objective checks run first and fail closed; every objective-pass candidate — pass, rejection, or machine-check error — enters human review with the machine verdict hidden until after the human decision.
4. **Pause / resume** at any time. Pausing blocks new claims while claimed work finishes. Completing a chunk or a batch starts nothing automatically.
5. **Review** (Review Queue): one `Yes` or a structured `No` with a reason (item-specific reasons retain the affected item). Hold, history, filters, keyboard operation, safe undo, and explicit withdrawal are supported. An edit creates a new candidate version; it never rewrites the old one.
6. **Promote the approved composition**: an exact-version human `Yes` can promote the source-item composition once into the internal (non-live) `outfit`/`outfit_item` graph. The ordered frozen item membership is preserved, and nothing is rendered or published to customer surfaces. Review and canonical composition promotion are the end of the Quality Lab flow.

### Composition-only render boundary

The current Quality Lab is composition-only. No render, reconcile, fidelity, regeneration, Accepted Images, or image-promotion operation is available in the Quality Lab. Its render-family controls are unavailable, and direct Quality-Lab-specific render-family actions fail closed before provider, storage, queue, or database side effects. Approval authorizes only the canonical source-item composition promotion described above.

This disablement applies to the **Quality Lab only**. Other admin Higgsfield tools and routes remain available and unchanged; for example, the unrelated Higgsfield tools under `/admin/projects` still work. Do not disable or alter shared Higgsfield infrastructure when operating the Quality Lab.

### Learning scopes

Only `training` reviews teach anything, and only global outfit quality and the explicitly selected stylist:

| Human review | Global quality | Selected stylist | Member taste |
|---|---|---|---|
| Yes | positive | positive | none |
| No: global composition | negative | neutral | none |
| No: wrong for stylist | neutral | negative | none |
| No: operational data | none | none | none |
| No: wrong for member | none (diagnostic only) | none | none |

A `training` review also teaches the house itself, through the same stores Outfit Review and the Composer feed: a Yes is an approve decision in the selected stylist's Style Brain model plus approved material pairings; an item-level No ejects that piece against the anchor and records its pairings as rejections; a look-level No is a soft negative on the combination; a swap or removal made while editing is recorded as a swap. Generation reads the stylist's eye from the frozen snapshot — her learned model, her reference-image envelope and looks, and her brief's bans and pulls — so a batch composes through one lens, and what a round of reviews taught lands at the next **Start**, which re-freezes her. Generation also never re-serves a look: every composition already cased for the same stylist and member/profile (any batch, decided or not) is excluded by its item signature, and an anchor that already led a look is only revisited for a different combination. The NEW BATCH form defaults to `training` for this reason.

Undo and withdrawal append compensating ledger entries; history is never erased. Undo does not reverse what the Style Brain already learned from the decision. `validation`, `holdout`, `synthetic`, and `test` reviews, machine checks, and holds are learning-inert. The Coverage view reports volume, acceptance, machine agreement, rejection reasons, and coverage by stylist, evaluation profile, real member, style family, brand group, occasion, and partition — always labeled, with sparse-segment warnings instead of platform-wide claims. Programme stages (pilot 100–150, calibration 350–500, validation 1,000–1,500, rolling ≈5,000) are guidance only and never create or start work.

## Dataset partitions and test-data safety

Every Quality Lab batch, case, candidate, check, review, projection, and canonical composition promotion carries an immutable partition: `training`, `validation`, `holdout`, `synthetic`, or `test`.

- Automated tests may write **only** `data_partition='test'` rows under a unique `run_id`, recording every inserted ID in an exact manifest.
- Cleanup deletes **only** those exact IDs, children before parents, via the service-role-only `oq_test_cleanup(table, ids)` RPC. Broad cleanup (delete-all-test, date ranges, prefixes) is forbidden.
- Tests must never insert, update, or delete `training`, `validation`, `holdout`, `synthetic`, legacy, evaluation-profile, member, or unrelated rows. Read-only reconciliation of existing data is allowed.
- Hypothetical non-training behavior is covered by deterministic in-memory fixtures, not connected writes.
- The 444 legacy canonical outfits are imported once as Chloe-only `training` evidence (`oq_import_legacy_evidence`, service-role only) and are never re-attributed.

## Validation commands

The approved milestone gate is exactly:

```bash
npm test
npm run check:types
npx next lint --dir src/app/admin/private-stylist --dir src/app/admin/stylists --dir src/app/admin/ai --dir src/app/api --dir src/lib
npm run build
```

Notes:

- `npm test` includes connected suites that read `.env.local` and issue read-only or exactly-cleaned `test`-partition queries against the live project; they self-skip when env is absent.
- Full `npx tsc --noEmit` and full `npm run lint` carry documented pre-existing baseline findings outside the Quality Lab scope; the commands above are the approved gate.

## Out of scope for this release

Customer-facing Style item requests, "Being styled", Your Looks/Styled Items behavior, notifications, live-feed publishing, an always-on or cloud render worker, and automatic batch progression are all intentionally absent.
