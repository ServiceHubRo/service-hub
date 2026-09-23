/** A fresh idempotency key for one logical write (`p_request_id`). */
export function newRequestId(): string {
  return crypto.randomUUID();
}
