import { insert } from '../db.js';

export function logAction(user, action, entity, entityId, details) {
  try {
    insert('audit_log', {
      user_id: user?.id ?? null,
      action,
      entity,
      entity_id: entityId == null ? null : String(entityId),
      details: details ? JSON.stringify(details) : null,
      at: new Date().toISOString(),
    });
  } catch (err) {
    // Auditing must never break the operation it is recording.
    console.error('[audit] failed to record', action, entity, err.message);
  }
}
