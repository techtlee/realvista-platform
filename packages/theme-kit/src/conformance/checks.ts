/**
 * The pure half of conformance.
 *
 * Separated from the suite so it can be tested directly: a check that never
 * fires is indistinguishable from one that cannot, and the whole value of the
 * gate rests on it actually catching the cases it claims to.
 */

/** Routes the client repo always provides, derived from the page surface. */
export const CONTRACT_ROUTES = [
  '/',
  '/nemovitosti',
  '/nemovitosti/:slug',
  '/blog',
  '/blog/:slug',
] as const

const toPattern = (route: string) =>
  new RegExp(`^${route.replace(/\//g, '\\/').replace(/:[a-z]+/gi, '[^/]+')}$`, 'i')

/**
 * Internal link targets in rendered markup.
 *
 * Anchors only. React 19 emits `<link rel="preload" href="…">` for images it
 * sees during render, and those hrefs are media URLs that no router ever
 * resolves — counting them reported every photo in the fixtures as a broken
 * route.
 *
 * Same-origin paths only: `mailto:`, `tel:`, absolute URLs and bare fragments
 * are somebody else's problem, and a fragment resolves on the page it is on.
 */
export function internalLinks(html: string): string[] {
  const found = new Set<string>()
  for (const m of html.matchAll(/<a\b[^>]*?\shref="([^"]*)"/g)) {
    const raw = m[1] ?? ''
    if (!raw.startsWith('/')) continue
    const path = raw.split('?')[0]?.split('#')[0] ?? ''
    if (path) found.add(path)
  }
  return [...found]
}

/** Links that resolve to no route any client repo provides — i.e. 404s. */
export function danglingLinks(html: string, extraRoutes: readonly string[] = []): string[] {
  const allowed = [...CONTRACT_ROUTES, ...extraRoutes].map(toPattern)
  return internalLinks(html).filter((link) => !allowed.some((re) => re.test(link)))
}

/**
 * Custom properties a stylesheet declares outside its own namespace.
 *
 * `@theme` blocks are exempt: the `--color-*` and `--radius-*` names in there
 * are Tailwind's mapping layer, not the theme's own tokens.
 */
export function strayTokens(css: string, tokenPrefix: string): string[] {
  const prefix = `--${tokenPrefix}-`
  const outside = css.replace(/@theme[^{]*\{[\s\S]*?\n\}/g, '')
  const declared = [...outside.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1] as string)
  return [...new Set(declared)].filter((t) => !t.startsWith(prefix))
}

/** Colourways named in `[data-variant='…']` blocks. */
export function cssVariants(css: string): string[] {
  return [
    ...new Set(
      [...css.matchAll(/\[data-variant=['"]([a-z0-9-]+)['"]\]/gi)].map((m) => m[1] as string),
    ),
  ]
}

/** True when the stylesheet uses `@theme inline`, without which variants do nothing. */
export const usesThemeInline = (css: string): boolean => /@theme\s+inline\s*\{/.test(css)

/**
 * How many times an element opens in rendered markup.
 *
 * `<header` followed by whitespace, `>` or `/` — so `<headline>` or a custom
 * `<header-bar>` does not count.
 */
export function tagCount(html: string, tag: string): number {
  return [...html.matchAll(new RegExp(`<${tag}(?=[\\s>/])`, 'gi'))].length
}

/**
 * True when the page's first `<header>` opens before any `<section>` or `<main>`.
 *
 * A header rendered inside the hero section — REALVISTA's, until the realtor
 * moved the hero down the page and the nav went with it — fails this.
 */
export function headerComesFirst(html: string): boolean {
  const header = html.search(/<header(?=[\s>/])/i)
  if (header < 0) return false
  const content = html.search(/<(section|main)(?=[\s>/])/i)
  return content < 0 || header < content
}

/** True when the markup links to the blog index or any post. */
export const linksToBlog = (html: string): boolean =>
  internalLinks(html).some((l) => l === '/blog' || l.startsWith('/blog/'))
