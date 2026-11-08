import { defineTheme } from '@makleri/theme-kit'

import { manifest } from './manifest.js'
import {
  RealvistaBlogIndex,
  RealvistaHome,
  RealvistaListingIndex,
  RealvistaPostDetail,
  RealvistaPropertyDetail,
} from './pages/index.js'

/**
 * REALVISTA as a theme module.
 *
 * The default export is what a client repo's `app/theme.ts` re-exports, so the
 * theme name is spelled in exactly one place per site instead of seven.
 */
export default defineTheme({
  manifest,
  pages: {
    Home: RealvistaHome,
    ListingIndex: RealvistaListingIndex,
    PropertyDetail: RealvistaPropertyDetail,
    BlogIndex: RealvistaBlogIndex,
    PostDetail: RealvistaPostDetail,
  },
})

export { manifest } from './manifest.js'
export { ArrowRightIcon, icons, MailIcon, PhoneIcon, ServiceGlyph } from './icons.js'
export * from './pages/index.js'
export * from './components/index.js'
