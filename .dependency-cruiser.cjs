/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Prevent circular dependencies across backend modules, connectors, platform, and contracts.",
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
      comment: "Connectors must stay decoupled from direct pg/storage queries, HTTP routes, and business modules.",
      from: { path: "^src/connectors/" },
      to: {
        path: "(^node_modules/(pg|pg-query-stream|fastify)(/|$)|^src/(modules|storage)/|^apps/)",
      },
    },
    {
      name: "shared-must-stay-leaf",
      severity: "error",
      comment: "src/shared utilities must not depend on pg, Fastify, connectors, modules, or apps.",
      from: { path: "^src/shared/" },
      to: {
        path: "(^node_modules/(pg|pg-query-stream|fastify)(/|$)|^src/(modules|connectors|storage|platform)/|^apps/)",
      },
    },
    {
      name: "platform-no-modules-or-apps",
      severity: "error",
      comment: "src/platform primitives must stay domain-agnostic and never depend on business modules or apps.",
      from: { path: "^src/platform/" },
      to: {
        path: "^(src/(modules|connectors)/|apps/)",
      },
    },
    {
      name: "modules-no-app-entry",
      severity: "error",
      comment: "Domain modules must not import from apps/api entrypoints.",
      from: { path: "^src/modules/" },
      to: { path: "^apps/" },
    },
    {
      name: "app-entry-modules-facade-only",
      severity: "error",
      comment: "Composition root apps/api/src must wire modules strictly via src/modules/<domain>/index.ts.",
      from: { path: "^apps/api/src/" },
      to: {
        path: "^src/modules/[^/]+/",
        pathNot: "^src/modules/[^/]+/index\\.ts$",
      },
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
      name: "modules-public-api-only",
      severity: "error",
      comment: "Cross-module imports must go through the target module's public index.ts facade, never internal sql/batch/helper files.",
      from: { path: "^src/modules/([^/]+)/" },
      to: {
        path: "^src/modules/([^/]+)/.+$",
        pathNot: ["^src/modules/$1/", "^src/modules/[^/]+/index\\.ts$"],
      },
    },
    {
      name: "modules-access-leaf",
      severity: "error",
      comment: "access is a strict leaf domain and must not depend on any sibling domain module.",
      from: { path: "^src/modules/access/" },
      to: {
        path: "^src/modules/",
        pathNot: "^src/modules/access/",
      },
    },
    {
      name: "modules-content-leaf",
      severity: "error",
      comment: "content is a strict leaf domain (project scope is injected from composition root) and must not depend on sibling domains.",
      from: { path: "^src/modules/content/" },
      to: {
        path: "^src/modules/",
        pathNot: "^src/modules/content/",
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
  ],
  options: {
    doNotFollow: {
      path: ["node_modules", "dist", "output", "plugins"],
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
