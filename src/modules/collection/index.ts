/**
 * Public cross-module facade for the collection domain.
 * Other modules MUST import shared collection primitives through this file only
 * (enforced by `.dependency-cruiser.cjs` `modules-public-api-only`).
 */
export { enqueueHydration } from "./hydrate";
