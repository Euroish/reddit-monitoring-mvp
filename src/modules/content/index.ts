/**
 * Public cross-module facade for the content domain.
 * Other modules MUST import shared content primitives through this file only
 * (enforced by `.dependency-cruiser.cjs` `modules-public-api-only`).
 */
export { canonical } from "./batch";
export { compileContentFilter, matchedAnchors, matchingNodes } from "./search";
export { commitContentBatch, prepareContentBatch } from "./sql";
