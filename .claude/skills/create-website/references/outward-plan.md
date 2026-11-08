# The outward plan (production steps, not run)

In this phase the skill never touches anything outside the machine. The
outward steps (runbook 13–19) are computed with `plan()` only and written to
`clients/<slug>/outward-plan.md` (for people) and `outward-plan.json` (for
tools). Their state status is `planned`; the CRM log shows them `skipped` with
"local mode; plan in outward-plan.md". Every outward `apply()` throws
`OutwardDisabledError` (exit 7), guarded by a compile-time
`OUTWARD_ENABLED = false`. Josef (the lead) runs production by hand after
review; agents never push.

To show the plan without running anything: `cw plan <input> --outward --json`.

## Sections, in order (order matters: backend before site, because the site build reads the backend)

| Step | Runbook | What the plan contains |
|---|---|---|
| `github-repos` | 13 | `gh repo view OWNER/<repo> \|\| gh repo create OWNER/<repo> --public --source . --remote origin --push` for `backend-<slug>` and `site-<slug>`; public during development |
| `postgres-hosting` | 14 | one DB per client; provider still open (Neon EU as the example); the connection string goes straight into Vercel env, never a file in the repo |
| `vercel-projects` | 15 | `vercel link --yes --project <repo> --scope TEAM`, `vercel git connect`, `vercel deploy --prod`; backend first |
| `vercel-env` | 15 | one `vercel env add NAME production` per variable, value piped from a **secret reference** (see `cw secret-pipe` below); production credentials are new values in `backend/.env.production.local` / `site/.env.production.local`, never the dev ones |
| `fallback-domains` | 16 | `<slug>.<base>` → site, `admin.<slug>.<base>` → backend, via the Vercel API on realvista.cz (its nameservers are at Vercel, ours) |
| `deploy-hook` | 16 | **not needed (ISR)**: saves revalidate the site on demand; a git push redeploys code |
| `client-dns` | 17 | **instructions only, no command**: three records for the client to add at their registrar |
| `dependabot-enable` | 18 | `gh api -X PUT repos/OWNER/<repo>/vulnerability-alerts` and `…/automated-security-fixes` |
| `go-live` | 19 | repos private, CRM site status `live`, hosting fields filled, `[NÁVRH]` legal replaced first |

`OWNER` (GitHub org/user) and `TEAM` (Vercel team) stay placeholders until
Josef decides them.

## `cw secret-pipe`: secret references in the plan

The plan never contains a secret value. Wherever production needs one, it
uses one of three forms:

| Form | Meaning |
|---|---|
| `cw secret-pipe <slug> <file> <KEY> \| <command>` | read one value from a production secret file and pipe it to the command's stdin |
| `<command> \| cw secret-pipe --write <slug> <file> <KEY>` | capture a command's output (e.g. a minted key) straight into the file, unseen |
| `cw secret-pipe --generate <slug> <file> <KEY>` | generate a new value into the file if it is missing |

`cw secret-pipe` is a **documented placeholder in this phase and refuses in
local mode** (exit 7, `OUTWARD_REFUSED`). Never run it, and never substitute
it with `cat`, `grep` or `printf` on a secret file: that is exactly the leak the
indirection exists to prevent.

## Client DNS: records only, never nameservers

The plan's DNS section always has exactly these, for a client with a domain:

```
<domain>         A      76.76.21.21           → site-<slug>
www.<domain>     CNAME  cname.vercel-dns.com  → site-<slug> (redirects to apex)
admin.<domain>   CNAME  cname.vercel-dns.com  → backend-<slug>
```

Their MX records and nameservers stay untouched, so their e-mail keeps
working (`emailOnDomain: yes` is common). If the client has no domain
(`situation: none`), the section says the site runs on the fallback addresses
until they get one. If Josef or the client asks to move the nameservers to
Vercel "to keep it simple", say no and explain: it would move their whole DNS
zone, including mail, onto an account we control, and a missed MX record means
the realtor stops receiving e-mail. There is no NS or SOA record type in the
plan, by construction.

## Explaining the plan to Josef

- Say that nothing in it was executed, and that it is the exact list he (or a
  later phase of the skill) runs.
- Point at secret *references*: no value appears in the plan, and `cw
  secrets-check` confirms it.
- Mention the open decisions it depends on: Postgres provider, R2 bucket per
  client (production config throws without R2), GitHub owner, Vercel team.
- For "what happens in production" questions, `cw plan --outward` is the whole
  answer; don't run `cw run`.
