import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer } from "preact/hooks";
import type { ChatMeta } from "../../models/chat";
import type { ProjectMeta } from "../../models/project";
import { chatApi } from "../../api/chatApi";
import { createChatInput } from "./createChatInput";
import { projectApi } from "../../api/projectApi";
import { useWorkspaceData } from "../hooks/workspace/useWorkspaceData";
import { useWorkspacePushLifecycle } from "../hooks/push/useWorkspacePushLifecycle";
import { useWorkspaceTitle } from "../hooks/workspace/useWorkspaceTitle";
import { useUserSettingsContext } from "./UserSettingsContext";
import type { SettingsTab, WorkspaceUiState } from "../../models/workspace";
import { workspaceUiState } from "./workspaceUiState";
import { workspaceSidebarService } from "../../services/workspace/workspaceSidebarService.ts";
import { agentCapabilityCatalogStore } from "../stores/agents/agentCapabilityCatalogStore";
import { currentWorkspaceRoute, navigateWorkspace } from "./workspaceNavigation";
import { useAuthContext } from "./AuthContext";

interface WorkspaceContextValue {
  chats: ChatMeta[];
  projects: ProjectMeta[];
  activeChat: ChatMeta | null;
  /** False until the first workspace snapshot lands. An empty list before that
   *  means "not known yet" — surfaces must show placeholders, not empty states. */
  loaded: boolean;
  ui: WorkspaceUiState;
  selectChat: (chatId: string | null) => void;
  openSidebar: () => void;
  closeSidebar: () => void;
  showChat: () => void;
  showSettings: () => void;
  selectSettingsTab: (tab: SettingsTab) => void;
  showProjectContainers: (projectId: string | null) => void;
  openCreateProject: () => void;
  closeCreateProject: () => void;
  createProject: (name: string) => Promise<ProjectMeta>;
  createChat: (projectId?: string) => Promise<ChatMeta>;
  deleteChat: (chatId: string) => Promise<void>;
  forkChat: (chatId: string) => Promise<ChatMeta>;
  deleteProject: (projectId: string) => Promise<void>;
  reorderProjects: (projectIds: string[]) => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ComponentChildren;
}) {
  ////////////////
  // Local State
  ////////////////
  const data = useWorkspaceData(enabled);
  const { auth } = useAuthContext();
  const { settings } = useUserSettingsContext();
  const [ui, dispatch] = useReducer(
    workspaceUiState.reduce,
    null,
    () => {
      const route = currentWorkspaceRoute();
      return workspaceUiState.createInitial(route.chatId, route.tab, route.view);
    }
  );
  const activeChat = workspaceSidebarService.activeChat(data.chats, ui.activeChatId);
  const account = auth.email || auth.adminEmail;
  const capabilityUserId = account || "anonymous";
  const activeCapabilityProjectId = activeChat?.projectId;

  ////////////////
  // Handlers
  ////////////////
  const openPushChat = useCallback((chatId: string) => {
    navigateWorkspace({ view: "chat", chatId, tab: "appearance" });
    dispatch({ type: "select-chat", chatId });
  }, []);

  const activateNewChat = useCallback((chat: ChatMeta): ChatMeta => {
    data.seedChat(chat);
    navigateWorkspace({ view: "chat", chatId: chat.id, tab: "appearance" });
    dispatch({ type: "select-chat", chatId: chat.id });
    return chat;
  }, [data.seedChat]);

  const createProject = useCallback(async (name: string): Promise<ProjectMeta> => {
    const project = await projectApi.create(name);
    return project;
  }, []);

  const createChat = useCallback(async (projectId?: string): Promise<ChatMeta> => {
    const chat = await chatApi.create(createChatInput(settings, projectId));
    return activateNewChat(chat);
  }, [settings, activateNewChat]);

  const deleteChat = useCallback(async (chatId: string) => {
    await chatApi.delete(chatId);
  }, []);

  const forkChat = useCallback(async (chatId: string): Promise<ChatMeta> => {
    const chat = await chatApi.fork(chatId);
    return activateNewChat(chat);
  }, [activateNewChat]);

  const deleteProject = useCallback(async (projectId: string) => {
    await projectApi.delete(projectId);
    agentCapabilityCatalogStore.getState().removeProject(capabilityUserId, projectId);
  }, [capabilityUserId]);

  const reorderProjects = useCallback(async (projectIds: string[]) => {
    await projectApi.reorder(projectIds);
  }, []);

  // Navigation commands update the address bar and workspace view together.
  const selectChat = useCallback((chatId: string | null) => {
    navigateWorkspace({ view: "chat", chatId, tab: "appearance" });
    dispatch({ type: "select-chat", chatId });
  }, []);
  const openSidebar = useCallback(() => dispatch({ type: "open-sidebar" }), []);
  const closeSidebar = useCallback(() => dispatch({ type: "close-sidebar" }), []);
  const showChat = useCallback(() => {
    navigateWorkspace({ view: "chat", chatId: ui.activeChatId, tab: ui.settingsTab });
    dispatch({ type: "show-chat" });
  }, [ui.activeChatId, ui.settingsTab]);
  const showSettings = useCallback(() => {
    navigateWorkspace({ view: "settings", chatId: null, tab: ui.settingsTab });
    dispatch({ type: "show-settings" });
  }, [ui.settingsTab]);
  const selectSettingsTab = useCallback((tab: SettingsTab) => {
    navigateWorkspace({ view: "settings", chatId: null, tab });
    dispatch({ type: "select-settings-tab", tab });
  }, []);
  const showProjectContainers = useCallback((projectId: string | null) => {
    navigateWorkspace({ view: "chat", chatId: null, tab: "appearance" });
    dispatch({ type: "show-project-containers", projectId });
  }, []);
  const openCreateProject = useCallback(() => dispatch({ type: "open-create-project" }), []);
  const closeCreateProject = useCallback(() => dispatch({ type: "close-create-project" }), []);

  ////////////////
  // Effects
  ////////////////
  useEffect(() => {
    const restore = () => {
      const route = currentWorkspaceRoute();
      dispatch({ type: "restore-route", chatId: route.chatId, view: route.view, tab: route.tab });
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  useEffect(() => {
    if (!enabled || !activeChat) return;
    void agentCapabilityCatalogStore.getState()
      .load(capabilityUserId, activeCapabilityProjectId)
      .catch(() => undefined);
  }, [enabled, capabilityUserId, activeCapabilityProjectId, activeChat?.id]);

  useWorkspacePushLifecycle({
    account: enabled ? account : "",
    activeChatId: ui.activeChatId,
    view: ui.view,
    openChat: openPushChat,
  });

  useWorkspaceTitle({
    chats: data.chats,
    activeChatId: ui.activeChatId,
    view: ui.view,
    enabled,
    loaded: data.loaded,
  });

  useEffect(() => {
    if (ui.view !== "chat" || !data.loaded) return;
    const chatId = workspaceSidebarService.initialChatId(enabled, ui.activeChatId, data.chats);
    if (chatId) {
      navigateWorkspace({ view: "chat", chatId, tab: ui.settingsTab }, true);
      dispatch({ type: "select-chat", chatId });
    }
  }, [data.chats, data.loaded, enabled, ui.activeChatId, ui.settingsTab, ui.view]);

  // Layout effect, not a passive one: the render that drops the chat from the
  // list already resolves activeChat to null, so a passive effect would let the
  // browser paint the "no chat selected" screen before the handover lands.
  useLayoutEffect(() => {
    // Wait for the first snapshot: a chat id handed over by a notification tap
    // would otherwise be discarded against a not-yet-populated list.
    if (!data.loaded || ui.view !== "chat") return;
    if (workspaceSidebarService.isActiveChatMissing(data.chats, ui.activeChatId)) {
      // Hand straight over to the next chat instead of clearing the selection:
      // clearing renders the "no chat selected" empty state for the one frame
      // before the initial-chat effect picks a replacement, which reads as a
      // flash of the New project screen after deleting a chat.
      const replacement = workspaceSidebarService.replacementChatId(data.chats);
      navigateWorkspace({ view: "chat", chatId: replacement, tab: ui.settingsTab }, true);
      dispatch({
        type: "select-chat",
        chatId: replacement,
      });
    }
  }, [data.chats, data.loaded, ui.activeChatId, ui.settingsTab, ui.view]);

  ////////////////
  // Context Value
  ////////////////
  // preact force-renders every subscriber whenever the provider's value fails a
  // `!=` check, so a fresh literal here repainted the whole workspace subtree on
  // any render of this provider — including ones driven by upstream auth or
  // settings ticks this tree does not read.
  const value = useMemo<WorkspaceContextValue>(() => ({
    chats: data.chats,
    projects: data.projects,
    activeChat,
    loaded: data.loaded,
    ui,
    selectChat,
    openSidebar,
    closeSidebar,
    showChat,
    showSettings,
    selectSettingsTab,
    showProjectContainers,
    openCreateProject,
    closeCreateProject,
    createProject,
    createChat,
    deleteChat,
    forkChat,
    deleteProject,
    reorderProjects,
  }), [
    data.chats,
    data.projects,
    data.loaded,
    activeChat,
    ui,
    selectChat,
    openSidebar,
    closeSidebar,
    showChat,
    showSettings,
    selectSettingsTab,
    showProjectContainers,
    openCreateProject,
    closeCreateProject,
    createProject,
    createChat,
    deleteChat,
    forkChat,
    deleteProject,
    reorderProjects,
  ]);

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspaceContext(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspaceContext must be used inside WorkspaceProvider");
  return value;
}
