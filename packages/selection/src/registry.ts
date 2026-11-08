import { manifest as realvista } from '@makleri/theme-realvista/manifest'

import { catalogEntry, type Catalog } from './catalog.js'

/**
 * Every theme currently on sale.
 *
 * Adding a theme is one import and one line here. The storefront, the intake
 * endpoint and the CRM all pick it up from this list; none of them name a
 * theme or a colourway themselves.
 *
 * A separate entry point from the schema so that code validating stored
 * selections does not pull theme packages in.
 */
export const catalog: Catalog = [catalogEntry(realvista)]
