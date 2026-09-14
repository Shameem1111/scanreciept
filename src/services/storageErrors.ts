// Only these allowlisted messages may reach UI; never display native OAuth/API payloads.
export class StorageError extends Error {}
export function storageErrorMessage(error: unknown, fallback: string): string {
  return error instanceof StorageError ? error.message : fallback;
}
