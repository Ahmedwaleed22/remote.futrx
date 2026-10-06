import type { ProjectSettingsTab } from "../../models/project.ts";
import type { ProjectTabDataLoads } from "../../port/projectTabData.ts";

/** The tab owns which data is requested; lifecycle belongs to its controller. */
export function projectTabDataLoads(
  tab: ProjectSettingsTab,
  loads: ProjectTabDataLoads,
) {
  if (tab === "info" || tab === "settings") return [loads.info];
  if (tab === "secrets") return [loads.secrets];
  if (tab === "sharing") return [loads.access, loads.shares];
  return [];
}
