import { runThemeConformance } from '@makleri/theme-kit/conformance'

import theme from '../src/index.js'

/**
 * The whole test file.
 *
 * Everything it asserts is in `@makleri/theme-kit`, which means layout #2 gets
 * the same gate for the same one line — and a check added for layout #2's
 * mistake protects REALVISTA from that day on.
 */
runThemeConformance(theme, { packageRoot: new URL('..', import.meta.url) })
