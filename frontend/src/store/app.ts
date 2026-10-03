import { create } from 'zustand';
import { api } from '../lib/api';

export type Theme = 'dark' | 'light' | 'system';

export interface Toast { id: number; text: string; kind: 'info' | 'ok' | 'err' | 'warn'; }

interface AppState {
  theme: Theme;
  accent: string;
  density: string;
  sidebarCollapsed: boolean;
  sidebarOpenMobile: boolean;
  paletteOpen: boolean;
  settings: any;
  branding: { name: string; tagline: string; version: string; authRequired: boolean } | null;
  authed: boolean;
  toasts: Toast[];
  setTheme: (t: Theme) => void;
  setAccent: (a: string) => void;
  setDensity: (d: string) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  setMobileOpen: (v: boolean) => void;
  setPalette: (v: boolean) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dropToast: (id: number) => void;
  loadSettings: () => Promise<void>;
  saveSettings: (section: string, values: any) => Promise<void>;
  loadBranding: () => Promise<void>;
  applyAppearance: () => void;
}

function stored(key: string, fallback: string): string {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

export const useApp = create<AppState>((set, get) => ({
  theme: stored('forgeai.theme', 'system') as Theme,
  accent: stored('forgeai.accent', 'ember'),
  density: stored('forgeai.density', 'comfortable'),
  sidebarCollapsed: stored('forgeai.sidebar', '0') === '1',
  sidebarOpenMobile: false,
  paletteOpen: false,
  settings: null,
  branding: null,
  authed: true,
  toasts: [],

  setTheme: (t) => { try { localStorage.setItem('forgeai.theme', t); } catch { /* ignore */ } set({ theme: t }); get().applyAppearance(); },
  setAccent: (a) => { try { localStorage.setItem('forgeai.accent', a); } catch { /* ignore */ } set({ accent: a }); get().applyAppearance(); },
  setDensity: (d) => { try { localStorage.setItem('forgeai.density', d); } catch { /* ignore */ } set({ density: d }); get().applyAppearance(); },
  toggleSidebar: () => {
    const v = !get().sidebarCollapsed;
    try { localStorage.setItem('forgeai.sidebar', v ? '1' : '0'); } catch { /* ignore */ }
    set({ sidebarCollapsed: v });
  },
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  setMobileOpen: (v) => set({ sidebarOpenMobile: v }),
  setPalette: (v) => set({ paletteOpen: v }),

  toast: (text, kind = 'info') => {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    setTimeout(() => get().dropToast(id), 5200);
  },
  dropToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  applyAppearance: () => {
    const { theme, accent, density } = get();
    const root = document.documentElement;
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
    root.dataset.theme = resolved;
    root.dataset.accent = accent;
    document.body.dataset.density = density;
  },

  loadSettings: async () => {
    try {
      const { settings } = await api.get('/settings');
      set({ settings });
    } catch { /* backend offline */ }
  },
  saveSettings: async (section, values) => {
    const { settings } = await api.patch('/settings', { [section]: values });
    set({ settings });
  },
  loadBranding: async () => {
    try {
      const branding = await api.get('/system/branding');
      const me = await api.get('/auth/me');
      set({ branding, authed: me.authenticated !== false });
    } catch { /* ignore */ }
  },
}));

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (useApp.getState().theme === 'system') useApp.getState().applyAppearance();
});
