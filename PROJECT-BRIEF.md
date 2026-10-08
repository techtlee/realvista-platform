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
makleri/platform          monorepo, pnpm workspaces
  packages/config           @makleri/config          tsconfig, oxlint, createNextConfig()
  packages/core             @makleri/core            CMS access, Czech formatting, routing, overrides
  packages/theme-kit        @makleri/theme-kit       the theme contract: types, fixtures, conformance
  packages/ui               @makleri/ui              shadcn-derived client primitives — NOT BUILT
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

13. **A theme's manifest ships to the browser, so it holds data only.** No
    `new URL(…, import.meta.url)`, no file paths, nothing resolved at import time.
    Pointing it at the stylesheet made the bundler treat the CSS as a client asset
    and fail the build on every page that imported the theme.

14. **Relative imports in published packages need `.js` extensions.** `tsc` does
    not add them, and Node will not resolve without them. Extensionless specifiers
    appear to work for as long as the only consumer is a bundler in the same
    workspace, and fail the moment a real client repo installs the package.

15. **`next/font` only accepts explicitly written literals.** Weights, subsets
    and the CSS variable cannot be read from a theme's manifest, so the font block
    in a client repo is generated from it and verified against it with
    `assertFontMatches`. Drift otherwise renders as a synthesised bold or Czech
    characters in a fallback face.

16. **`incremental: true` plus a deleted `dist/` produces a silently partial
    build.** `tsc` trusts the `.tsbuildinfo` and emits nothing. Delete both or
    neither — and remember that a theme resolves `@makleri/theme-kit` through its
    `exports` map, so a test run against a stale `dist` passes for the wrong
    reason. `pnpm test` builds first for exactly this.

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

Last updated 2026-10-08.

| Thing | Status |
|---|---|
| CMS | **Done.** Payload 3.90.2 + Postgres, Czech admin, 9 collections |
| Tenancy | **Done.** Data-driven isolation suite, registry test blocks uncovered collections |
| Media pipeline | **Done.** Tenant-prefixed keys, EXIF stripped, 4 webp derivatives |
| Revalidation | **Done.** CMS calls the site on save/delete; edits appear in ~1s |
| Theme contract | **Done.** `@makleri/theme-kit` — types, fixtures, conformance |
| Theme REALVISTA | **Done.** Implements `ThemeModule`; five pages, four colourways, passes conformance |
| Demo site | **Done.** `apps/site`, 6 listings, 3 posts, blog, services, variant switcher |
| Tests | **217 passing** — 57 CMS int, 13 CMS e2e, 52 core, 19 kit, 76 conformance. All verified 2026-10-08. The previous "97" counted the scaffold spec twice; it is one of the 57 |
| R2 credentials | Not supplied. Adapter wired and disabled; uploads on local disk |
| Migrations | **None.** Dev uses schema push. Blocks production |
| Deploy | Not deployed. No GitHub org, nothing pushed |
| `/api/poptavka` | **Still missing.** The contact form discards enquiries. Fix before any client goes live |

### Next: mass production

Plan at `~/.claude/plans/pasted-content-id-5758-let-me-memoized-thunder.md`.

**Phase 1 (the contract) is done** — all six steps, 2026-10-08. Phase 2 is
layout #2, built *through* the contract, with the contract treated as editable:
every place it chafes is a finding, and the fix goes in the contract rather than
around it. See "Theme contract — built" below before starting.

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

# Theme contract — built

Phase 1 of the mass-production plan, completed 2026-10-08. Read this before
building layout #2; it is what the contract is, what implementing it taught, and
what is still open.

## What exists

`@makleri/theme-kit` — three exports.

- **`.`** — `ThemeModule` = `{ manifest, pages }`. Five pages, all required:
  `Home`, `ListingIndex`, `PropertyDetail`, `BlogIndex`, `PostDetail`. Page props
  are assembled only from `@makleri/core/content` types, which is the mechanism
  that keeps the CMS fixed across layouts: a theme wanting a field the CMS lacks
  fails to compile, and the fix is to add it once for every theme.
- **`./fixtures`** — three tenants, parameterised by colourway. `full` (six
  listings covering a plot with no disposition, a PENB exemption, a hidden
  address, a photo-less listing, a sold one), `minimal` (settings `null`, one
  listing with only required fields — the day-one null guard) and `empty`
  (settings but nothing entered).
- **`./conformance`** — `runThemeConformance(theme, { packageRoot })`. A theme's
  whole test file is that one call. REALVISTA: **76 tests**.

The manifest carries name, label, version, `tokenPrefix`, font, colourways, all
eight service icons, the stylesheet subpath, and `routes` — any route the theme
links to beyond the five the contract guarantees.

