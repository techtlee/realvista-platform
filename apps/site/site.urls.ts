/**
 * The two origins Next.js itself needs at build time, as plain literals.
 *
 * `next.config.ts` imports this file and nothing else from the site, because
 * Next loads `next.config.ts` with a plain require hook before the app's
 * module graph exists. `site.config.ts` imports the theme to validate the
 * colourway, and the theme's TSX sources cannot load there; in the monorepo
 * that only worked because the theme resolved to its compiled `dist/`, so a
 * standalone client copy broke (client #1, B2).
 *
 * Keep it free of imports. /create-website writes it next to `site.config.ts`
 * from the same provisioning input, and `site.config.ts` checks the two agree.
 */

/** Canonical origin of the site; `site.config.ts` derives the same from `domain`. */
export const siteUrl = 'https://localhost:3001'

/** The CMS this site reads; the environment wins, so one build can point anywhere. */
export const cmsUrl = process.env.NEXT_PUBLIC_CMS_URL ?? 'http://localhost:3000'
