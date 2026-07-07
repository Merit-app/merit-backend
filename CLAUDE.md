# merit-backend

Express 5 + TypeScript (strict) REST API on Railway (`express ^5.2.1` — v5 semantics: async handler errors propagate to the error middleware automatically). Supabase (Postgres + Auth), Twilio SMS, Resend email, Stripe billing, BullMQ/Redis queues — every third-party service falls back to a mock when its creds are absent, so the API runs locally with zero secrets.

## Commands
- `npm run dev` — ts-node-dev on :3001
- `npm run typecheck` / `npm run lint` / `npm test` (vitest) — run before pushing
- Deploy: push to GitHub `main` → Railway auto-deploys → verify `GET /health/ready`

## Source of truth
- `SPEC.md` — the complete build spec (architecture, routes, schema, trust system). Don't deviate without flagging it.
- `FRONTEND_INTEGRATION.md` — the API contract the frontend depends on (`{ data }` / `{ error, message, details }` shapes, JWT auth header). Breaking it breaks prod.

## Non-negotiables
- **The service-role Supabase client bypasses RLS** (`src/config/supabase.ts`). Every query MUST scope by tenant: `.eq('user_id', …)`, `requireOrgAdmin`, or the chapter-coordinator check. There is no DB backstop (audit B3) — a missed filter is a silent cross-tenant leak.
- Routes thin, services fat. Zod-validate every input. Anything slow or third-party goes through a BullMQ queue, not the request loop.
- **Migrations are manual.** New SQL in `migrations/` must be run in the Supabase SQL editor before code depending on it ships. Always state explicitly when a push leaves a migration unapplied.
- Verification, trust, and fraud logic is the product's credibility. Changes to `verifications`, `trust.service`, `fraud.service`, or the Twilio/Stripe webhooks need extra care and tests.
- Known issues live in `../GAPS.md` (workspace root) — check it before diagnosing a "new" bug. **There are currently ZERO test files** (GAP-101) despite vitest being configured; every proven bug-fix should land with its regression test.
