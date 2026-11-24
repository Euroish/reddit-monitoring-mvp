import { Type } from "@sinclair/typebox";
import { Id } from "./common";
import { ContentFilter } from "./content";

export const ProjectDatasetMode = Type.Union([
  Type.Literal("source_filter"),
  Type.Literal("batch"),
]);

export const ProjectVisibility = Type.Union([
  Type.Literal("private"),
  Type.Literal("shared"),
]);

export const ProjectBatchStatus = Type.Union([
  Type.Literal("enabled"),
  Type.Literal("disabled"),
  Type.Literal("removed"),
]);

export const ProjectInput = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 100 }),
    description: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
    datasetMode: Type.Optional(ProjectDatasetMode),
    visibility: Type.Optional(ProjectVisibility),
    sourceIds: Type.Optional(Type.Array(Id, { minItems: 0, maxItems: 100 })),
    filter: Type.Optional(ContentFilter),
    threadAware: Type.Optional(Type.Boolean()),
    includePushInTrends: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const ProjectPublishInput = Type.Object(
  { visibility: ProjectVisibility, revision: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);

export const ProjectForkInput = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    description: Type.Optional(Type.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);

export const ProjectBatchAttachInput = Type.Object(
  { batchId: Id },
  { additionalProperties: false },
);

export const ProjectBatchMoveInput = Type.Object(
  { targetProjectId: Id },
  { additionalProperties: false },
);

export const ProjectBatchStatusInput = Type.Object(
  { status: ProjectBatchStatus },
  { additionalProperties: false },
);
