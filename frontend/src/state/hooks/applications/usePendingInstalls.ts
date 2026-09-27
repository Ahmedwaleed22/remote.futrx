import { useCallback, useMemo, useState } from "preact/hooks";

// Keep a request reserved across dialog unmounts. The set changes immediately
// for a second click, while the revision makes those changes visible to effects.
export function usePendingInstalls(scopeIdentity: object | null) {
  const pending = useMemo(() => new Set<string>(), [scopeIdentity]);
  const [revision, setRevision] = useState(0);

  const beginInstall = useCallback((applicationId: string): (() => void) | null => {
    if (pending.has(applicationId)) return null;
    pending.add(applicationId);
    setRevision((current) => current + 1);
    return () => {
      pending.delete(applicationId);
      setRevision((current) => current + 1);
    };
  }, [pending]);

  return {
    beginInstall,
    hasPendingInstall: pending.size > 0,
    pendingIds: new Set(pending),
    revision,
  };
}
