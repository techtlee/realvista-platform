# REALVISTA — target structure

> Decided by Josef on 2026-10-15. **Supersedes D8** in platform/PROJECT-BRIEF.md
> ("one shared multi-tenant CMS instance") and refines D1. Read this before
> creating any repo, deployment or domain.

## In one paragraph

Every client gets their own deployments: a website built from the
template and configuration they picked, and one admin app that holds both their
CMS (website content) and their CRM (buyers, enquiries, viewings). We run our
own internal CRM as a separate system with its own database, plus the landing
page/configurator and a demo site. Nothing a client touches shares a deployment
or a database with another client or with us.

## Deployments and domains

| Address | What | Repo | Who |
|---|---|---|---|
| realvista.cz | landing page + configurator | `realvista-web` | visitors |
| crm.realvista.cz | **our internal CRM**, own database | `realvista-crm` | Josef + staff |
| demo.realvista.cz | demo site with fixture data, to inspect themes/components | demo (from platform) | us |
| `<client>.cz` | the client's website, **ISR** (pre-rendered, refreshed on save), built from their configuration | `site-<client>` | the public |
| admin.`<client>.cz` | the client's **CMS + CRM in one app**, one login | `backend-<client>` | the realtor |

Per client: **2 deployments, 1 database, 2 DNS records on their side.**

## Repos

