import { Type, type Static } from "@sinclair/typebox";
import { Id, strictMerge } from "./common";

export const PlanTier = Type.Union([Type.Literal("free"), Type.Literal("pro")]);

export const Scopes = [
  "sources:write",
  "read",
  "export",
  "ingest",
  "collect",
  "projects:write",
] as const;

export const ActorSchema = Type.Object({
  userId: Id,
  email: Type.String(),
  role: Type.Union([
    Type.Literal("owner"),
    Type.Literal("admin"),
    Type.Literal("viewer"),
  ]),
  planTier: Type.Optional(PlanTier),
  clientKind: Type.Union([Type.Literal("browser"), Type.Literal("machine")]),
  sessionId: Id,
  scopes: Type.Array(Type.String()),
  allowedSourceIds: Type.Union([Type.Array(Id), Type.Null()]),
});

export type Actor = Static<typeof ActorSchema>;

export const Login = Type.Object(
  {
    email: Type.String({ minLength: 3, maxLength: 254 }),
    password: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);

export const BrowserLogin = strictMerge([
  Login,
  Type.Object({ remember: Type.Optional(Type.Boolean()) }),
]);

export const AccountEmailAddress = Type.String({ format: "email", maxLength: 254 });
export const AccountToken = Type.String({ pattern: "^[A-Za-z0-9_-]{43}$" });
const NewAccountPassword = Type.String({ minLength: 15, maxLength: 128 });

export const AccountEmailStart = Type.Object({
  email: AccountEmailAddress,
  proof: Type.String({ minLength: 1, maxLength: 2048 }),
  invite: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
}, { additionalProperties: false });

export const AccountEmailFinish = Type.Object({
  token: AccountToken,
  password: NewAccountPassword,
}, { additionalProperties: false });

export const AccountPasswordChange = Type.Object({
  currentPassword: Login.properties.password,
  password: NewAccountPassword,
}, { additionalProperties: false });

export const AuthenticatorCode = Type.String({ pattern: "^\\d{6}$" });

export const MfaLoginFinish = Type.Object({
  challenge: AccountToken,
  code: Type.Union([AuthenticatorCode, Type.String({ pattern: "^[a-fA-F0-9]{24}$" })]),
}, { additionalProperties: false });

export const MfaStepUp = Type.Object({ code: AuthenticatorCode }, { additionalProperties: false });

export const AccountInviteSummary = Type.Object({
  id: Id,
  role: Type.Union([Type.Literal("viewer"), Type.Literal("admin")]),
  status: Type.Union([
    Type.Literal("active"),
    Type.Literal("disabled"),
    Type.Literal("expired"),
    Type.Literal("used"),
  ]),
  emailBound: Type.Boolean(),
  expiresAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
});

export type AccountInviteDto = Static<typeof AccountInviteSummary>;

export const BrowserSession = Type.Object({
  id: Id,
  label: Type.String(),
  current: Type.Boolean(),
  createdAt: Type.String({ format: "date-time" }),
  lastSeenAt: Type.String({ format: "date-time" }),
  expiresAt: Type.String({ format: "date-time" }),
}, { additionalProperties: false });

export type BrowserSessionDto = Static<typeof BrowserSession>;

export const MachineKeyInput = Type.Object(
  {
    label: Type.String({ minLength: 1, maxLength: 100 }),
    scopes: Type.Array(Type.Union(Scopes.map((scope) => Type.Literal(scope))), {
      minItems: 1,
      uniqueItems: true,
    }),
    allowedSourceIds: Type.Array(Id, { maxItems: 1000, uniqueItems: true }),
    expiresInDays: Type.Integer({ minimum: 1, maximum: 90 }),
  },
  { additionalProperties: false },
);
