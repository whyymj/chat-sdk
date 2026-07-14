import { Plugin, DefineComponent, Ref } from 'vue';

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface AgentConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface AgentState {
  messages: AgentMessage[];
  loading: boolean;
  error: string | null;
}

export interface ChatDialogProps {
  /** 自定义 AI 请求函数，传入则覆盖内置的模拟回复 */
  fetchResponse?: (messages: AgentMessage[]) => Promise<string>;
  /** 对话框标题 */
  title?: string;
  /** 占位文本 */
  placeholder?: string;
}

export declare const ChatDialog: DefineComponent<ChatDialogProps>;

export declare function useChat(
  fetchFn?: (messages: AgentMessage[]) => Promise<string>
): {
  state: AgentState;
  scrollContainer: Ref<HTMLElement | null>;
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
};

export interface AgentOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export declare function useAgent(options: AgentOptions): {
  chat: (messages: AgentMessage[]) => Promise<string>;
  llm: any;
};

export declare const ZhuantiAgentPlugin: Plugin;
