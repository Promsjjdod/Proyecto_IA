import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { api, setCsrfToken } from './api';
import type { Agent, Chat, ImageRecord, Message, Model, Mode, Project, Provider, User, Workflow } from './types';
import { Sidebar, type ViewId } from './components/Sidebar';
import { Header } from './components/Header';
import { BrandMark } from './components/common';

const AuthPage = lazy(() => import('./components/AuthPage').then((module) => ({ default: module.AuthPage })));
const ChatPage = lazy(() => import('./components/ChatPage').then((module) => ({ default: module.ChatPage })));
const ProviderPage = lazy(() => import('./components/ProviderPage').then((module) => ({ default: module.ProviderPage })));
const AgentsPage = lazy(() => import('./components/AgentsPage').then((module) => ({ default: module.AgentsPage })));
const ProjectsPage = lazy(() => import('./components/ProjectsPage').then((module) => ({ default: module.ProjectsPage })));
const AutomationPage = lazy(() => import('./components/AutomationPage').then((module) => ({ default: module.AutomationPage })));
const ImagesPage = lazy(() => import('./components/ImagesPage').then((module) => ({ default: module.ImagesPage })));
const ComparePage = lazy(() => import('./components/ComparePage').then((module) => ({ default: module.ComparePage })));
const SettingsPage = lazy(() => import('./components/SettingsPage').then((module) => ({ default: module.SettingsPage })));
const AdminPage = lazy(() => import('./components/AdminPage').then((module) => ({ default: module.AdminPage })));

