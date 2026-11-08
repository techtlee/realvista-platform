/**
 * The request schema `cw` validates against: `provisioningRequestSchema` v1
 * from `@makleri/selection` (P3), checked against the themes on sale
 * (unknown theme/colourway, section ids, duplicates, missing domain/plan,
 * reserved slugs). Re-exported here so the engine has one import point.
 */
export {
  buildProvisioningRequest,
  createProvisioningRequestSchema,
  RESERVED_SLUGS,
  SITE_SLUG,
  type ProvisioningRequestInput,
} from '@makleri/selection'
export { catalog, provisioningRequestSchema } from '@makleri/selection/registry'
