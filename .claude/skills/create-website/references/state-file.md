# State file and resume

Location: `clients/<slug>/create-website.state.json`. It holds **no secrets**
(only key *names*), so you may read it directly, though `cw status <slug>
--json` is the better view: it adds the next step, the last error, a hint and
the redacted log tail. The file is committed in the record repo after each
phase. Never edit it by hand; the runner rewrites it atomically after every
status change and a hand edit is either lost or makes resume lie.

Lock: `clients/<slug>/.create-website.lock` = `{pid, runId, host, startedAt}`.
A live pid → exit 6 (`LOCKED`). A dead pid is taken over automatically with a
log line. Never delete the lock yourself.

## Fields that matter when you reason about a resume

| Field | Meaning |
|---|---|
| `runId` | stays the same across every resume of this slug. A different runId means a different provisioning: never mix them |
| `input.requestSha256` | sha of the request this slug was provisioned from. A new request with a different sha → `INPUT_CHANGED` |
| `input.source` | `file`, `crm` or `bare-json` |
| `templates.cms.commit`, `templates.platform.commit` | pinned SHAs; a resume reuses them even if `main` moved |
| `ports.site`, `ports.backend` | stable per slug (also in `clients/.create-website-ports.json`) |
| `db.name`, `db.createdByRun` | the DB and the run that created it. A DB that exists but wasn't created by this run is `DB_EXISTS` |
| `tenantId` | the backend tenant id, parsed from `seed:client-site` |
| `siteKey.mintedAt` | when the site's API key was minted. Unchanged across resumes unless the key stopped authenticating |
| `secrets` | which secret file holds which key names |
| `steps.<id>.status` | `pending`, `running`, `done`, `failed`, `skipped`, `planned` |
| `steps.<id>.attempts` | how many times `run()` was called; credentials should stay at 1 |
| `steps.<id>.error` | `{code, message, log}`; `log` is a redacted per-step log under `logs/<runId>/` |
| `steps.<id>.stale` | a dependency changed after this step was done; it will re-run |
| `processes.backend/site` | pid, port, log of the detached local servers |
| `verify` | `[{check, ok, detail}]` from the last verify |
| `crmOutbox` | provisioning-log entries; `sent:false` ones go out on the next run or `cw report-crm` |

## How the runner decides, per step, in order

1. A step found as `running` on load was interrupted (crash, kill, timeout). It
   becomes `failed` with code `CRASHED`, then the normal rules apply.
2. Outward step: never `run()`; status `planned`.
3. `skipReason` (e.g. `crm-site-record` with a file input): `skipped`.
4. State `done` + same fingerprint + `probe()` = `done`: skip.
5. `probe()` = `conflict`: stop with that code (exit 3). Nothing is changed.
6. `probe()` = `partial`: `recover()` cleans only artefacts tagged with this
   runId (e.g. `clients/.cw-tmp-<runId>-*`), then `run()`.
7. Otherwise `run()`.

The probe looks at the **world**, not at the state file: a git trailer, a file
and its sha, a database, an HTTP answer, a pid. So if someone deleted a
directory, the step re-runs; if the state file says `failed` but the world is
complete, the step is recorded `done` without re-running.

A `done` step whose fingerprint changed marks itself and every dependant
stale; they re-run. Exception: `backend-credentials` is irreversible. A stale
credentials step stops with `STALE_IRREVERSIBLE` (exit 3), because generating
new credentials would lock the realtor out and invalidate the site key. Explain
what changed (usually the contact e-mail in the request) and ask Josef; the
fix is normally to change the e-mail in the admin, not to regenerate.

## Things that are never regenerated

- `backend/.admin-credentials.local` values (admin and realtor passwords,
  `REVALIDATE_SECRET`): missing keys are added, existing ones kept.
- `PAYLOAD_SECRET` in `backend/.env`: changing it invalidates every session and
  every stored API key hash.
- The site key: re-minted only when the existing `CMS_API_KEY` in
  `site/.env.local` no longer authenticates against the backend. A re-mint
  changes `siteKey.mintedAt`, which makes `site-env` and `site-build` stale.

## Starting over

There is no `--new-run`. A fresh start is `cw teardown <slug> --yes
--confirm-slug <slug>` (local only, refuses if any outward step is done or a
repo has a remote) and then `cw run`. Only on Josef's explicit request.
