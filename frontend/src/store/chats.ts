import { create } from 'zustand';
import { api, errorMessage } from '../lib/api';
import { postSSE } from '../lib/sse';
import { useApp } from './app';

export interface Message {
  id: string;
  chatId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  model?: string;
  providerId?: string;
  agentId?: string;
  tokensIn?: number;
  tokensOut?: number;
  tokensPerSec?: number;
  durationMs?: number;
  error?: string;
  meta?: any;
  createdAt: number;
}

export interface Chat {
  id: string;
  title: string;
  model: string;
  providerId: string;
  agentId: string | null;
  folder: string;
  archived: boolean;
  pinned: boolean;
  systemPrompt: string;
  temperature: number | null;
  maxTokens: number | null;
  updatedAt: number;
  createdAt: number;
}

export interface ToolEvent { tool: string; label: string; phase: string; summary?: string; error?: string; args?: any; }

interface StreamState {
  active: boolean;
  text: string;
  tools: ToolEvent[];
  usage: { tokensIn?: number; tokensOut?: number; tokensPerSec?: number; durationMs?: number; demo?: boolean } | null;
  error: string | null;
  startedAt: number | null;
}

interface ChatsState {
  chats: Chat[];
  folders: string[];
  current: Chat | null;
  messages: Message[];
  stream: StreamState;
  pendingApproval: any | null;
  abort: (() => void) | null;
  loadChats: (opts?: { archived?: boolean; q?: string }) => Promise<void>;
  openChat: (id: string) => Promise<void>;
  newChat: (init?: Partial<Chat>) => Promise<Chat>;
  patchChat: (id: string, patch: Partial<Chat>) => Promise<void>;
  removeChat: (id: string) => Promise<void>;
  send: (content: string, opts?: { attachments?: any[]; regenerate?: boolean; editMessageId?: string; model?: string; providerId?: string; agentId?: string | null }) => Promise<void>;
  stop: () => void;
  setApproval: (a: any) => void;
  refreshMessages: () => Promise<void>;
}

const emptyStream: StreamState = { active: false, text: '', tools: [], usage: null, error: null, startedAt: null };

export const useChats = create<ChatsState>((set, get) => ({
  chats: [],
  folders: [],
  current: null,
  messages: [],
  stream: emptyStream,
  pendingApproval: null,
  abort: null,

  loadChats: async (opts) => {
    const qs = new URLSearchParams();
    if (opts?.archived) qs.set('archived', 'true');
    if (opts?.q) qs.set('q', opts.q);
    try {
      const { chats, folders } = await api.get(`/chats?${qs.toString()}`);
      set({ chats, folders });
    } catch (err) {
      useApp.getState().toast(errorMessage(err), 'err');
    }
  },

  openChat: async (id) => {
    try {
      const { chat, messages } = await api.get(`/chats/${id}`);
      set({ current: chat, messages, stream: emptyStream });
    } catch (err) {
      useApp.getState().toast(errorMessage(err), 'err');
    }
  },

  newChat: async (init) => {
    const { chat } = await api.post('/chats', init || {});
    await get().loadChats();
    set({ current: chat, messages: [], stream: emptyStream });
    return chat;
  },

  patchChat: async (id, patch) => {
    const { chat } = await api.patch(`/chats/${id}`, patch);
    set((s) => ({
      chats: s.chats.map((c) => (c.id === id ? { ...c, ...chat } : c)),
      current: s.current?.id === id ? { ...s.current, ...chat } : s.current,
    }));
    if (patch.archived !== undefined || patch.folder !== undefined) await get().loadChats();
  },

  removeChat: async (id) => {
    await api.del(`/chats/${id}`);
    if (get().current?.id === id) set({ current: null, messages: [], stream: emptyStream });
    await get().loadChats();
  },

  refreshMessages: async () => {
    const id = get().current?.id;
    if (!id) return;
    const { messages } = await api.get(`/chats/${id}/messages`);
    set({ messages });
  },

  setApproval: (a) => set({ pendingApproval: a }),

  stop: () => {
    get().abort?.();
    set({ stream: { ...get().stream, active: false }, abort: null });
  },

  send: async (content, opts = {}) => {
    const state = get();
    let chat = state.current;
    if (!chat) chat = await get().newChat();
    const chatId = chat.id;

    set({
      stream: { ...emptyStream, active: true, startedAt: Date.now() },
      messages: opts.regenerate
        ? state.messages
        : opts.editMessageId
          ? state.messages
          : [...state.messages, { id: `tmp_${Date.now()}`, chatId, role: 'user', content, createdAt: Date.now(), meta: opts.attachments?.length ? { attachments: opts.attachments } : undefined } as Message],
    });

    const patchTool = (tool: string, phase: string, extra: Partial<ToolEvent> = {}) => {
      set((s) => {
        const tools = [...s.stream.tools];
        const idx = tools.findLastIndex((t) => t.tool === tool && (t.phase === 'started' || t.phase === 'approval_required'));
        if (idx >= 0) tools[idx] = { ...tools[idx], phase, ...extra };
        else tools.push({ tool, label: tool, phase, ...extra });
        return { stream: { ...s.stream, tools } };
      });
    };

    const abort = postSSE(`/chats/${chatId}/completions`, {
      content,
      attachments: opts.attachments,
      regenerate: opts.regenerate,
      editMessageId: opts.editMessageId,
      model: opts.model,
      providerId: opts.providerId,
      agentId: opts.agentId,
    }, (event, data) => {
      if (event === 'delta') {
        set((s) => ({ stream: { ...s.stream, text: s.stream.text + (data.text || '') } }));
      } else if (event === 'tool_event') {
        if (data.phase === 'started') {
          set((s) => ({ stream: { ...s.stream, tools: [...s.stream.tools, { tool: data.tool, label: data.label, phase: 'started', args: data.args }] } }));
        } else if (data.phase === 'approval_required') {
          patchTool(data.tool, 'approval_required', { label: data.label });
        } else {
          patchTool(data.tool, data.phase, { summary: data.summary, error: data.error });
        }
      } else if (event === 'approval_required') {
        set({ pendingApproval: data });
      } else if (event === 'approval_resolved') {
        set((s) => (s.pendingApproval?.id === data.id ? { pendingApproval: null } : {}));
      } else if (event === 'usage') {
        set((s) => ({ stream: { ...s.stream, usage: { ...s.stream.usage, ...data } } }));
      } else if (event === 'message_done') {
        set((s) => ({ stream: { ...s.stream, usage: { ...s.stream.usage, ...data }, active: false } }));
      } else if (event === 'error') {
        set((s) => ({ stream: { ...s.stream, error: data.message || 'Unknown error.', active: false } }));
      }
    }, async () => {
      set({ abort: null });
      await get().refreshMessages();
      await get().loadChats();
      set((s) => ({ stream: { ...s.stream, active: false } }));
    });
    set({ abort });
  },
}));
