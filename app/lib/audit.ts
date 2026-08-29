import { database } from "./database";

export function canViewAuditLog(role: string) {
  return role === "super_admin" || role === "manager";
}

export async function logAudit(
  userId: number,
  action: string,
  entityType: string,
  entityId: string | number,
  description: string,
  details: Record<string, unknown> = {},
) {
  await database()
    .prepare("INSERT INTO audit_log (user_id,action,entity_type,entity_id,description,details_json) VALUES (?,?,?,?,?,?)")
    .bind(userId, action, entityType, String(entityId), description, JSON.stringify(details))
    .run();
}
