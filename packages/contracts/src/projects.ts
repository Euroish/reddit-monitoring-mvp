import { Type } from "@sinclair/typebox";
import { Id } from "./common";
import { ContentFilter } from "./content";

export const ProjectInput = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 100 }),
    sourceIds: Type.Array(Id, { minItems: 1, maxItems: 100 }),
    filter: ContentFilter,
    threadAware: Type.Optional(Type.Boolean()),
    includePushInTrends: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
