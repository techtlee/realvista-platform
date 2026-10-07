# Makléři — Project Brief

> If you're a fresh Claude reading this: read everything below before touching any code.
> The full approved plan lives at `~/.claude/plans/pasted-content-id-5758-let-me-memoized-thunder.md`.
> This file is the fast onboarding; the plan is the detail.

## What this is

A platform that sells ready-made websites to Czech real estate agents (makléři).

A realtor visits a storefront, browses a gallery of themes, picks one, submits a form.
We generate and ship a production site on their own domain within hours. They then
maintain their own content — listings, photos, text — through a CMS in Czech.

**Business model:** lead in → manual qualification → invoice → provision → live site.
No self-serve checkout. Target 20–80 live sites within 12 months.

## The governing principle

> **The client repo holds configuration, not implementation.** ~12 files, zero components
> for a stock site.

Repo-per-client is only survivable if the client repo contains no code. Hold this line and
"patch 60 repos" becomes "publish one package version, let a bot bump 60 lockfiles."
Every architectural decision is judged against it.

## Locked decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Site architecture | Repo per client, own Vercel project |
| D2 | Property listings | Manual CMS entry only (no XML feed import) |
| D3 | Billing | Lead only, invoice manually |
| D4 | Domains | Custom domain day one + auto platform subdomain as safety net |
| D5 | Scale target | 20–80 sites in 12 months |
| D6 | MVP scope | One theme (REALVISTA), 4 variants, end to end |
| D7 | Languages | Czech only, but locale-keyed schema from day one |
| D8 | CMS | Payload CMS 3, self-hosted, one shared multi-tenant instance |

