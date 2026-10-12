import type { AppUser } from "./entities/app-user";
import type { AccountSecurityActor } from "./repositories/app-user-repository";
export function accountAccessPolicy(actor: AccountSecurityActor, target: AppUser, changes: { role?: AppUser["role"]; status?: AppUser["status"] }): "allowed" | "forbidden" | "self_change" {
  if (actor.role === "viewer") return "forbidden";
  if (changes.role !== undefined && actor.role !== "owner" && actor.role !== "machine") return "forbidden";
  if (actor.role === "admin" && target.role !== "viewer") return "forbidden";
  const rank = { viewer: 0, admin: 1, owner: 2 };
  if (actor.userId === target.id && ((changes.status !== undefined && changes.status !== "active") || (changes.role !== undefined && rank[changes.role] < rank[target.role]))) return "self_change";
  return "allowed";
}
