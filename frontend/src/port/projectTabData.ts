import type { ProjectDataLoadSignal } from "../models/project.ts";

export interface ProjectTabDataLoads {
  info: (signal?: ProjectDataLoadSignal) => Promise<void>;
  secrets: (signal?: ProjectDataLoadSignal) => Promise<void>;
  access: (signal?: ProjectDataLoadSignal) => Promise<void>;
  shares: (signal?: ProjectDataLoadSignal) => Promise<void>;
}
