export type Mode = 'LOW' | 'MEDIO' | 'ALTO' | 'EXTRA' | 'MAX';
export type User = {
  id: string; email: string; name: string; role: 'admin' | 'user'; credits: number; dailyLimit: number; monthlyLimit: number;
  preferences: Record<string, any>; plan: string; createdAt: string;
};
export type Provider = { id: string; type: string; name: string; baseUrl: string; hasKey: boolean; status: string; lastCheckedAt?: string; modelCount: number };
export type Model = { id: string; displayName: string; source: 'detected' | 'manual'; status: string; favorite: boolean; capabilities: Record<string, boolean>; contextTokens?: number | null };
export type Chat = { id: string; title: string; projectId?: string | null; createdAt: string; updatedAt: string; messageCount: number };
export type Attachment = { id: string; name: string; mimeType: string; size: number; isImage?: boolean };
export type Message = { id: string; role: 'user' | 'assistant' | 'system'; content: string; providerId?: string; modelId?: string; mode?: Mode; agentId?: string; attachments?: Attachment[]; meta?: Record<string, any>; createdAt: string };
export type Project = { id: string; name: string; createdAt: string; updatedAt: string };
export type ProjectFile = { path: string; name: string; type: 'file' | 'directory'; bytes?: number; modifiedAt?: string };
export type Agent = { id: string; name: string; description: string; icon: string; instructions: string; providerId?: string | null; modelId?: string | null; mode: Mode; tools: string[]; limits: Record<string, any>; builtin: boolean; createdAt: string; updatedAt: string };
export type FlowNode = { id: string; type: string; name: string; config: Record<string, any> };
export type FlowEdge = { source: string; target: string; sourceHandle?: string };
export type Workflow = { id: string; name: string; description: string; nodes: FlowNode[]; edges: FlowEdge[]; createdAt: string; updatedAt: string };
export type ImageRecord = { id: string; modelId: string; prompt: string; mimeType: string; createdAt: string; fileUrl: string; size?: number };
