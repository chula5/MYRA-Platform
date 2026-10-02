# MYRA

Internal platform for the MYRA private-stylist service. Next.js 14, Supabase, Anthropic, Cloudinary, and a locally authenticated Higgsfield CLI. See `SETUP.md` for the original environment walkthrough; this README is the operator guide for the **Outfit Quality Lab** added under the Private Stylist admin.

## Prerequisites

- Node.js 24 and npm.
- Access to the connected MYRA Platform Supabase project.
- The `@higgsfield/cli` installed and authenticated locally (`higgsfield auth token`) for render draining. Rendering is local-only: Vercel never drains the Quality Lab queue.
- Cloudinary credentials for durable image persistence.

## Environment variables

Copy `.env.local.example` to `.env.local` and fill in values. The Quality Lab requires these variables to be **named** (values are never committed, logged, or documented):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server only — never exposed to the browser)
- `ADMIN_USER_ID` (the single admin auth user ID)
- `ANTHROPIC_API_KEY` (machine checks)
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (server only; the render pipeline fails closed when they are missing)
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
6. **Render**: only an exact-version human `Yes` can enqueue a render — enforced by the database transaction, not just the UI. Drain the queue **explicitly and locally** (Accepted Images view → drain action, at most 5 jobs sequentially) on the machine with the authenticated Higgsfield CLI. Each render uses the frozen source manifest, persists durably to Cloudinary, then runs the fidelity check against the frozen source items. One conclusive fidelity failure receives exactly one corrective retry; a second failure or any unavailable/errored check fails closed into `attention_required` and stays hidden.
7. **Accepted Images**: fidelity-passed images are ready without a second review. `Not good enough` removes one with a required reason (image fidelity, image quality, or underlying outfit) and offers explicit regeneration or outfit withdrawal. Approved outfits are promoted once into the internal (non-live) `outfit`/`outfit_item` graph; nothing is published to customer surfaces.

### Learning scopes

Only `training` reviews teach anything, and only global outfit quality and the explicitly selected stylist:

| Human review | Global quality | Selected stylist | Member taste |
|---|---|---|---|
| Yes | positive | positive | none |
| No: global composition | negative | neutral | none |
| No: wrong for stylist | neutral | negative | none |
| No: operational data | none | none | none |
| No: wrong for member | none (diagnostic only) | none | none |

Undo and withdrawal append compensating ledger entries; history is never erased. `validation`, `holdout`, `synthetic`, and `test` reviews, machine checks, and holds are learning-inert. The Coverage view reports volume, acceptance, machine agreement, rejection reasons, and coverage by stylist, evaluation profile, real member, style family, brand group, occasion, and partition — always labeled, with sparse-segment warnings instead of platform-wide claims. Programme stages (pilot 100–150, calibration 350–500, validation 1,000–1,500, rolling ≈5,000) are guidance only and never create or start work.

## Dataset partitions and test-data safety

Every batch, case, candidate, check, review, render, projection, and promotion carries an immutable partition: `training`, `validation`, `holdout`, `synthetic`, or `test`.

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
