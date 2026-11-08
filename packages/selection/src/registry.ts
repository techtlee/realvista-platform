import { manifest as realvista } from '@makleri/theme-realvista/manifest'

import { catalogEntry, type Catalog } from './catalog.js'
import { createProvisioningSchema } from './schema.js'

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

/**
 * The strict schema `/create-website` and the CRM's provisioning-JSON
 * endpoint check against: the selection plus `domain` and `plan`, valid for
 * the themes on sale today.
 */
export const provisioningSchema = createProvisioningSchema(catalog)
