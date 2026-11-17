// Switches of the app. Environment variables win over package.json (section "brightline").

import cds from '@sap/cds'

/**
 * simulate (default): the S/4HANA sandbox is read-only, so the update of the MRP data is simulated.
 * live: PATCH A_ProductSupplyPlanning in a real S/4HANA system (needs a destination with write access).
 */
export const writeMode = () =>
  String(process.env.S4_WRITE_MODE || cds.env.brightline?.s4WriteMode || 'simulate').toLowerCase() === 'live' ? 'live' : 'simulate'

/** If true, the person who proposed a change cannot decide on it (four-eyes principle) */
export const fourEyes = () => String(process.env.FOUR_EYES ?? cds.env.brightline?.fourEyes ?? 'false') === 'true'
