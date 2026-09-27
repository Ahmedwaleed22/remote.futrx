import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type { AppInstance } from "../../../models/application";

interface InstallLifecycleOptions {
  enabled: boolean;
  bindings: { list: () => Promise<AppInstance[]> } | null;
  instances: AppInstance[];
  setInstances: (instances: AppInstance[]) => void;
  notifySettled: () => void;
}

// Keep requests reserved across dialog unmounts and follow persisted attempts
// until the server records their final state. The set changes immediately for
// a second click; the revision also makes those changes visible to effects.
export function useInstallLifecycle({
  enabled,
  bindings,
  instances,
  setInstances,
  notifySettled,
}: InstallLifecycleOptions) {
  const pending = useMemo(() => new Set<string>(), [bindings]);
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

  // A dismissed dialog or a disconnected browser may leave a persisted
  // "installing" row. Follow it until the server records running/error so the
  // catalog and extension host settle without another manual page refresh.
  const hasPendingInstall = pending.size > 0;
  useEffect(() => {
    const shouldFollowInstall = hasPendingInstall || instances.some((instance) => instance.status === "installing");
    if (!enabled || !bindings || !shouldFollowInstall) return;
    let active = true;
    let polling = false;
    const timer = window.setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const next = await bindings.list();
        if (!active) return;
        setInstances(next ?? []);
        if (!next?.some((instance) => instance.status === "installing")) notifySettled();
      } catch {
        // A later poll or a manual reload can recover from a transient failure.
      } finally {
        polling = false;
      }
    }, 4000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [enabled, bindings, instances, setInstances, notifySettled, hasPendingInstall, revision]);

  return {
    beginInstall,
    pendingIds: new Set(pending),
  };
}
