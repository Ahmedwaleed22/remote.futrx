import type {
  WorkspaceChatGateway,
  WorkspaceChatState,
} from "../../port/workspaceChats.ts";

/** Metadata responses belong to the feed generation that requested them. */
export class WorkspaceChatService {
  private readonly gateway: WorkspaceChatGateway;
  private readonly state: WorkspaceChatState;

  constructor(gateway: WorkspaceChatGateway, state: WorkspaceChatState) {
    this.gateway = gateway;
    this.state = state;
  }

  loadPage = async (before?: string): Promise<void> => {
    const generation = this.state.generation();
    const page = await this.gateway.page({ before });
    if (this.isCurrent(generation)) this.state.appendPage(page);
  };

  ensureChat = async (chatId: string): Promise<boolean> => {
    const generation = this.state.generation();
    try {
      const chat = await this.gateway.fetch(chatId);
      if (!this.isCurrent(generation)) return false;
      this.state.seedChat(chat);
      return true;
    } catch {
      return false;
    }
  };

  private isCurrent(generation: number): boolean {
    return (
      this.state.snapshot().loaded && this.state.generation() === generation
    );
  }
}