**Why Payload and not Directus:** Directus relicensed to MSCL and caps unlicensed
self-hosted instances at 3 user seats — dead on arrival for 80 realtor logins. Payload is
MIT, unlimited users, and ships a complete Czech admin translation (`cs.ts`, 731 lines vs
`en.ts`'s 734). Sanity was out on cost ($15/seat, caps at 50).

## Architecture at a glance

```
makleri/platform          monorepo, pnpm workspaces, changesets
  packages/config           @makleri/config          tsconfig, oxlint, createNextConfig()
  packages/core             @makleri/core            CMS access, routing, SEO, overrides
  packages/ui               @makleri/ui              shadcn-derived client primitives
  packages/theme-realvista  @makleri/theme-realvista the product
  apps/gallery              showcase · visual-regression target · storefront picker
  apps/dashboard            fleet dashboard

makleri/cms               Payload 3 + Postgres, ONE shared instance, row-level tenancy
makleri/storefront        marketing site + intake form
makleri/site-template     GitHub template repo, the canonical thin file set
makleri/renovate-config   three ring presets (canary / stable / frozen)
makleri/workflows         reusable CI + upgrade workflows
makleri/site-<client>     one per client, ~12 files
```

## Landmines — read before writing code

1. **Field-level access on `users.platformRole` and `users.tenants` is non-negotiable.**
   `users.update` must allow `user.id === id` so realtors can change their own password.
   Without field-level lockdown, any realtor can PATCH their own user document and set
   `platformRole: 'platform-admin'`. This is the single most likely way this gets breached.

2. **The multi-tenant plugin does NOT replace `access` functions.** It filters the admin UI
   and auto-assigns tenant on create. Rely on it alone and the REST/GraphQL API will serve
   tenant B's listings to tenant A. Every tenant-scoped collection needs an explicit
   `access` block.

3. **Tailwind v4 skips `node_modules` during content detection.** Without
   `@source "../node_modules/@makleri/theme-realvista/dist"` in the client's `globals.css`,
   every theme class is purged and the site renders unstyled. Most likely first-day failure.

4. **`@theme inline` is required, not stylistic.** It makes `.bg-brand-600` compile to
   `background-color: var(--rv-brand-600)` so the `[data-variant]` block actually reaches
   the utility. Without `inline`, variants silently do nothing.

5. **`clientUploads: true` on the R2 adapter is mandatory.** Without it uploads flow through
   the Node server and die at Vercel's 4.5 MB body limit. A modern iPhone photo is 3–6 MB.

6. **`withMetadata: false` on uploads.** Phone photos carry GPS EXIF. A photo taken inside a
   client's home leaks that address even when `hideExactAddress` is set.

7. **Media file URLs are not tenant-scoped even when the rows are.** Prefix every R2 object
   key with the tenant id or filenames are guessable across tenants.

8. **`react` / `react-dom` / `next` are peerDependencies in every package**, never
   dependencies. Getting this wrong produces duplicate-React hook errors on all sites at once.

9. **Never ship a theme v2 as a major.** You cannot auto-roll a visual redesign onto 80 sites;
   visual change needs client consent. Ship `@makleri/theme-realvista2` as a new package.
   Themes are append-only; only `core`/`ui` get majors.

10. **PENB energy class is legally mandatory** in Czech property advertising
    (zák. č. 406/2000 Sb.). Enforced at publish, with `EXEMPT` / `PENDING` escapes
    so nobody invents a letter to get past a required field.

11. **Never give a collection its own `status` field while `versions.drafts` is on.**
    Payload's drafts add `_status`, whose Postgres enum is named
    `enum_<collection>_status` — colliding exactly with a domain `status` field and
    silently replacing its values. This already happened once on `properties`.

12. **The storage plugin is always registered, merely `enabled: false` without R2.**
    Omitting it also omits the `prefix` field it injects, so media documents would
    have a different shape in development than in production.

## Build order

Phase A — CMS foundation (Payload + Postgres + tenancy + **isolation test suite**)
Phase B — platform packages (monorepo, core, ui, theme, screenshot baselines)
Phase C — first site, provisioned BY HAND, writing down every step
Phase D — automation, **before client #3**
Phase E — storefront, intake form, fleet dashboard

> Two ordering rules that decide whether this business works:
> - **Steps 11–12 (automation) must be done before client #3.** Onboard ten clients first and
>   you will hand-patch ten repos forever.
> - **Automate provisioning only after doing it manually once.** Automating before you've felt
>   the manual process produces the wrong automation.

## Current state

Last updated 2026-10-06.

| Thing | Status |
|---|---|
| CMS | **Done.** Payload 3.90.2 + Postgres, Czech admin, 9 collections |
| Tenancy | **Done.** Data-driven isolation suite, registry test blocks uncovered collections |
| Media pipeline | **Done.** Tenant-prefixed keys, EXIF stripped, 4 webp derivatives |
| Revalidation | **Done.** CMS calls the site on save/delete; edits appear in ~1s |
| Theme REALVISTA | **Done.** Built from the Figma exports; indigo/crimson/clay exact, mono derived |
| Demo site | **Done.** `apps/site`, 6 listings, 3 posts, variant switcher |
| Tests | **97 passing** — 57 CMS int, 26 core, 13 e2e, 1 scaffold |
| R2 credentials | Not supplied. Adapter wired and disabled; uploads on local disk |
| Migrations | **None.** Dev uses schema push. Blocks production |
| Deploy | Not deployed. No GitHub org, nothing pushed |

### Next: mass production

Plan at `~/.claude/plans/pasted-content-id-5758-let-me-memoized-thunder.md`.
Layout #2 is being built imminently, so the theme contract lands first and
layout #2 is built through it.

### Running it

```bash
cd cms
pnpm dev                 # http://localhost:3000/admin
pnpm test:int            # the isolation gate — must stay green
pnpm test:e2e            # HTTP-layer isolation (needs Playwright chromium)
pnpm generate:types      # after any collection change
pnpm generate:importmap  # after adding a plugin with admin components
pnpm seed:admin          # bootstrap a platform admin
```

Local admin credentials are in `cms/.admin-credentials.local` (gitignored).

### Collections

| Collection | Scope | Notes |
|---|---|---|
| `tenants` | platform | one row per client site; realtors read only their own |
| `users` | platform | realtors + staff; see the escalation landmine |
| `leads` | platform | storefront "I want a website" pipeline. **No tenant by design** |
| `site-settings` | tenant | per-tenant singleton; a collection, not a Payload global |
| `properties` | tenant | the realtor's daily tool; PENB enforced at publish |
| `posts` | tenant | blog, optional per site |
| `services` | tenant | services section |
| `enquiries` | tenant | contact-form submissions; content read-only, handling editable |
| `media` | tenant | uploads; tenant-prefixed keys once R2 is wired |

### Decisions made during implementation

- **No "first user becomes admin" hook.** An early revision auto-promoted whoever
  was created into an empty users table. The isolation suite caught it: the seeded
  realtor came out as a platform admin and 13 access assertions passed vacuously.
  It is also a production back door. Bootstrap with `pnpm seed:admin` instead.
- **`supportedLanguages: { cs }` only, no `en`.** Payload picks the admin language
  from Accept-Language and only uses `fallbackLanguage` when nothing matches. With
  `en` listed, a realtor on an English-language Windows install gets an English panel.
- **Properties uses `versions: true`, not `{ drafts: true }`.** Payload's drafts add
  a `_status` field whose Postgres enum is named `enum_properties_status` — colliding
  exactly with the enum for the domain `status` field and silently replacing the
  listing statuses with `draft, published`. Beyond the collision, two status concepts
  is the wrong model: "Rozpracovaný" already means "not on the site".
  **Rule: never give a collection its own `status` field while drafts are enabled.**
- **Integration tests run in `environment: 'node'`, not jsdom.** Payload validates the
  uploaded file's type signature; under jsdom the Buffer crosses realms so
  `fileTypeFromBuffer` throws and every upload is rejected as invalid.
- **`fileParallelism: false`.** Each spec boots its own Payload and runs
  `pushDevSchema`; in parallel they race to CREATE TYPE the same enums.
- **Anonymous reads throw `Forbidden`** rather than returning an empty page — no row
  count or pagination metadata to probe.
- **Tenant-less rows cannot be created at all.** The column is nullable and the
  plugin's types omit `required`, which looks like it should allow an orphan visible
  to everyone; the plugin validates in a beforeChange hook instead. Asserted in the
  suite, because the schema alone suggests otherwise.
- **The isolation suite is data-driven** over `TENANT_COLLECTIONS`, plus a registry
  test that fails the build if any collection carrying a `tenant` field is neither
  covered nor explicitly classified as platform-level. Adding a collection without
  test coverage is therefore a build failure, not a silent leak.
- **`prefix` is a static string per collection, not a function.** The plan assumed
  `prefix: ({ data }) => ...`; the adapter does not support that. Per-document
  namespacing comes from a `prefix` FIELD the plugin injects, set by a
  `beforeValidate` hook on Media from the tenant id (`tenants/<id>`).
- **`storagePlugins()` throws when NODE_ENV=production and R2 is unset.** A
  serverless filesystem accepts the write and loses the file on the next deploy,
  with no error to notice. Refusing to boot is the lesser failure.
- **Access functions return through an explicitly typed `Where`.** Two object
  literals in separate returns infer a union with optional-undefined keys, which
  does not satisfy Payload's `Where` index signature.

## Design source

Figma file `eJ3aGmpHUMRCGpS7PpviZY` — theme REALVISTA, homepage + property detail,
four color variants (indigo, sand/brown, crimson, mono).

**Extraction constraint:** `get_metadata` on the page fails — the subtree JSON truncates
mid-stream every time (canvas is 6851 × 10727 with all four variants on one page).
Screenshots work; design context works *per frame*. So: click the individual frame in Figma,
copy its node-specific link, extract that frame alone. Whole-page extraction is unavailable.
This applies to every future theme Figma.

## Open questions

- **Naming and domain.** "Techtle" vs "Techtlee" is unresolved in the existing Techtle README.
  This venture needs its own name and domain before repos and env vars get created.
- **Pricing.** Deferred by D3, but needed before storefront copy.
- **Theme 2.** Its scope affects how much gets generalized out of REALVISTA into `@makleri/core`.


---

# Theme contract — findings before layout #2

Mapped 2026-10-06, before any second layout existed. If you are about to build
one, read this first.

## The CMS is already layout-agnostic

`realvista` appears in **14 lines across 4 files**. No collection, field, hook or
access function branches on theme name. Registering a layout is one entry in the
`options` array of `theme.name` in `cms/src/collections/Tenants.ts`, then
`pnpm generate:types`.

## Three things block a second layout

1. **`themeVariantSchema` in `@makleri/core/config` hard-codes REALVISTA's four
   palette names** (`indigo | crimson | clay | mono`) into the package every site
   depends on. A layout with a different palette cannot be configured without
   editing core. Variants belong in each theme's manifest.

2. **`--rv-` CSS tokens are unnamespaced.** Two themes loaded together — which a
   gallery does by definition — collide silently. Each theme needs a token prefix,
   and a check that it only defines tokens under it.

3. **Czech domain logic lives inside the theme**: `formatPrice`,
   `dispositionLabel`, `energyLabel`, `locationLabel`, `cardTitle`, the 14 kraje,
   and a Lexical renderer. Theme #2 either copies ~90 lines or imports from theme
   #1. Lifted to `@makleri/core/format`.

## The contract today is unenforceable

A theme exports three components whose names are hard-coded at the client-repo
import site, with three bespoke prop interfaces. There is no shared type, so
nothing guarantees two themes have compatible signatures. TypeScript can tell you
an import failed; it cannot tell you a theme is *missing* a page.

**7 of 13 files in `apps/site` change per theme.** The theme name is spelled in
seven places with no single source of truth.

The theme never receives `SiteConfig`. `pages.home.sections` is validated and
then ignored — section order is hard-coded in JSX.

## Dead code and phantom exports

| Thing | Status |
|---|---|
| `theme-realvista/exports["./slots"]` | Declared, never built — importing it throws |
| `core/exports["./seo"]` | Declared, never built. No metadata or JSON-LD anywhere |
| `@makleri/ui` | In `MAKLERI_PACKAGES` for transpilation; package does not exist |
| `apps/gallery` | Root script `dev:gallery` references it; app does not exist |
| `.changeset/` | Three scripts and a devDependency; no config directory |
| `defineOverrides` / `resolveSlots` | Zero call sites |
| `services` prop on `RealvistaHome` | Required, passed, never rendered |

`./slots` matters most: it is exactly what a new theme would reach for, and it
throws.

## Client-facing bugs, not tidiness

- `/blog`, `/blog/[slug]`, `/zasady-ochrany-osobnich-udaju`, `/cookies` are
  **linked from the header and footer and do not exist** → 404 on a live site.
- `/api/poptavka` is the contact form's `action` and does not exist.
  `cms.submitEnquiry()` in core has no caller. **The contact form silently
  discards enquiries.** Fix before any real client goes live.

## What is already right

`@makleri/core` has zero dependency on any theme — the direction is correct. The
content types are hand-written and deliberately frozen against Payload drift,
exactly as a cross-theme contract should be. The theme reads only ~45 of ~110
available fields, so a visually different layout has real headroom without
touching the CMS.

## Two couplings to watch

**`services.icon` is a fixed eight-value set** (`home`, `key`, `chart`,
`calculator`, `document`, `shield`, `handshake`, `camera`). Every theme must ship
all eight; a gap renders an empty box, and only for clients using that service.

**`hero.subheadline` does double duty** as the footer strapline, and
`about.heading` is concatenated into agent prose. Both are REALVISTA decisions
that a second theme should not be forced to copy.
