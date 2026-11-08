# Step map: step id ↔ runbook ↔ CRM log

Source of truth in code: `tools/create-website/src/steps/registry.ts`. This
table must match it (a unit test compares the ids and CRM names).

Runbook = `docs/provisioning/client-1-runbook.md`. Runbook steps 1–3 (start a
CRM, submit the lead, qualify/convert/win/create the site record) are CRM-side
staff work; the skill only checks step 3's result (`crm-site-record`).

"Never re-run" means: once done, a changed input stops the run with
`STALE_IRREVERSIBLE` instead of regenerating, and you ask Josef.

| # | Step id | Phase | Runbook | CRM log name | What it does | Probe (looks at the world) |
|---|---|---|---|---|---|---|
| 1 | `preflight` | A | — | — | node ≥ 22, pnpm, git, Postgres, template manifests, config, ports | always re-runs |
| 2 | `input` | A | 4 | `provisioning-json` | load + validate the request, write `provisioning-request.json` + `provisioning.json` | files present with the recorded sha |
| 3 | `crm-site-record` | A | 3 (check) | — | lead input: site exists, slug matches, status `provisioning`; file input: skipped | read-only |
| 4 | `record-repo` | A | — | — | `git init clients/<slug>`, commit request + JSON | commit trailer `Create-Website-Step: record-repo` |
| 5 | `backend-copy` | B | 5 | `backend-repo-local` | `git archive cms@<sha>` → temp dir → rename to `backend-<slug>`, first commit | first commit trailer `Create-Website-Template: cms@<sha>`; non-empty dir without it = `TARGET_EXISTS` |
| 6 | `backend-customize` | B | F14 | `backend-repo-local` | client README, `.github/dependabot.yml`; commit | commit trailer |
| 7 | `backend-install` | B | 5 | `backend-repo-local` | `pnpm install --frozen-lockfile` | `node_modules/.modules.yaml` + lockfile sha |
| 8 | `backend-db` | B | 6 | `backend-seed` | `CREATE DATABASE <prefix>backend_<slug>_dev` | DB exists and was created by this run; else `DB_EXISTS` |
| 9 | `backend-env` | B | 6 | `backend-seed` | `.env` 0600: `DATABASE_URL`, `PAYLOAD_SECRET`, `PORT`, `PLATFORM_SUBDOMAIN_BASE` | keys present; only missing keys added, never overwritten |
| 10 | `backend-credentials` | B | 7 | `backend-seed` | `.admin-credentials.local` 0600 | file present; **never re-run** |
| 11 | `backend-migrate` | B | 6 | `backend-seed` | `pnpm migrate` | always re-runs (idempotent) |
| 12 | `backend-seed-admin` | B | 8 | `backend-seed` | `pnpm seed:admin` (upsert) | re-runs |
| 13 | `starter-copy` | B | 8 | `backend-seed` | `starter-copy.json` (tone default if absent), validated | file present and valid |
| 14 | `backend-seed-content` | B | 8 | `backend-seed` | `pnpm seed:client-site`: tenant upsert + starter content | fingerprint incl. starter-copy sha; users untouched |
| 15 | `backend-seed-realtor` | B | 8 | `backend-seed` | `pnpm seed:client` (upsert by e-mail) | re-runs |
| 16 | `backend-start` | B | 9 | `backend-seed` | detached `next dev --port <bp>` | HTTP `/api/site-settings` up + pid alive; port held by a foreign pid = `PORT_BUSY` |
| 17 | `site-key` | B | 10 | `backend-seed` | `pnpm seed:site-key` → key into the secret store (never stdout) | existing key authenticates (HTTP 200) = done, **no re-mint** |
| 18 | `site-copy` | C | 11 | `site-repo-local` | export `apps/site` closure at platform@HEAD, first commit | trailer `Create-Website-Template: platform@<sha>` |
| 19 | `site-standalone` | C | 11 | `site-repo-local` | generated package.json, tsconfig, next.config, site.urls/config, globals.css, …; one commit | trailer + fingerprint |
| 20 | `site-env` | C | 10/11 | `site-repo-local` | `.env.local` 0600: CMS URL, `TENANT_ID`, `CMS_API_KEY`, `REVALIDATE_SECRET` | keys equal the secret store |
| 21 | `site-install` | C | 12 | `site-repo-local` | `pnpm install`; commit `pnpm-lock.yaml` | as 7 |
| 22 | `site-build` | C | 12, F11 | `site-repo-local` | ensures the backend is healthy, `pnpm build` | `.next/BUILD_ID` + build fingerprint |
| 23 | `site-start` | C | 12 | `site-repo-local` | detached `next start --port <sp>` | HTTP `/` 200 with the right `data-variant` |
| 24 | `verify` | D | D | `verify` | acceptance checks incl. `secrets-check` | always re-runs |
| 25 | `crm-report` | — | log | — | flush the CRM outbox | server-side key dedupe |
| 26 | `github-repos` | E | 13 | `github-repos` | **planned only** | — |
| 27 | `postgres-hosting` | E | 14 | `postgres-hosting` | planned only | — |
| 28 | `vercel-projects` | E | 15 | `vercel-projects` | planned only | — |
| 29 | `vercel-env` | E | 15 | `vercel-env` | planned only (secret references, never values) | — |
| 30 | `fallback-domains` | E | 16 | `fallback-dns` | planned only | — |
| 31 | `deploy-hook` | E | 16 | `deploy-hook` | "not needed (ISR)" | — |
| 32 | `client-dns` | E | 17 | `client-dns` | instructions only: A apex, CNAME www/admin; never NS | — |
| 33 | `dependabot-enable` | E | 18 | `dependabot` | planned only | — |
| 34 | `go-live` | E | 19 | `go-live` | planned only | — |
| 35 | `outward-plan` | E | — | — | writes `outward-plan.md` + `.json` from every outward `plan()` | regenerated |
| 36 | `handover` | — | — | — | summary JSON (URLs, file paths, TODOs) | — |

The design doc numbers outward steps 26–33 and lists nine names; the registry
has all nine, so the count is 36 entries in code. Order is the topological
order the runner uses.

## CRM log entries for one complete local run

Keys are `<runId>:<crmName>:<status>`, sent once each (the CRM dedupes on key):

```
provisioning-json ok
backend-repo-local ok
backend-seed ok
site-repo-local ok
verify ok
github-repos skipped   postgres-hosting skipped   vercel-projects skipped
vercel-env skipped     fallback-dns skipped       deploy-hook skipped
client-dns skipped     dependabot skipped         go-live skipped
```

Coarse names (`backend-seed`, `site-repo-local`) are reported `ok` once all
their steps are done, and `failed` with the step id in `detail` if one fails.
Skipped entries carry the detail "local mode; plan in outward-plan.md".
