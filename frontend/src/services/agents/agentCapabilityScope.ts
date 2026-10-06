export function catalogKey(userId: string, projectId?: string): string {
  return JSON.stringify([normalizeUserId(userId), projectId || ""]);
}

export function normalizeUserId(userId: string): string {
  return userId.trim().toLowerCase() || "anonymous";
}