## The three blockers, resolved

1. **Core no longer knows REALVISTA's palette.** `themeVariantSchema` is
   `z.string()`; `defineSiteConfig(config, theme)` validates the colourway
   against `theme.manifest.variants` and names the real ones in the error. The
   theme argument is typed structurally (`ThemeVariantSource`, declared in core),
   so core still imports no theme and no theme kit.
2. **Tokens are namespaced and it is checked.** Conformance fails any custom
   property declared outside `--<prefix>-`. REALVISTA already complied; the check
   is for layout #2.
3. **Czech domain logic is in `@makleri/core/format`** and the theme imports it.
   Worth knowing why this mattered: the theme's own copy of
   `pricePerSquareMetre` had already drifted — it divided a monthly rent by floor
   area and printed the result as a purchase price per m².

## The client repo

Seven files named the theme; now one does.

```ts
// app/theme.ts
export { default } from '@makleri/theme-realvista'
```

Two files still spell it, and both have a reason that is not fixable in the
contract: `globals.css` needs a literal `@source` path because Tailwind v4 will
not scan `node_modules`, and `layout.tsx` needs a literal `next/font` call
because Next reads it statically at build time. Both are generated per site. The
font block is checked against the manifest at module load by
`assertFontMatches`, because drift otherwise shows up as a synthesised bold or
Czech characters in a fallback face — neither of which looks like a bug.

## What the contract got wrong, and how

Written against one theme, it was wrong in four places. Each was found by
implementing it, which is the argument for building layout #2 immediately.

| What | Why it broke |
|---|---|
| `stylesheetPath` on the manifest | The manifest ships to the browser. `new URL('…theme.css', import.meta.url)` made the bundler treat the CSS as a client asset and fail the build. Conformance takes the package root from the test file instead |
| Font options read from the manifest | `next/font` rejects anything that is not an explicit literal. Hence `assertFontMatches` rather than a shared value |
| Link check counted every `href` | React 19 emits `<link rel="preload" href="…">` for images during render, so every photo read as a broken route. It matches anchors only |
| Extensionless relative imports | Every package had them. They worked solely because the one consumer was a bundler inside the same workspace — Node could not load the packages at all, which a real client repo would have hit on day one |

Three traps in the toolchain, all of which cost time here:

- **`incremental: true` plus a deleted `dist/` produces a silently partial
  build.** `tsc` trusts the `.tsbuildinfo` and emits nothing. Delete both or
  neither.
- **A theme resolves the kit through its `exports` map, i.e. `dist`.** A test run
  against a stale build passes for the wrong reason. The root `test` script now
  builds first.
- **Vitest needs `esbuild: { jsx: 'automatic' }`.** The shared tsconfig sets
  `jsx: preserve` for Next, which leaves esbuild on the classic runtime and
  every component throws "React is not defined".

## Still open

- **`/api/poptavka` does not exist.** The contact form posts to it and
  `cms.submitEnquiry()` has no caller, so enquiries are silently discarded. The
  form now takes its action as a prop and carries the listing id, so the route is
  all that is missing. **This should jump the queue if any real client site is
  going live.**
- **`/zasady-ochrany-osobnich-udaju` and `/cookies` still 404.** They are linked
  from the footer on every page. They are declared in
  `manifest.routes`, which turns a silent 404 into something conformance reads
  back — but declaring is not fixing. The content already exists in the CMS
  (`settings.legal.privacyPolicy`, `cookieNotice`), so this is a small page plus
  two route files. Delete those two lines from the manifest when it lands and the
  check starts enforcing them for free.
- **Two themes in one document still collide on Tailwind's tokens.** The
  `--rv-` namespace is enforced, but both themes map into `--color-brand` inside
  `@theme inline`, and that is how Tailwind utilities work. A gallery showing two
  layouts on one page needs iframes, or a per-theme utility prefix. Decide before
  `apps/gallery` is built — it is a design question, not a bug.
- **`apps/gallery` still does not exist.** The script that referenced it is gone
  rather than left to fail.
- **Section order is honoured on `Home` only.** `pages.property.sections` is
  still validated and ignored.

## What layout #2 should expect

The CMS needs exactly one change: a `theme.name` option in
`cms/src/collections/Tenants.ts`, then `pnpm generate:types`. If layout #2 needs
anything else from the CMS, that is the contract leaking and the thing to fix.

Its test file is:

```ts
runThemeConformance(theme, { packageRoot: new URL('..', import.meta.url) })
```

Two couplings it should not inherit. `hero.subheadline` doubles as the footer
strapline, and `about.heading` is rendered as the agent band's headline — both
REALVISTA decisions a second layout is free to ignore.
