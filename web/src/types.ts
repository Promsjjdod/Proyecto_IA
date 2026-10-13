export type Mode = 'LOW' | 'MEDIO' | 'HIGH' | 'MAX';
export function normalizeMode(value: unknown): Mode {
  const normalized = String(value || '').toUpperCase();
  if (normalized === 'ALTO' || normalized === 'EXTRA') return 'HIGH';
  return normalized === 'LOW' || normalized === 'HIGH' || normalized === 'MAX' ? normalized : 'MEDIO';
}
export type User = {
  id: string; email: string; name: string; role: 'admin' | 'user'; credits: number; dailyLimit: number; monthlyLimit: number;
  preferences: Record<string, any>; plan: string; createdAt: string;
};
export type Provider = { id: string; type: string; name: string; baseUrl: string; hasKey: boolean; status: string; lastCheckedAt?: string; modelCount: number };
export type Model = { id: string; displayName: string; source: 'detected' | 'manual'; status: string; favorite: boolean; capabilities: Record<string, boolean>; contextTokens?: number | null; maxInputTokens?: number | null; maxOutputTokens?: number | null; providerMaxOutputTokens?: number | null; configuredMaxOutputTokens?: number | null; outputLimitSource?: 'provider-metadata' | 'user-configured' | 'unknown'; outputTokenParameter?: 'max_tokens' | 'max_completion_tokens' | null };
export type Chat = { id: string; title: string; projectId?: string | null; createdAt: string; updatedAt: string; deletedAt?: string | null; messageCount: number };
export type Attachment = { id: string; name: string; mimeType: string; size: number; isImage?: boolean; source?: 'upload' | 'image-library'; fileUrl?: string };
export type Message = { id: string; role: 'user' | 'assistant' | 'system'; content: string; providerId?: string; modelId?: string; mode?: Mode; agentId?: string; attachments?: Attachment[]; meta?: Record<string, any>; createdAt: string };
export type Project = { id: string; name: string; createdAt: string; updatedAt: string };
export type ProjectFile = { path: string; name: string; type: 'file' | 'directory'; bytes?: number; modifiedAt?: string };
export type Agent = { id: string; name: string; description: string; icon: string; instructions: string; providerId?: string | null; modelId?: string | null; mode: Mode; tools: string[]; limits: Record<string, any>; builtin: boolean; createdAt: string; updatedAt: string };
export type FlowNode = { id: string; type: string; name: string; config: Record<string, any>; position?: { x: number; y: number } };
export type FlowEdge = { source: string; target: string; sourceHandle?: string };
export type Workflow = { id: string; name: string; description: string; nodes: FlowNode[]; edges: FlowEdge[]; enabled?: boolean; createdAt: string; updatedAt: string };
export type ImageRecord = { id: string; modelId: string; prompt: string; mimeType: string; createdAt: string; fileUrl: string; size?: number };
