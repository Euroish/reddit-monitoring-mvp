/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Prevent circular dependencies across backend modules, connectors, and contracts.",
      from: { path: "^(src|apps/api/src|packages/contracts/src)" },
      to: { circular: true },
    },
    {
      name: "contracts-must-stay-pure",
      severity: "error",
      comment: "Shared contracts are the leaf SSOT and must not depend on server, modules, or web code.",
      from: { path: "^packages/contracts/" },
      to: { path: "^(src|apps)/" },
    },
    {
      name: "connectors-no-direct-pg-or-routes",
      severity: "error",
      comment: "Connectors must stay decoupled from direct pg queries, HTTP routes, and business modules.",
      from: { path: "^src/connectors/" },
      to: {
        path: "(^node_modules/(pg|pg-query-stream|fastify)(/|$)|^src/modules/|^apps/)",
      },
    },
    {
      name: "shared-must-stay-leaf",
      severity: "error",
      comment: "src/shared utilities must not depend on pg, Fastify, connectors, modules, or apps.",
      from: { path: "^src/shared/" },
      to: {
        path: "(^node_modules/(pg|pg-query-stream|fastify)(/|$)|^src/(modules|connectors|storage)/|^apps/)",
      },
    },
    {
      name: "modules-no-app-entry",
      severity: "error",
      comment: "Domain modules must not import from apps/api or apps/web entrypoints.",
      from: { path: "^src/modules/" },
      to: { path: "^apps/" },
    },
    {
      name: "modules-no-cross-routes",
      severity: "error",
      comment: "Fastify route plugins are wired only in apps/api/src/app.ts; modules must not import another module's routes.ts.",
      from: { path: "^src/modules/([^/]+)/" },
      to: {
        path: "^src/modules/([^/]+)/routes\\.ts$",
        pathNot: "^src/modules/$1/",
      },
    },
    {
      name: "modules-no-cross-access-or-workspace",
      severity: "error",
      comment: "Auth (access) and personal workspace stay isolated; pass Actor via Fastify request instead of cross-importing internals.",
      from: { path: "^src/modules/([^/]+)/" },
      to: {
        path: "^src/modules/(access|workspace)/",
        pathNot: "^src/modules/$1/",
      },
    },
    {
      name: "no-retired-paths-or-connectors",
      severity: "error",
      comment: "Prevent re-introducing retired pre-050 architecture layers or retired online connectors.",
      from: {},
      to: {
        path: "^(src/(application|domain|runtime|jobs|workers|storage/repositories)/|workers/|src/connectors/(reddit/arctic-shift|x/twitterapi-io))",
      },
    },
    {
      name: "mainline-no-heavy-runtime-deps",
      severity: "error",
      comment: "Keep single-node 4 GB mainline free of ORMs, Redis/BullMQ, and headless browsers.",
      from: { path: "^(src|apps/api/src|packages/contracts/src)/" },
      to: {
        path: "^node_modules/(prisma|@prisma/client|typeorm|drizzle-orm|bullmq|ioredis|playwright|puppeteer)(/|$)",
      },
    },
    {
      name: "web-no-backend-imports",
      severity: "error",
      comment: "Frontend may import shared packages/contracts only, never backend src/ or apps/api/.",
      from: { path: "^apps/web/src/" },
      to: { path: "^(src|apps/api)/" },
    },
  ],
  options: {
    doNotFollow: {
      path: ["node_modules", "dist", "apps/web/dist", "output", "plugins"],
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types", "typings"],
    },
    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
  },
};
