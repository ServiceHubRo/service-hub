/** A fresh idempotency key for one logical write (`p_request_id`). */
export function newRequestId(): string {
  return crypto.randomUUID();
}

/**
 * A second idempotency key tied to `requestId`, for a second write made by the same tap (the
 * catalog's service and its reminder interval): a retry of the tap reuses both keys.
 */
export function siblingRequestId(requestId: string): string {
  const head = (parseInt(requestId.slice(0, 8), 16) ^ 0x5eed0001) >>> 0;
  return head.toString(16).padStart(8, '0') + requestId.slice(8);
}
