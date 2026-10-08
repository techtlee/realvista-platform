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
