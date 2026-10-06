import { projectTabDataLoads } from "../../../services/projects/projectTabDataService.ts";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type { ProjectMeta, ProjectSettingsTab } from "../../../models/project";
import { useProjectAccess } from "./useProjectAccess";
import { useProjectContainerInfo } from "./useProjectContainerInfo";
import { useProjectSecrets } from "./useProjectSecrets";
import { useProjectShares } from "./useProjectShares";

export function useProjectContainersController(
  projects: ProjectMeta[],
  selectedProjectId: string | null,
  activeTab: ProjectSettingsTab = "info",
) {
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const info = useProjectContainerInfo(
    selectedProject,
    activeTab === "settings",
  );
  const secrets = useProjectSecrets(selectedProject);
  const access = useProjectAccess(selectedProject);
  const shares = useProjectShares(selectedProject);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!selectedProject) return;
    setRefreshing(true);
    try {
      await Promise.all(
        projectTabDataLoads(activeTab, {
          info: info.load,
          secrets: secrets.load,
          access: access.load,
          shares: shares.load,
        }).map((load) => load()),
      );
    } finally {
      setRefreshing(false);
    }
  }, [
    selectedProject,
    activeTab,
    info.load,
    secrets.load,
    access.load,
    shares.load,
  ]);

  useEffect(() => {
    const abort = new AbortController();
    const signal = { cancelled: false, abortSignal: abort.signal };
    for (const load of projectTabDataLoads(activeTab, {
      info: info.load,
      secrets: secrets.load,
      access: access.load,
      shares: shares.load,
    }))
      void load(signal);
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
