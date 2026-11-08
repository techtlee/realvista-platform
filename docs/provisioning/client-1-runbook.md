# Client #1 runbook: `novak-test`, done by hand

Written 2026-11-08 while building client #1 (the fictional `novak-test`)
locally, step by step, as `ARCHITECTURE.md` requires ("Write it after the first
client has been done by hand"). The numbered steps below are the future
`/create-website` skill. Each step says whether it is **resumable** (safe to
re-run after a failure without duplicates or broken state) and what it records.

Inputs used: platform `main` 6411b88, cms `main` 4d7f8ed, crm `main` 18adcb4.

## Result

| What | Where | Port / DB |
|---|---|---|
| Provisioning record (intake request, JSON, config generator) | `Makleri/clients/novak-test/` (local git) | — |
| Client backend (CMS, admin) | `Makleri/clients/backend-novak-test/` (local git) | **3027**, DB `backend_novak_test_dev` |
| Client site | `Makleri/clients/site-novak-test/` (local git) | **3017** (`next start`, production build) |
| Temporary CRM for step 1 (stopped) | `Makleri/crm` main, env vars on the command line | 3029, DB `realvista_crm_wp7` (kept) |

Secrets live only in gitignored files, never in a commit or in output:
`backend-novak-test/.env`, `backend-novak-test/.admin-credentials.local`
(platform admin, the realtor's login, the revalidate secret, the site key),
`site-novak-test/.env.local`.

Click through: http://localhost:3017 (site), http://localhost:3027/admin
(log in as the realtor with `CLIENT_EMAIL`/`CLIENT_PASSWORD` from
`backend-novak-test/.admin-credentials.local`).

Nothing was pushed or created outside this machine. Steps 13–19 are
**PENDING JOSEF**: written out with exact commands, not run.

---

## Phase A: lead → provisioning JSON (internal CRM)

### 1. Start a CRM to work against *(resumable: yes)*

In production this is crm.realvista.cz and the step does not exist. Locally
for client #1 a throwaway CRM on its own DB:

```sh
cd Makleri/crm
createdb realvista_crm_wp7
export DATABASE_URL="$(grep ^DATABASE_URL= .env | cut -d= -f2- | sed 's#/realvista_crm_dev$#/realvista_crm_wp7#')"
pnpm migrate                                   # baseline 20261108_101546 applied
set -a; . ./.admin-credentials.local; set +a; pnpm seed:admin
PORT=3029 pnpm dev                             # env on the command line; crm/.env untouched
```

`pnpm seed:crm` was skipped on purpose: it appends a staff password to
`crm/.admin-credentials.local`, i.e. writes into the crm repo.

### 2. Submit the lead *(resumable: no, creates a lead each time)*

The storefront fixture `crm/tests/fixtures/storefront-lead.json`, adjusted for
Novák (fictional data, no IČO): colourway `clay`, home order
`hero, agent, featured, stats, services, blog, contact` (deliberately not the
theme default, so the site visibly proves it read the JSON), tone `formal`.
Saved as `clients/novak-test/intake-request.json`.

```sh
curl -s -X POST http://localhost:3029/api/intake -H 'content-type: application/json' \
  --data @clients/novak-test/intake-request.json
# {"id":1} HTTP 201
```

### 3. Qualify, convert, win, create the site record *(resumable: partly; each call is guarded, see notes)*

As the CRM admin (credentials read from `crm/.admin-credentials.local` into
env, never echoed):

```sh
C=http://localhost:3029
set -a; . crm/.admin-credentials.local; set +a
TOKEN=$(jq -n --arg e "$CRM_ADMIN_EMAIL" --arg p "$CRM_ADMIN_PASSWORD" '{email:$e,password:$p}' \
  | curl -s -X POST $C/api/users/login -H 'content-type: application/json' --data @- | jq -r .token)
A=(-H "Authorization: JWT $TOKEN" -H 'content-type: application/json')

curl -s "${A[@]}" $C/api/leads/1/provisioning-json
# {"missing":["domain.situation","domain.emailOnDomain","plan.tier","plan.billingPeriod"]} HTTP 422

curl -s "${A[@]}" -X PATCH $C/api/leads/1 --data '{
  "domain":{"situation":"have-access","name":"novak-test.cz","registrar":"wedos","emailOnDomain":"yes"},
  "plan":{"tier":"standard","billingPeriod":"yearly"}}'
curl -s "${A[@]}" -X POST  $C/api/leads/1/convert              # {"organization":1,"contact":1,"deal":1} 201
curl -s "${A[@]}" -X PATCH $C/api/deals/1 --data '{"stage":"won"}'
curl -s "${A[@]}" -X POST  $C/api/deals/1/create-site --data '{"slug":"novak-test"}'
# {"site":1,"slug":"novak-test"} 201
# site: hosting.domain novak-test.cz, fallbackSubdomain novak-test.realvista.cz,
#       adminDomain admin.novak-test.cz, provisioningLog [site-record: ok]
```

The schema's "client has a domain" value is `situation: "have-access"`
(others: `have-no-access`, `none`). Re-running: convert answers 409 "Zájemce
už má obchod", create-site 409 "Obchod už má založený web"; both safe.

### 4. Fetch and check the provisioning JSON *(resumable: yes, read-only)*

```sh
curl -s "${A[@]}" $C/api/leads/1/provisioning-json -o clients/novak-test/provisioning.json   # HTTP 200
```

Checks, all passed:

- `schemaVersion: 1`; `theme {realvista, clay}`; `sections.home` = the 7 ids in
  the order submitted; `modules` blog/services/listingMap/mortgageCalculator
  true, references false; `domain`/`plan` as qualified.
- Re-validated with the **canonical** schema too (platform
  `@makleri/selection`, not the crm's vendored copy):
  `createProvisioningSchema(catalog).safeParse(json)` → OK.

---

## Phase B: backend-novak-test (client CMS)

### 5. Copy the backend template *(resumable: yes if the target dir is empty; otherwise skip)*

```sh
mkdir -p clients/backend-novak-test
git -C cms archive --format=tar main | tar -x -C clients/backend-novak-test
cd clients/backend-novak-test && git init -b main && git add -A \
  && git commit -m "Copy of realvista-client-backend template (cms main 4d7f8ed)"
pnpm install
```

The unmodified copy is committed first, so every client-specific change is a
visible diff on top of it.

### 6. Database and env *(resumable: yes; `createdb` fails harmlessly if it exists)*

```sh
createdb backend_novak_test_dev
# .env (gitignored, chmod 600): DATABASE_URL=…/backend_novak_test_dev, PAYLOAD_SECRET=$(openssl rand -hex 32),
#                               PORT=3027, PLATFORM_SUBDOMAIN_BASE=realvista.cz
pnpm migrate            # 20261108_100819_baseline applied
```

### 7. Generate local credentials *(resumable: NO; regenerating breaks existing logins and the site key, so skip if the file exists)*

`.admin-credentials.local` (gitignored, umask 077), all values from
`openssl rand`: `MAKLERI_ADMIN_EMAIL/PASSWORD` (our platform admin),
`TENANT_SLUG=novak-test`, `CLIENT_EMAIL=jan.novak@novak-test.cz`,
`CLIENT_PASSWORD`, `REVALIDATE_SECRET`. Step 10 appends `SITE_CMS_API_KEY`.

### 8. Tenant + starter content *(resumable: yes)*

New script in the client copy, `src/scripts/seedClientSite.ts`
(`pnpm seed:client-site`). It upserts the tenant by slug from the JSON (name,
theme, `hosting.domain`, `hosting.platformSubdomain`, `hosting.siteUrl`,
`revalidateSecret`) and replaces only the tenant's **content**: site settings,
legal drafts, 4 services, 2 posts, 4 Plzeň listings with coordinates and
placeholder photos, Czech copy chosen by `content.tone`. Users are left alone,
so a re-run keeps the realtor's login and the site key valid (verified: re-ran
it, key still 200).

```sh
set -a; . ./.admin-credentials.local; set +a
pnpm seed:admin                                                     # Created platform-admin
PROVISIONING_JSON=../novak-test/provisioning.json SITE_URL=http://localhost:3017 \
  pnpm seed:client-site                                             # TENANT_ID=1, 4 listings, 4 services, 2 posts
pnpm seed:client                                                    # realtor login: CLIENT_USER_ID=2, tenant 1
```

Legal texts are marked `[NÁVRH – před spuštěním nahradit]` and must be replaced
before go-live.

### 9. Run the backend *(resumable: yes)*

```sh
PORT=3027 pnpm dev      # PORT on the command line; see friction F12
```

### 10. Mint the site's API key *(resumable: yes; re-running replaces the key, so re-do step 11's env afterwards)*

Needs the backend running. The key is captured into files, never printed:

```sh
OUT=$(TENANT_SLUG=novak-test CMS_PROBE_URL=http://localhost:3027 pnpm seed:site-key 2>&1)
# "# verified: HTTP 200 from /api/site-settings (user 3)"
# → site-novak-test/.env.local: NEXT_PUBLIC_CMS_URL, TENANT_ID=1, CMS_API_KEY, REVALIDATE_SECRET
# → SITE_CMS_API_KEY appended to backend .admin-credentials.local
```

**Always pass `CMS_PROBE_URL`.** Its default is `http://localhost:3000`, which
is Josef's main CMS (F7).

---

## Phase C: site-novak-test (standalone site)

### 11. Copy, flatten, configure *(resumable: yes if the target dir is empty)*

```sh
S=clients/site-novak-test; mkdir -p $S && git -C $S init -b main
git -C platform archive main apps/site | tar -x --strip-components=2 -C $S
mkdir -p $S/src/makleri
git -C platform archive main packages/core/src packages/config/src \
  packages/theme-kit/src/index.ts packages/theme-realvista/src packages/theme-realvista/styles \
  | tar -x --strip-components=1 -C $S/src/makleri
# + .gitignore, commit the unmodified copy ("Copy of the REALVISTA site template (platform main 6411b88)")
```

Then the edits that make it standalone (one commit, all mechanical, all for
the skill to do):

| File | Change |
|---|---|
| `package.json` | name `site-novak-test`; registry deps only, pinned to the versions the monorepo resolves (next 16.3.6, react 19.3.0, zod 4.6.5, tailwind 4.3.3, typescript 5.9.3); `dev`/`start` default to port 3017 |
| `tsconfig.json` | `@makleri/config/tsconfig.base.json` inlined; `paths` map each `@makleri/*` entry point to its file under `src/makleri/` (so the copied sources need no import changes) |
| `src/makleri/**` | relative `./x.js` imports → `./x` (`sed -E "s#(from '\.\.?/[^']*)\.js'#\1'#g"`). Turbopack does not map `.js` to `.ts`; the template only ever consumed compiled `dist/` (F3) |
| `next.config.ts` | no longer imports `site.config.ts`; `siteUrl`/`cmsUrl` written as literals (F2) |
| `app/globals.css` | `@import '../src/makleri/theme-realvista/styles/theme.css'` and `@source "../src/makleri/theme-realvista/src"` (the template pointed at `node_modules/…/dist` and `../../../packages/…`) |
| `site.config.ts` | generated, below |
| `.env.example` | points at this client's backend, not `../../../cms` |

`site.config.ts` is generated from the JSON through the canonical mapping:

```sh
node clients/novak-test/generate-site-config.mjs \
  clients/novak-test/provisioning.json novak-test clients/site-novak-test/site.config.ts
# {"theme":{"name":"realvista","variant":"clay"},
#  "features":{"blog":true,"listingMap":true,"mortgageCalculator":true},
#  "sections":["hero","agent","featured","stats","services","blog","contact"]}
```

The generator validates with `createProvisioningSchema(catalog)`, maps with
`toSiteConfigInput` (colourway, modules → `features` with an explicit
`features.blog`, section order, brand, locale, `domain` = the fallback
`novak-test.realvista.cz` until `customDomainLive`), and writes a literal file.
Only `cms.url` (`NEXT_PUBLIC_CMS_URL`, default
`https://admin.novak-test.realvista.cz`) and `tenantId` come from the env.

### 12. Build and run *(resumable: yes)*

```sh
cd clients/site-novak-test && pnpm install && pnpm build && pnpm start   # port 3017
```

The build needs the backend up: the home, listing and blog pages are
prerendered from it (`generateStaticParams`).

---

## Phase D: acceptance (actual output)

Standalone check, on a fresh `git clone` of the site repo **outside** the
Makleri tree (scratch dir) with only `.env.local` copied in:

```
$ grep -rn "workspace:\|link:\|\.\./" package.json
(no matches, exit 1)
$ pnpm install && pnpm build
▲ Next.js 16.3.6 (Turbopack)
✓ Compiled successfully in 3.7s
Route (app)                                                     Revalidate  Expire
┌ ○ /                                                                   1h      1y
├ ƒ /api/media/file/[name]   ├ ƒ /api/poptavka   ├ ƒ /api/revalidate
├ ○ /blog  (2 posts SSG)     ├ ○ /cookies        ├ ○ /nemovitosti (4 listings SSG)
├ ƒ /poptavka-odeslana       └ ○ /zasady-ochrany-osobnich-udaju
$ pnpm typecheck
typecheck exit 0
```

Also: 61 relative import specifiers in the repo checked, 0 resolve outside it;
`node_modules/@makleri` does not exist.

Running site on 3017 against the backend on 3027:

```
html data-variant: clay
title: Jan Novák Reality
rendered order: ['hero', 'agent', 'featured', 'stats', 'services', 'blog', 'contact']
expected order: ['hero', 'agent', 'featured', 'stats', 'services', 'blog', 'contact']
compiled CSS: [data-variant=clay] block present, .text-brand present, pt-[150px] present
/nemovitosti 200 · /nemovitosti/prodej-bytu-3-kk-74-m-plzen-slovany 200 (OSM iframe, marker 49.73810,13.39290)
/blog 200 · /zasady-ochrany-osobnich-udaju 200 (seeded draft text) · /cookies 200
/api/media/file/hero-1600x900.jpg 200 image/jpeg (proxied with the site key)
```

Enquiry form → backend:

```
enquiries before: 0
POST /api/poptavka (name, email, phone, message, consent) -> 303 /poptavka-odeslana
honeypot POST (website filled)                            -> 303 /poptavka-odeslana (not stored)
enquiries after: 1
1|tenant 1|Petra Svobodová|petra.svobodova@example.cz|…|consent t|Odesláním formuláře souhlasím…|source /|new
realtor's REST view of /api/enquiries: totalDocs 1
```

Edit → site: realtor logs in to the backend, PATCHes the hero headline →
visible on http://localhost:3017 within 2 s. **This only worked after the
backend workaround for bug B1** (before it, saves never reached the site).

Steps written back to the CRM site record (`PATCH /api/sites/1`,
`provisioningLog`): `site-record ok, provisioning-json ok, backend-repo-local
ok, backend-seed ok, site-repo-local ok, github-repos skipped, vercel-projects
skipped, fallback-dns skipped`.

---

## Gap: "static, rebuilt by a deploy hook" vs ISR

ARCHITECTURE.md says the site is static, reads the admin at build time, and a
save triggers a rebuild through the site's Vercel deploy hook. What
`apps/site` (and so `site-novak-test`) actually does:

- pages are ISR (`revalidate = 3600`) with fetch cache tags per tenant;
- the backend's `afterChange`/`afterDelete` hooks POST `/api/revalidate` with
  the tenant's `revalidateSecret`; the site purges the tags and re-renders on
  the next request (~1 s, measured);
- three routes are dynamic and need a server anyway: `/api/poptavka` (the
  enquiry form), `/api/media/file/[name]` (media proxy with the site's key,
  until R2 serves public URLs) and `/api/revalidate`.

So the site is not static today, and could not be without moving the form and
the media. Options, not decided here:

1. **Keep ISR + on-demand revalidation; amend ARCHITECTURE.** Works now, edits
   show in ~1 s, no build minutes per save. The site is "mostly static" on
   Vercel (prerendered pages, three small functions). No deploy hook needed
   for content, only for template/config changes (a git push does that).
2. **Truly static (`output: 'export'`) + deploy hook on save.** Requires the
   form to post to the backend directly (CORS or a backend-hosted form
   endpoint plus redirect back), media on R2 public URLs (drops the proxy),
   and removes `/api/revalidate`. Every save costs a full build (~1 min) and
   build minutes; bursts of edits need debouncing.
3. **Hybrid:** ISR as in 1, plus a deploy hook fired only for changes that
   need a rebuild (none today: new listings render through
   `dynamicParams`/ISR).

The provisioning steps below are written for option 1 (what exists). For
option 2 the backend needs a `DEPLOY_HOOK_URL` and a hook that calls it;
step 16 shows how to create one either way.

---

## Phase E: outward steps, PENDING JOSEF (not executed)

Order matters: backend before site (the site build reads the backend).
`OWNER` = the GitHub org/user, `TEAM` = the Vercel team slug. Every command
reads secrets from the local gitignored files, never from the command line
history in clear.

### 13. GitHub repos *(resumable: yes; `gh repo view` first, create only if missing)*

```sh
for r in backend-novak-test site-novak-test; do
  cd clients/$r
  gh repo view OWNER/$r >/dev/null 2>&1 || gh repo create OWNER/$r --public --source . --remote origin --push
  cd -
done
```

Public during development (Josef's decision); go-live is step 19.

### 14. Postgres for the backend *(resumable: yes if named; check before create)*

One database per client. Provider not yet chosen (ARCHITECTURE "Still open").
With Neon (EU region), for example:

```sh
neonctl projects create --name backend-novak-test --region-id aws-eu-central-1 --output json \
  | jq -r '.connection_uris[0].connection_uri' > /tmp/novak-db-url   # then into Vercel env, delete the file
```

Schema: no manual step. `prodMigrations` runs pending migrations on first boot.

### 15. Vercel projects + env *(resumable: yes; `vercel project ls` first)*

```sh
cd clients/backend-novak-test
vercel link --yes --project backend-novak-test --scope TEAM
vercel git connect                                   # links OWNER/backend-novak-test
printf %s "$DB_URL"                       | vercel env add DATABASE_URL production
openssl rand -hex 32 | tr -d '\n'         | vercel env add PAYLOAD_SECRET production
printf realvista.cz                       | vercel env add PLATFORM_SUBDOMAIN_BASE production
# R2 is REQUIRED in production (the config throws without it):
for k in R2_BUCKET R2_ENDPOINT R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_PUBLIC_URL; do
  printf %s "${!k}" | vercel env add $k production; done
vercel deploy --prod

# Seed production once it is up (NODE_ENV=production: no schema push; R2 vars required):
set -a; . ./.admin-credentials.local; set +a      # new production passwords: regenerate, don't reuse dev ones
DATABASE_URL=… PAYLOAD_SECRET=… NODE_ENV=production R2_…=… pnpm seed:admin
… PROVISIONING_JSON=../novak-test/provisioning.json SITE_URL=https://novak-test.realvista.cz pnpm seed:client-site
… pnpm seed:client
… TENANT_SLUG=novak-test CMS_PROBE_URL=https://admin.novak-test.realvista.cz pnpm seed:site-key   # capture, don't print

cd ../site-novak-test
vercel link --yes --project site-novak-test --scope TEAM && vercel git connect
printf https://admin.novak-test.realvista.cz | vercel env add NEXT_PUBLIC_CMS_URL production
printf 1                                     | vercel env add TENANT_ID production
printf %s "$CMS_API_KEY"                     | vercel env add CMS_API_KEY production
printf %s "$REVALIDATE_SECRET"               | vercel env add REVALIDATE_SECRET production
vercel deploy --prod
```

### 16. Fallback addresses on realvista.cz *(resumable: yes; adding an existing domain returns a conflict, treat as done)*

realvista.cz's nameservers are at Vercel, so this is API calls only:

```sh
H=(-H "Authorization: Bearer $VERCEL_TOKEN" -H 'content-type: application/json')
curl -s "${H[@]}" -X POST "https://api.vercel.com/v10/projects/site-novak-test/domains?slug=TEAM"    --data '{"name":"novak-test.realvista.cz"}'
curl -s "${H[@]}" -X POST "https://api.vercel.com/v10/projects/backend-novak-test/domains?slug=TEAM" --data '{"name":"admin.novak-test.realvista.cz"}'
# Records only if Vercel DNS does not already resolve them for the team's projects:
curl -s "${H[@]}" -X POST "https://api.vercel.com/v2/domains/realvista.cz/records?slug=TEAM" --data '{"name":"novak-test","type":"CNAME","value":"cname.vercel-dns.com"}'
curl -s "${H[@]}" -X POST "https://api.vercel.com/v2/domains/realvista.cz/records?slug=TEAM" --data '{"name":"admin.novak-test","type":"CNAME","value":"cname.vercel-dns.com"}'
```

Deploy hook (only needed for option 2/3 of the gap above; verify the endpoint
against the current Vercel API reference before automating):

```sh
curl -s "${H[@]}" -X POST "https://api.vercel.com/v1/projects/site-novak-test/deploy-hooks?slug=TEAM" --data '{"name":"backend-save","ref":"main"}'
# store the returned URL as DEPLOY_HOOK_URL on backend-novak-test (no code reads it yet)
```

### 17. Client DNS *(resumable: yes; records only, NEVER nameservers)*

Send the realtor (registrar recorded in the JSON: `wedos`):

```
novak-test.cz         A      76.76.21.21           → site-novak-test
www.novak-test.cz     CNAME  cname.vercel-dns.com  → site-novak-test (redirects to apex)
admin.novak-test.cz   CNAME  cname.vercel-dns.com  → backend-novak-test
```

Their MX records stay untouched (`emailOnDomain: yes`). Then add the domains
to the projects (same call as step 16 with `novak-test.cz`, `www.novak-test.cz`
with a redirect to apex, `admin.novak-test.cz`), set the JSON-derived
`customDomainLive: true`, regenerate `site.config.ts` (`domain` becomes
`novak-test.cz`), update `NEXT_PUBLIC_CMS_URL` to `https://admin.novak-test.cz`
and the tenant's `hosting.siteUrl` to `https://novak-test.cz`
(`SITE_URL=… pnpm seed:client-site` is safe to re-run, but it also resets the
content; for a live client set `hosting.siteUrl` in the admin instead).

### 18. Dependabot *(resumable: yes)*

`.github/dependabot.yml` is already committed in both repos (weekly npm,
Next/React and Payload grouped). After push:

```sh
for r in backend-novak-test site-novak-test; do
  gh api -X PUT repos/OWNER/$r/vulnerability-alerts
  gh api -X PUT repos/OWNER/$r/automated-security-fixes
done
```

### 19. Go-live: private repos, status *(resumable: yes)*

```sh
for r in backend-novak-test site-novak-test; do
  gh repo edit OWNER/$r --visibility private --accept-visibility-change-consequences; done
```

Then in the CRM: site `status: live` (sets `liveSince`), fill
`hosting.siteRepo/backendRepo/vercelSiteProject/vercelBackendProject`
(admin-only fields), append the steps to `provisioningLog`. Replace the
`[NÁVRH]` legal texts with the client's real ones first.

---

## Friction: what the skill must automate, and every hand-edit

### Manual steps the skill must automate

| # | What | Where it hurt |
|---|---|---|
| F1 | **The JSON has no slug.** The client id (`novak-test`) lives only on the CRM `sites` record (`create-site` response / `slugifyCzech(brand.name)` default = `jan-novak-reality`). The skill needs `slug` in its input or must read the site record | crm (WP2 contract / WP1) |
| F2 | `next.config.ts` must not import `site.config.ts` in a standalone copy → generate both files from the same values (siteUrl, cmsUrl) | template (apps/site) |
| F3 | Flattened sources need `.js` stripped from relative imports for Turbopack (or the client builds with `--webpack` + `extensionAlias`, as crm does) | platform packages |
| F4 | `tsconfig.json`: inline the shared base and add the 10 `@makleri/*` path mappings; Next then rewrites `jsx` to `react-jsx` and extends `include` on first build, so generate those values directly | template |
| F5 | `globals.css` `@import`/`@source` paths rewritten for the flattened layout | template |
| F6 | No tenant-creation or starter-content script in the backend template; written by hand as `seedClientSite.ts` (tone-keyed Czech copy, legal drafts, listings) | cms template |
| F7 | `seed:site-key` probes `http://localhost:3000` by default, i.e. Josef's main CMS. Must always get `CMS_PROBE_URL`; the default should go | cms |
| F8 | `seed:client` hardcodes the realtor's name `Jan Novák` (true here by coincidence). Should take `CLIENT_NAME` | cms |
| F9 | Secrets generation and plumbing: PAYLOAD_SECRET, admin/realtor passwords, revalidate secret, site API key, all into the right gitignored files of two repos without printing them | skill |
| F10 | `provisioningLog` can only be written by read-modify-write of the whole array (`PATCH /api/sites/:id`); concurrent steps would lose entries. An append endpoint is wanted | crm |
| F11 | The site build needs the backend running and seeded (prerendering). Order: backend → key → site, locally and on Vercel | skill |
| F12 | `PORT` in `.env` is not honoured by `next dev`; pass it on the command line (crm's `.env.example` suggests otherwise) | cms/crm docs |
| F13 | Seed scripts `process.exit(0)` right after writing, which kills the fire-and-forget revalidate pings; a re-seed against a running site does not refresh it | cms |
| F14 | The backend copy's `README.md` is still Payload's blank-template README; a client repo needs its own | cms |
| F15 | Env names differ for the same fact: crm `SITE_FALLBACK_DOMAIN_BASE`, cms `PLATFORM_SUBDOMAIN_BASE` | crm/cms |
| F16 | Production seeding runs locally against the production DB with `NODE_ENV=production` and R2 vars (config throws without R2); needs one R2 bucket/prefix decision per client | skill / Josef |

### Every hand-edit made

backend-novak-test (diff over commit d4fca7e, the pristine copy):

- `package.json`: `seed:client-site` script added.
- `src/scripts/seedClientSite.ts`: new (F6).
- `src/hooks/revalidateTenantSite.ts`: read `tenant.hosting.siteUrl` (bug B1).
- `.github/dependabot.yml`: new.
- `.env`, `.admin-credentials.local`: local, gitignored.

site-novak-test (diff over commit 3b883d9, the pristine copy):

- `package.json`, `tsconfig.json`, `next.config.ts`, `app/globals.css`,
  `.env.example`: as in step 11.
- `site.config.ts`: generated (not hand-written).
- 8 files under `src/makleri/` (core, theme-realvista): `.js` stripped from
  relative imports (mechanical sed).
- `src/makleri/config/tsconfig.base.json`: removed (inlined).
- `.github/dependabot.yml`, `.gitignore`: new. `.env.local`: local, gitignored.

Left as is, worth a later look: `app/VariantSwitcher.tsx` ships in the client
repo (env-gated, never rendered without `NEXT_PUBLIC_VARIANT_PREVIEW=1`);
`createNextConfig` still lists `@makleri/core`/`theme-kit` in
`transpilePackages` although they are not installed (no warning, harmless);
`AGENTS.md`/`CLAUDE.md` from the template.

## Bugs found

| # | Bug | Owner | Workaround here |
|---|---|---|---|
| B1 | `cms/src/hooks/revalidateTenantSite.ts` reads `tenant.siteUrl`, but `Tenants.ts` defines `siteUrl` inside the `hosting` group. The hook always returns early: **no realtor save ever revalidates the site** (no warning logged). Reproduced: PATCH as realtor → site unchanged; after the fix → visible in 2 s | cms (WP4) | patched in `backend-novak-test` to read `hosting.siteUrl` |
| B2 | `apps/site/next.config.ts` imports `site.config.ts` → theme. Fine in the monorepo (theme resolves to `dist/`), fails in any copy that carries theme sources: `Cannot find module './src/makleri/theme-realvista/src'` | platform apps/site (WP8) | next.config with literal values |
| B3 | Package sources use `./x.js` relative specifiers that Turbopack cannot resolve to `.ts` (`export *` silently empty → "Export createCmsClient doesn't exist") | platform packages (WP2/WP6 owners) | sed strip in the copy |
| B4 | `seed:site-key` default probe URL is Josef's main CMS (F7) | cms (WP4) | always pass `CMS_PROBE_URL` |

Not bugs, but contract gaps to settle: F1 (slug in the JSON), F10 (log
append), the static-vs-ISR decision above, and ARCHITECTURE's `/obsah` +
`/crm` admin layout (the backend still serves Payload at `/admin` and has no
client CRM).
