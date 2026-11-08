/** The site exporter (A6): `apps/site` at one platform commit → a standalone client repo. */
export { computeClosure, computeClosureInTree, outPathFor, type Closure, type ExportEntry, type PkgInfo } from './closure.js'
export {
  assertStandalone,
  copyPristine,
  exportSite,
  makeStandalone,
  planDependencies,
  siteConfigInputFor,
  STEP_TRAILER,
  TEMPLATE_TRAILER,
  type ExportReport,
  type ExportSiteOptions,
} from './export.js'
export { bareVersion, parseLockImporters, pinDependencies } from './lockfile.js'
export {
  buildTsconfig,
  pathsFromExports,
  renderEnvExample,
  renderGlobalsCss,
  renderNextConfig,
  renderPackageJson,
  renderSiteConfig,
  renderSiteUrls,
  siteUrlFor,
  tsLiteral,
  type SiteConfigInput,
} from './render.js'
export { findSpecifiers, rewriteRelativeJsSpecifiers } from './specifiers.js'
