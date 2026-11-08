# Exit codes and error codes

With `--json`, every failure prints
`{ok:false, code, step, message, hint, statePath}`. Use `code` to find the row
below; `hint` is the CLI's own suggestion and usually names the exact command.
The code list is `ERROR_CODES` in `tools/create-website/src/types.ts`; a unit
test checks every code there has a row here.

General rule: after any non-zero exit except 2, run `cw status <slug> --json`
before doing anything else.

## Exit codes

| Exit | Class | Default action |
|---|---|---|
| 0 | ok | hand-over |
| 1 | unexpected internal error | report the message to Josef; it is a bug in `cw` |
| 2 | invalid input | explain the issues, stop; the fix is in the CRM |
| 3 | conflict | explain, offer options, ask Josef; delete nothing |
| 4 | precondition | fix the environment or tell Josef the hint; then re-run |
| 5 | step failed (resumable) | diagnose from the step log, fix the cause, `cw run` again |
| 6 | locked | another run is live; wait or ask |
| 7 | outward refused | explain that production steps are plan-only |

## Error codes

| Code | Exit | Means | Tell Josef / do next |
|---|---|---|---|
| `INVALID_INPUT` | 2 | the request fails the schema or the catalog | List each `path: message` in plain words (e.g. "theme.variant: 'purple' isn't a REALVISTA colourway; valid are …"). Don't edit the JSON; ask him to fix the lead in the CRM and download it again |
| `RESERVED_SLUG` | 2 | slug is `www`, `admin`, `api`, `crm`, `demo` or `mail` | Those collide with platform hostnames. Propose `<brand>-reality` and ask |
| `INVALID_STARTER_COPY` | 2 | `starter-copy.json` fails `cw copy validate` | Fix the listed fields yourself (it's your file), following `czech-copy.md`, then `cw copy validate` and `cw run` |
| `CRM_UNQUALIFIED` | 2 | the CRM answered 422 for the lead | Translate `missing` into Josef's terms (`plan.tier` → tariff, `plan.billingPeriod` → billing period, `domain.situation` → whether the client has a domain, `domain.emailOnDomain` → whether they use e-mail on it). Qualification is finished in the CRM; don't PATCH the lead |
| `INPUT_CHANGED` | 3 | the slug already has state from a request with a different sha | Show what differs (brand, lead id). If it's the same client with an updated lead, ask whether to tear down and redo, or keep. If it's another lead, propose a free slug (`<slug>-2`) or a CRM-side slug change |
| `SLUG_TAKEN` | 3 | the slug's record/target dirs belong to another provisioning | as `INPUT_CHANGED` for a different lead |
| `TARGET_EXISTS` | 3 | `clients/backend-<slug>` or `site-<slug>` is non-empty and not ours (no template trailer) | Someone made it by hand. Offer to show `git log`/`ls` of it, or that Josef moves it away himself. Never delete or overwrite |
| `DB_EXISTS` | 3 | the DB exists but this run didn't create it | It may hold real data. Ask Josef: rename/drop it himself, or use a different slug. Never drop it |
| `PORT_BUSY` | 3 | the recorded port is held by a process that isn't ours | Name the port and the pid's command (`lsof -nP -iTCP:<port> -sTCP:LISTEN`). Ask before stopping anything; Josef's main apps live on 3000/3001/3003/3004. A `--site-port`/`--backend-port` override is the alternative |
| `STALE_IRREVERSIBLE` | 3 | a never-re-run step (credentials) had its inputs changed | Explain what changed (usually the contact e-mail). Regenerating would lock the realtor out; usually change the e-mail in the admin instead. Ask |
| `CONFIG_INVALID` | 4 | `create-website.config.json` missing or invalid | Show the path and the key; Josef's copy is `Makleri/create-website.config.json` |
| `PRECONDITION` | 4 | a generic precondition failed | Read `hint` and follow it |
| `TOOL_MISSING` | 4 | node ≥ 22, pnpm or git missing | Say which; installing tools is Josef's call |
| `TEMPLATE_TOO_OLD` | 4 | a template manifest is missing or `templateApiVersion` too old | Name the repo and the missing script; the cms branch with M1–M4 must be merged (or `cmsRef` pointed at it) |
| `POSTGRES_UNREACHABLE` | 4 | can't connect to the configured Postgres | "Postgres isn't running on host:port" (e.g. `brew services start postgresql@17`); re-run after |
| `NO_FREE_PORT` | 4 | no free port in the configured range | Name the range; ask whether to stop old clients (`cw stop <other>`) |
| `NOT_FOUND` | 4 | no state for that slug, or file not found | Check the slug spelling (`ls clients/`); for a new client start with `cw validate` |
| `CRM_NO_SITE` | 4 | the CRM answered 409: no site record for the lead | "Create the site in the CRM first" (win the deal, then create the site record) |
| `CRM_UNREACHABLE` | 4 | the CRM couldn't be reached when it was needed as *input* | Is the dev CRM on :3003 running? A CRM outage during *reporting* is not an error: the run exits 0 with `crm: pending`; later `cw report-crm <slug>` |
| `TEST_HOOKS_REFUSED` | 4 | `CW_TEST_HOOKS` set with a real config | Only tests/evals may use hooks; unset it |
| `STEP_FAILED` | 5 | a step's command failed | `cw status` → `error.log` (redacted per-step log). Common: install failed (network), migrate failed (DB), build failed (backend not up: `cw run` re-checks it). Fix, then `cw run`. Ask Josef after two identical failures |
| `CRASHED` | 5 | a step was `running` when the state was loaded (killed, timeout) | Just `cw run` again; probes and `recover()` handle the half-done step |
| `LOCKED` | 6 | another `cw` process holds the lock | Probably still running (or in another terminal). Wait, or ask Josef. Never delete the lock |
| `OUTWARD_REFUSED` | 7 | an outward `apply()` was invoked | Expected in this phase. Production steps are planned only: point at `outward-plan.md` |
| `EXEC_REFUSED` | 7 | the exec guard blocked a command (gh/vercel/neonctl/API host/nameserver/secret in argv) | It is a bug if `cw` itself triggered it; report it. Never work around it |

## Reading a step log

`cw status <slug> --json` returns `lastError.log` and a redacted `logTail`.
Logs are redacted (known secret values and `KEY=…` patterns replaced), so they
are safe to read with the Read tool. The files under `logs/<runId>/` are the
only logs you should open; never open `.env*` or credential files to "check a
value".
