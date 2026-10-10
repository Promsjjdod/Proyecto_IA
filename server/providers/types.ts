export type ProviderRecord = {
  id: string;
  user_id: string;
  type: string;
  name: string;
  base_url: string;
  secret_encrypted: string;
  auth_config_json: string;
};

export type ChatPart = { mime: string; data: Buffer };
export type CanonicalMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: ChatPart[];
  toolCalls?: ToolCall[];
  toolResults?: { id: string; name: string; content: string }[];
};
export type ToolCall = { id: string; name: string; arguments: Record<string, unknown> };
export type ToolDefinition = { name: string; description: string; schema: Record<string, unknown> };
export type StreamEvent = { type: 'delta'; text: string } | { type: 'usage'; inputTokens?: number; outputTokens?: number };