const titles: Record<ViewId, string> = { chat: 'Conversación', compare: 'Comparar modelos', projects: 'Proyectos', agents: 'Agentes', automations: 'Automatizaciones', images: 'Imágenes', providers: 'Proveedores', settings: 'Preferencias', admin: 'Administración' };

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [view, setView] = useState<ViewId>('chat');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, Model[]>>({});
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatSearch, setChatSearch] = useState('');
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [providerId, setProviderId] = useState('');
  const [modelId, setModelId] = useState('');
  const [mode, setMode] = useState<Mode>('MEDIO');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [theme, setTheme] = useState('dark');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loadError, setLoadError] = useState('');
  const projectStorageKey = user ? `nexus-active-project-${user.id}` : '';

  useEffect(() => {
    let cancelled = false;
    api<{ user: User; csrfToken: string }>('/auth/me').then((data) => {
      if (cancelled) return;
      setCsrfToken(data.csrfToken); setUser(data.user);
      setMode((data.user.preferences?.defaultMode as Mode) || 'MEDIO');
      setTheme(data.user.preferences?.theme || 'dark');
      const savedProject = localStorage.getItem(`nexus-active-project-${data.user.id}`);
      setActiveProjectId(savedProject);
    }).catch(() => { if (!cancelled) { setUser(null); setCsrfToken(''); } }).finally(() => { if (!cancelled) setAuthLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const loadProviders = useCallback(async () => {
    if (!user) return;
    try {
      const list = await api<Provider[]>('/providers');
      setProviders(list);
      const results = await Promise.all(list.map(async (provider) => [provider.id, await api<Model[]>(`/providers/${encodeURIComponent(provider.id)}/models`).catch(() => [])] as const));
      const map = Object.fromEntries(results);
      setModelsByProvider(map);
      const prefs = user.preferences || {};
      const prefProvider = String(prefs.defaultProviderId || '');
      const prefModel = String(prefs.defaultModelId || '');
      const prefValid = map[prefProvider]?.some((item) => item.id === prefModel && item.status !== 'unavailable');
      const first = list.flatMap((provider) => (map[provider.id] || []).filter((item) => item.status !== 'unavailable').map((item) => ({ provider, model: item }))).sort((a, b) => Number(b.model.favorite) - Number(a.model.favorite))[0];
      if (prefValid) { setProviderId(prefProvider); setModelId(prefModel); }
      else if (first && (!providerId || !map[providerId]?.some((item) => item.id === modelId && item.status !== 'unavailable'))) { setProviderId(first.provider.id); setModelId(first.model.id); }
      else if (!first) { setProviderId(''); setModelId(''); }
    } catch (error) { setLoadError(error instanceof Error ? error.message : 'No se pudieron cargar los proveedores.'); }
  }, [user, providerId, modelId]);

  const refreshChats = useCallback(async () => {
    if (!user) return;
    try { setChats(await api<Chat[]>(`/chats${chatSearch ? `?q=${encodeURIComponent(chatSearch)}` : ''}`)); }
    catch (error) { setLoadError(error instanceof Error ? error.message : 'No se pudo cargar el historial.'); }
  }, [user, chatSearch]);
  const refreshProjects = useCallback(async () => {
    if (!user) return;
    try {
      const list = await api<Project[]>('/projects'); setProjects(list);
      const active = localStorage.getItem(`nexus-active-project-${user.id}`);
      if (active && !list.some((project) => project.id === active)) { localStorage.removeItem(`nexus-active-project-${user.id}`); setActiveProjectId(null); }
      else if (!active && list[0] && !activeProjectId) { setActiveProjectId(list[0].id); localStorage.setItem(`nexus-active-project-${user.id}`, list[0].id); }
    } catch { /* projects remain usable after a transient API error */ }
  }, [user, activeProjectId]);
  const refreshAgents = useCallback(async () => { if (user) try { setAgents(await api<Agent[]>('/agents')); } catch { /* no-op */ } }, [user]);
  const refreshUsage = useCallback(async () => {
    if (!user) return;
    try { const result = await api<any>('/profile/credits'); setUser((current) => current ? { ...current, credits: result.credits, dailyLimit: result.dailyLimit, monthlyLimit: result.monthlyLimit, role: result.role } : current); }
    catch { /* keep last known balance */ }
  }, [user?.id]);
  const refreshWorkflows = useCallback(async () => { if (user) try { setWorkflows(await api<Workflow[]>('/workflows')); } catch { /* no-op */ } }, [user]);

  useEffect(() => {
    if (!user) return;
    setDataLoading(true); setLoadError('');
    Promise.all([loadProviders(), refreshChats(), refreshProjects(), refreshAgents(), refreshWorkflows()]).finally(() => setDataLoading(false));
  }, [user?.id]);
  useEffect(() => { if (user) void refreshChats(); }, [chatSearch]);
  useEffect(() => {
    if (!user || !activeChatId) { if (!activeChatId) setMessages([]); return; }
    let cancelled = false;
    api<Message[]>(`/chats/${encodeURIComponent(activeChatId)}/messages`).then((items) => {
      if (!cancelled) setMessages((current) => current.some((item) => item.id.startsWith('local-')) && items.length === 0 ? current : items);
    }).catch((error) => { if (!cancelled) setLoadError(error instanceof Error ? error.message : 'No se pudo abrir la conversación.'); });
    return () => { cancelled = true; };
  }, [activeChatId, user?.id]);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      if (!user) return;
      setView('chat'); setActiveChatId(null); setMessages([]); setSelectedAgentId(''); setMobileOpen(false);
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [user?.id]);

  const handleAuthenticated = (nextUser: User) => {
    setUser(nextUser); setMode((nextUser.preferences?.defaultMode as Mode) || 'MEDIO'); setTheme(nextUser.preferences?.theme || 'dark'); setView('chat');
    setActiveProjectId(localStorage.getItem(`nexus-active-project-${nextUser.id}`));
  };
  const logout = async () => {
    try { await api('/auth/logout', { method: 'POST', body: '{}' }); } catch { /* session may already be expired */ }
    setCsrfToken(''); setUser(null); setChats([]); setProviders([]); setModelsByProvider({}); setProjects([]); setAgents([]); setWorkflows([]); setMessages([]); setActiveChatId(null); setProviderId(''); setModelId('');
  };
  const newChat = () => { setView('chat'); setActiveChatId(null); setMessages([]); setSelectedAgentId(''); setMobileOpen(false); };
  const updateActiveProject = (id: string | null) => { setActiveProjectId(id); if (user) { if (id) localStorage.setItem(`nexus-active-project-${user.id}`, id); else localStorage.removeItem(`nexus-active-project-${user.id}`); } };
  const updateModel = (nextProvider: string, nextModel: string) => {
    setProviderId(nextProvider); setModelId(nextModel);
    if (user) void api('/profile/preferences', { method: 'PATCH', body: JSON.stringify({ preferences: { defaultProviderId: nextProvider, defaultModelId: nextModel } }) }).then((result: any) => setUser((current) => current ? { ...current, preferences: result.preferences } : current)).catch(() => undefined);
  };
  const updateMode = (nextMode: Mode) => {
    setMode(nextMode);
    if (user) void api('/profile/preferences', { method: 'PATCH', body: JSON.stringify({ preferences: { defaultMode: nextMode } }) }).then((result: any) => setUser((current) => current ? { ...current, preferences: result.preferences } : current)).catch(() => undefined);
  };
  const updateUser = (nextUser: User) => setUser(nextUser);
  const changeTheme = (nextTheme: string) => setTheme(nextTheme);
  const selectChat = (id: string) => { setActiveChatId(id); setSelectedAgentId(''); setView('chat'); };
  const continueCompare = (id: string, nextProvider: string, nextModel: string) => { setActiveChatId(id); setProviderId(nextProvider); setModelId(nextModel); setView('chat'); setSelectedAgentId(''); };
  const onAgentChange = (id: string) => { setSelectedAgentId(id); const agent = agents.find((item) => item.id === id); if (agent) { setMode(agent.mode); if (agent.providerId && agent.modelId) { setProviderId(agent.providerId); setModelId(agent.modelId); } } };
  const onSearch = (value: string) => setChatSearch(value);
  const refreshWorkspace = () => { void refreshChats(); void refreshProjects(); void refreshAgents(); void refreshWorkflows(); };

  if (authLoading) return <div className="app-loading"><div className="loading-logo"><BrandMark /></div><LoaderCircle size={18} className="spin" /><span>Preparando tu espacio</span></div>;
  if (!user) return <Suspense fallback={<div className="app-loading"><LoaderCircle size={18} className="spin" /><span>Preparando acceso…</span></div>}><AuthPage onAuthenticated={handleAuthenticated} /></Suspense>;
  const selectedModelAvailable = (modelsByProvider[providerId] || []).some((item) => item.id === modelId && item.status !== 'unavailable');
  const mainPage = () => {
    switch (view) {
      case 'chat': return <ChatPage user={user} chats={chats} chatId={activeChatId} onChatChange={setActiveChatId} messages={messages} onMessagesChange={setMessages} onRefreshChats={refreshWorkspace} onRefreshUsage={refreshUsage} providers={providers} modelsByProvider={modelsByProvider} providerId={providerId} modelId={modelId} mode={mode} agents={agents} selectedAgentId={selectedAgentId} onAgentChange={onAgentChange} activeProjectId={activeProjectId} projects={projects} onGoProviders={() => setView('providers')} onModeChange={updateMode} />;
      case 'providers': return <ProviderPage providers={providers} modelsByProvider={modelsByProvider} onRefresh={() => { void loadProviders(); }} />;
      case 'agents': return <AgentsPage agents={agents} providers={providers} modelsByProvider={modelsByProvider} selectedAgentId={selectedAgentId} onAgentChange={onAgentChange} onRefresh={() => void refreshAgents()} onGoChat={() => setView('chat')} activeProjectId={activeProjectId} />;
      case 'projects': return <ProjectsPage projects={projects} activeProjectId={activeProjectId} onSelectProject={updateActiveProject} onRefresh={() => void refreshProjects()} />;
      case 'automations': return <AutomationPage workflows={workflows} providers={providers} modelsByProvider={modelsByProvider} agents={agents} projects={projects} activeProjectId={activeProjectId} onRefresh={() => void refreshWorkflows()} onRefreshUsage={refreshUsage} />;
      case 'images': return <ImagesPage providers={providers} projects={projects} activeProjectId={activeProjectId} onRefreshProjects={() => void refreshProjects()} onRefreshUsage={refreshUsage} />;
      case 'compare': return <ComparePage user={user} providers={providers} modelsByProvider={modelsByProvider} activeProjectId={activeProjectId} onContinue={continueCompare} onRefreshUsage={refreshUsage} />;
      case 'settings': return <SettingsPage user={user} providers={providers} modelsByProvider={modelsByProvider} mode={mode} onModeChange={updateMode} onUserUpdated={updateUser} onThemeChanged={changeTheme} />;
      case 'admin': return <AdminPage user={user} />;
    }
  };
  return <div className="app-root" data-theme={theme}>
    <Sidebar view={view} onNavigate={setView} chats={chats} activeChatId={activeChatId} onSelectChat={selectChat} onNewChat={newChat} onSearch={onSearch} projects={projects} activeProjectId={activeProjectId} onSelectProject={updateActiveProject} user={user} theme={theme} onThemeToggle={() => { const next = theme === 'dark' ? 'light' : 'dark'; setTheme(next); void api('/profile/preferences', { method: 'PATCH', body: JSON.stringify({ preferences: { theme: next } }) }).then((result: any) => setUser((current) => current ? { ...current, preferences: result.preferences } : current)).catch(() => undefined); }} onLogout={() => void logout()} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
    <div className="app-main"><Header view={view} providers={providers} modelsByProvider={modelsByProvider} providerId={providerId} modelId={modelId} mode={mode} onModelChange={updateModel} onModeChange={updateMode} onMenu={() => setMobileOpen(true)} />
      {loadError && <div className="global-load-error"><span>{loadError}</span><button onClick={() => setLoadError('')}>×</button></div>}
      <main className={`view-main view-${view}`}>{dataLoading && !providers.length && view !== 'chat' ? <div className="content-loading"><LoaderCircle className="spin" size={20} />Cargando espacio…</div> : <Suspense fallback={<div className="content-loading"><LoaderCircle className="spin" size={20} />Cargando vista…</div>}>{mainPage()}</Suspense>}</main>
      <footer className="app-footer"><span><i /> {selectedModelAvailable ? 'SERVICIOS CONECTADOS' : 'CONFIGURACIÓN PENDIENTE'}</span><span>{titles[view]} · Nexus Workspace 0.1</span><span>Los proveedores externos responden con sus propias políticas</span></footer>
    </div>
  </div>;
}
