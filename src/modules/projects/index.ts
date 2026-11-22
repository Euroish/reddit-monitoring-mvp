/**
 * Public cross-module facade for the projects domain.
 * Other modules MUST import shared project primitives through this file only
 * (enforced by `.dependency-cruiser.cjs` `modules-public-api-only`).
 */
export { projectSources } from "./sql";
export { attachBatchToProjectInTx } from "./batches";
