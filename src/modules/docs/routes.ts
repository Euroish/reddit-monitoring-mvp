import { Type } from "@sinclair/typebox";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { Actor } from "../../../packages/contracts/src/access";
import { ParamsId } from "../../../packages/contracts/src/common";
import { DocDetail, DocInput, DocPatch, DocSummary } from "../../../packages/contracts/src/product-docs";
import { fail } from "../../shared/errors";
import {
  createDocPage,
  deleteDocPage,
  getDocAttachment,
  getDocPage,
  isManager,
  listDocPages,
  updateDocPage,
} from "./sql";

const ParamsSlug = Type.Object(
  { slug: Type.String({ minLength: 1, maxLength: 80 }) },
  { additionalProperties: false },
);

function asciiName(name: string) {
  return name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
}

function requireManager(actor: Actor | null | undefined) {
  if (!isManager(actor)) fail(403, "Administrator access required");
  return actor as Actor;
}

export async function docsRoutes(app: FastifyInstance, pool: Pool) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  const detailResponse = { 200: Type.Object({ doc: DocDetail }) };
  const readAuth = { auth: { access: "public_read" as const, machineScope: "read" as const } };
  const adminAuth = { auth: { access: "admin" as const } };

  api.get(
    "/v1/docs",
    { config: readAuth, schema: { response: { 200: Type.Object({ docs: Type.Array(DocSummary) }) } } },
    async (request) => ({ docs: await listDocPages(pool, request.actor) }),
  );

  api.get(
    "/v1/docs/:slug",
    { config: readAuth, schema: { params: ParamsSlug, response: detailResponse } },
    async (request) => ({ doc: await getDocPage(pool, request.actor, request.params.slug) }),
  );

  api.get(
    "/v1/docs/:slug/file",
    {
      config: readAuth,
      schema: {
        params: ParamsSlug,
        response: {
          200: {
            description: "PDF attachment",
            content: {
              "application/pdf": { schema: Type.Unsafe<Buffer>({ type: "string", format: "binary" }) },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const file = await getDocAttachment(pool, request.actor, request.params.slug);
      return reply
        .header("Content-Type", "application/pdf")
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "default-src 'none'; sandbox")
        .header("Content-Length", String(file.bytes.length))
        .header(
          "Content-Disposition",
          `inline; filename="${asciiName(file.name)}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        )
        .header("Cache-Control", "private, no-store")
        .send(file.bytes);
    },
  );

  api.post(
    "/v1/docs",
    { config: adminAuth, schema: { body: DocInput, response: detailResponse }, bodyLimit: 12 * 1024 * 1024 },
    async (request) => ({
      doc: await createDocPage(pool, requireManager(request.actor), request.body),
    }),
  );

  api.patch(
    "/v1/docs/:id",
    {
      config: adminAuth,
      schema: { params: ParamsId, body: DocPatch, response: detailResponse },
      bodyLimit: 12 * 1024 * 1024,
    },
    async (request) => ({
      doc: await updateDocPage(pool, requireManager(request.actor), request.params.id, request.body),
    }),
  );

  api.delete(
    "/v1/docs/:id",
    { config: adminAuth, schema: { params: ParamsId, response: { 200: Type.Object({ deleted: Type.Boolean() }) } } },
    async (request) => deleteDocPage(pool, requireManager(request.actor), request.params.id),
  );
}