- **Templates** (one each, improved over time; never deployed for a client directly):
  - `realvista-site-template-<theme>` — one per theme/layout
  - `realvista-client-backend` — client CMS + client CRM (today's `cms/` is its starting point)
- **Per client**, copied from the templates at provisioning: `site-<client>`, `backend-<client>`
- **Ours**: `realvista-web`, `realvista-crm`, demo

**Client repos are standalone copies, not package consumers** (decided
2026-10-15). `/create-website` generates the full code from the template, so
each client's repo works on its own and nothing shared can break every site at
once. A fix to a template reaches existing clients only if we copy it to them
on purpose.

## Provisioning: from configuration to client repo

Decided 2026-10-15. Every client goes through the same steps:

1. **The client configures** on realvista.cz and submits. The selection JSON
   (v1: template, colourway, modules, home section order, brand, tone) is
   stored on the lead in **our CRM** (realvista-crm).
2. **We qualify** the lead in a call, and add what the page does not ask:
   `domain` and `plan`. The JSON stays the single source; nobody re-types it
   anywhere.
3. **The developer takes the JSON from the CRM** (a download/copy button on
   the lead) and runs the Claude skill **`/create-website <lead JSON>`**.
4. **The skill creates the client's setup from it:**
   - checks the JSON (`schemaVersion`, the template and colourway exist, the
     section ids are valid);
   - generates `site-<client>` from `realvista-site-template-<theme>`, with the
     config written from the JSON (colourway, modules, section order, brand,
     starter copy in the chosen tone);
   - generates `backend-<client>` from `realvista-client-backend`;
   - creates the GitHub repos, the Vercel projects, the database and env vars;
   - adds the fallback addresses (`<client>.realvista.cz`,
     `admin.<client>.realvista.cz`) and the realtor's admin login;
   - prints the DNS records to send to the client;
   - reports each step back to the lead in the CRM (provisioning log).
5. **The developer reviews and the site goes live.** The client adds DNS, we
   add their real domain, and the repos are made private.

Rules for the skill:
- **Write it after the first client has been done by hand.** Do client #1
  manually, write down every step, and the skill is that list automated.
  Automating before doing it once produces the wrong automation.
- **Resumable:** each step is recorded, so a failure continues from where it
  stopped instead of starting over or creating duplicates.
- **Never** touch the client's nameservers, and never print secrets.
- **Keep it in the template repo** (`.claude/skills/create-website/`), so the
  skill always matches the template version it generates from.

## Why per-client deployments

- The client picks their template and structure, so their site is its own
  thing, and changing one client's setup must not risk another's.
- No big release management is planned: sites are built once and only
  their content changes afterwards.
- A shared repo or instance has its own debugging and blast-radius problems.

**The accepted cost: security updates.** Both `site-<client>` (a small Next.js
server for ISR, the enquiry form and the media proxy) and `backend-<client>`
(a live server with logins) run Next.js, so when Next.js or Payload ships a
security fix, every instance must be updated. Handle it with
**Dependabot on every client repo**: GitHub opens the PR, we merge, and Vercel
redeploys.

## Domains, per client (example: novakreality.cz)

At the client's registrar, **records only, never nameservers**, so their
e-mail (MX) is untouched:

    novakreality.cz         A      76.76.21.21           → Vercel project site-novakreality
    www.novakreality.cz     CNAME  cname.vercel-dns.com  → same project, redirects to apex
    admin.novakreality.cz   CNAME  cname.vercel-dns.com  → Vercel project backend-novakreality

Vercel routes by hostname and issues SSL automatically. The realtor adds the
records themselves from our instructions (the intake form records their
registrar), or gives us access.

**Fallback addresses from day one**, before their DNS is ready or if they have
no domain:

    novakreality.realvista.cz         → site
    admin.novakreality.realvista.cz   → backend

realvista.cz's nameservers sit at Vercel, so these are one API call during
provisioning, with no manual DNS.

## The admin app (admin.<client>.cz)

One Next.js app: Payload plus extra pages, one database, one login.

    /         login, then a chooser: "Obsah webu" | "Klienti a poptávky"
    /obsah    Payload admin (routes.admin = '/obsah'): listings, blog, photos
    /crm      client CRM: enquiries, contacts, viewings, tasks (same database)

- The session cookie covers the whole admin domain, so switching between
  Obsah and CRM never asks for a login again. A header switch goes both ways.
- The admin cookie is scoped to `admin.<client>.cz`, never the public site.

## How the site and admin connect

- **The site reads content** from `admin.<client>.cz/api/…`. Pages are
  pre-rendered and cached (ISR, `revalidate = 3600` as a safety net).
- **Saving in the admin refreshes the site on demand:** a Payload hook calls
  the site's `/api/revalidate` with the tenant's `revalidateSecret`, and the
  changed pages re-render on the next request, in seconds. No deploy hook and
  no rebuild.
- **The enquiry form** posts to the site's `/api/poptavka`, which stores the
  enquiry in the admin with the site's API key.
- The site URL, the revalidate secret and the API key are set at provisioning.

> Decided 2026-11-08 (Josef): ISR + on-demand revalidation instead of a purely
> static site rebuilt by a deploy hook. A static site would need the enquiry
> form and the media proxy moved off the site first, and a rebuild per save is
> slower. This is what `apps/site` and client #1 already do.

## System e-mail

Password resets and "new enquiry" notifications come from **one sending
domain we own** (e.g. `noreply@realvista.cz`, with reply-to set to the
realtor). Sending from each client's domain would mean SPF/DKIM records per
client: more DNS work and more mail in spam.

## Internal CRM vs client CRM

They are separate products that may diverge freely.

- **Internal (`realvista-crm`):** our customers are realtors. It holds leads
  from the storefront, deals, invoices, provisioning and our notes. It has its
  own database, so our notes about a client cannot physically reach that
  client.
- **Client (inside `backend-<client>`):** the realtor's customers are buyers
  and sellers. It holds enquiries from their website, viewings and offers.
- **They may share UI components** (pipeline board, contact page, activity
  timeline, tasks), but never data and never a database.

## What this changes in existing work (as of 2026-10-15)

- `cms/` stops being a shared multi-tenant production instance. It becomes the
  starting point for `realvista-client-backend`. The tenancy code is harmless
  for a single-client instance and can be simplified later.
- The internal CRM built inside `cms/` (leads, deals, organizations… plus
  `platform/apps/dashboard`) moves to `realvista-crm` with its own database.
  It's best moved before it's committed and while nothing is live.
- `storefront/` (→ `realvista-web`) is unchanged. `LEAD_ENDPOINT` will point
  at realvista-crm's intake. The intake must accept `domain` and `plan` as
  optional.
- The client admin gets `/obsah` (Payload) and `/crm`, with the chooser at `/`.

## Still open

- **Product name:** REALVISTA / realvista.cz, per Josef. The first theme is
  also called REALVISTA; consider renaming the theme to avoid confusion.
- **Repo visibility:** public during development, by Josef's choice. **All
  repos go private at go-live** (decided 2026-10-15).
- Hosting cost per client (one Vercel project pair plus one Postgres
  database each).
