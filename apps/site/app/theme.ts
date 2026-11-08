/**
 * The only file in this repo that names the layout.
 *
 * Swapping a client onto a different layout is this line plus a dependency
 * bump. It used to be seven files: the three page routes, the layout's font,
 * the globals.css @source path, the variant list in the preview switcher, and
 * site.config.ts — with no single source of truth and no way to tell whether
 * you had got them all.
 */
export { default } from '@makleri/theme-realvista'

/**
 * The layout's chrome, for the site's own pages that the theme contract does
 * not cover (legal texts, the enquiry thank-you page). Re-exported here so the
 * layout is still named in this one file only.
 */
export { Container, Footer, Header, RichText } from '@makleri/theme-realvista'
