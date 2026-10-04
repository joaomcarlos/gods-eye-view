import { createPropertiesLayer } from '../../data/properties.js';

/**
 * Construct one Properties layer using the application scene owners.
 *
 * It takes no data source: listings are fetched from `/api/properties`
 * (Minha Morada API) when the layer is enabled.
 * @returns {object} A fresh layer instance for this catalog.
 */
export function createApplicationProperties() {
  return createPropertiesLayer();
}
