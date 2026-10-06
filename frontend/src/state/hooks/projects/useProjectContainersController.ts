import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type { ProjectMeta } from "../../../models/project";
import { useProjectAccess } from "./useProjectAccess";
import { useProjectContainerInfo } from "./useProjectContainerInfo";
import { useProjectSecrets } from "./useProjectSecrets";
import { useProjectShares } from "./useProjectShares";

export function useProjectContainersController(
  projects: ProjectMeta[],
  selectedProjectId: string | null,
  activeTab: "info" | "settings" | "secrets" | "applications" | "sharing" = "info"
) {
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );
  const info = useProjectContainerInfo(selectedProject, activeTab === "settings");
  const secrets = useProjectSecrets(selectedProject);
  const access = useProjectAccess(selectedProject);
  const shares = useProjectShares(selectedProject);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!selectedProject) return;
    setRefreshing(true);
    try {
      await Promise.all([
        ...(activeTab === "info" || activeTab === "settings" ? [info.load()] : []),
        ...(activeTab === "secrets" ? [secrets.load()] : []),
        ...(activeTab === "sharing" ? [access.load(), shares.load()] : []),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [selectedProject, activeTab, info.load, secrets.load, access.load, shares.load]);

  useEffect(() => {
    const abort = new AbortController();
    const signal = { cancelled: false, abortSignal: abort.signal };
    if (activeTab === "info" || activeTab === "settings") void info.load(signal);
    if (activeTab === "secrets") void secrets.load(signal);
    if (activeTab === "sharing") { void access.load(signal); void shares.load(signal); }
    return () => {
      signal.cancelled = true;
      abort.abort();
    };
  }, [activeTab, info.load, secrets.load, access.load, shares.load]);

  return {
    selectedProject,
    info,
    secrets,
    access,
    shares,
    refreshing,
    refresh,
  };
}
