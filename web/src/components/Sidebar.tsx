import { useState } from 'react';
import { Bot, Boxes, ChevronDown, CircleHelp, Clock3, Columns2, FolderKanban, GitCompareArrows, Image as ImageIcon, LogOut, MessageSquareText, Moon, Plus, Search, Settings2, ShieldCheck, Sun, Workflow, X } from 'lucide-react';
import type { Chat, Project, User } from '../types';
import { BrandMark } from './common';

export type ViewId = 'chat' | 'compare' | 'projects' | 'agents' | 'automations' | 'images' | 'providers' | 'settings' | 'admin';
const navSections: { label: string; items: { id: ViewId; label: string; icon: typeof MessageSquareText; badge?: string }[] }[] = [
  { label: 'ESPACIO', items: [{ id: 'chat', label: 'Chat', icon: MessageSquareText }, { id: 'compare', label: 'Comparar modelos', icon: GitCompareArrows }, { id: 'projects', label: 'Proyectos', icon: FolderKanban }, { id: 'images', label: 'Imágenes', icon: ImageIcon }] },
  { label: 'CREAR', items: [{ id: 'agents', label: 'Agentes', icon: Bot }, { id: 'automations', label: 'Automatizaciones', icon: Workflow }] },
  { label: 'AJUSTES', items: [{ id: 'providers', label: 'Proveedores', icon: Boxes }, { id: 'settings', label: 'Preferencias', icon: Settings2 }] },
];

export function Sidebar({ view, onNavigate, chats, activeChatId, onSelectChat, onNewChat, onSearch, projects, activeProjectId, onSelectProject, user, theme, onThemeToggle, onLogout, mobileOpen, onCloseMobile }: {
  view: ViewId; onNavigate: (view: ViewId) => void; chats: Chat[]; activeChatId: string | null; onSelectChat: (id: string) => void; onNewChat: () => void; onSearch: (q: string) => void;
  projects: Project[]; activeProjectId: string | null; onSelectProject: (id: string | null) => void; user: User; theme: string; onThemeToggle: () => void; onLogout: () => void; mobileOpen: boolean; onCloseMobile: () => void;
}) {
  const [query, setQuery] = useState('');
  const [historyOpen, setHistoryOpen] = useState(true);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const selectedProject = projects.find((project) => project.id === activeProjectId);
  return <>
    {mobileOpen && <button className="sidebar-scrim" aria-label="Cerrar navegación" onClick={onCloseMobile} />}
    <aside className={`sidebar ${mobileOpen ? 'sidebar-mobile-open' : ''}`}>
      <div className="sidebar-top">
        <div className="sidebar-brand"><BrandMark /><div><b>NEXUS</b><small>AI WORKSPACE</small></div><button className="icon-button sidebar-close" onClick={onCloseMobile} aria-label="Cerrar menú"><X size={17} /></button></div>
        <div className="workspace-switcher-wrap">
          <button className="workspace-switcher" onClick={() => setProjectMenuOpen(!projectMenuOpen)}>
            <span className="workspace-switcher-icon"><FolderKanban size={15} /></span><span className="workspace-switcher-copy"><small>PROYECTO ACTIVO</small><b>{selectedProject?.name || 'Sin proyecto'}</b></span><ChevronDown size={14} className={projectMenuOpen ? 'rotate-180' : ''} />
          </button>
          {projectMenuOpen && <div className="project-menu popover-menu">
            <button onClick={() => { onSelectProject(null); setProjectMenuOpen(false); }}>Sin proyecto</button>
            {projects.map((project) => <button key={project.id} className={project.id === activeProjectId ? 'selected' : ''} onClick={() => { onSelectProject(project.id); setProjectMenuOpen(false); }}>{project.name}</button>)}
            <button className="project-menu-new" onClick={() => { onNavigate('projects'); setProjectMenuOpen(false); }}><Plus size={14} /> Crear proyecto</button>
          </div>}
        </div>
        <button className="new-chat-button" onClick={onNewChat}><span><Plus size={17} /></span>Nuevo chat <kbd>⌘ K</kbd></button>
      </div>
      <nav className="sidebar-nav">
        {navSections.map((section) => <div className="nav-section" key={section.label}><div className="nav-section-title">{section.label}</div>{section.items.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${view === id ? 'active' : ''}`} onClick={() => { onNavigate(id); onCloseMobile(); }}><Icon size={17} strokeWidth={1.75} /><span>{label}</span>{id === 'providers' && <span className="nav-item-dot" />}</button>)}</div>)}
        {user.role === 'admin' && <div className="nav-section admin-nav-section"><div className="nav-section-title">ADMINISTRACIÓN</div><button className={`nav-item ${view === 'admin' ? 'active' : ''}`} onClick={() => { onNavigate('admin'); onCloseMobile(); }}><ShieldCheck size={17} strokeWidth={1.75} /><span>Panel de administración</span></button></div>}
        <div className="history-section">
          <button className="history-header" onClick={() => setHistoryOpen(!historyOpen)}><span>RECIENTES</span><ChevronDown size={13} className={historyOpen ? '' : 'rotate-180'} /></button>
          {historyOpen && <>
            <div className="history-search"><Search size={13} /><input value={query} onChange={(event) => { setQuery(event.target.value); onSearch(event.target.value); }} placeholder="Buscar chats" aria-label="Buscar chats" />{query && <button onClick={() => { setQuery(''); onSearch(''); }} aria-label="Borrar búsqueda">×</button>}</div>
            <div className="chat-history-list">{chats.length ? chats.map((chat) => <button key={chat.id} className={`history-chat ${activeChatId === chat.id && view === 'chat' ? 'selected' : ''}`} title={chat.title} onClick={() => { onSelectChat(chat.id); onNavigate('chat'); onCloseMobile(); }}><MessageSquareText size={14} /><span>{chat.title}</span></button>) : <p className="history-empty">{query ? 'Sin coincidencias' : 'Tus conversaciones aparecerán aquí'}</p>}</div>
          </>}
        </div>
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-plan-card"><div className="plan-card-top"><span className="plan-label"><span className="plan-dot" /> PLAN FREE</span><span className="plan-upgrade">PRO pronto</span></div><div className="credit-bar"><i style={{ width: `${Math.min(100, Math.max(4, user.credits / 500))}%` }} /></div><div className="credit-caption"><span>{user.role === 'admin' ? 'Uso interno ilimitado' : `${user.credits.toLocaleString()} créditos`}</span>{user.role !== 'admin' && <span>·</span>}</div></div>
        <div className="sidebar-controls"><button className="sidebar-icon-action" onClick={onThemeToggle} title={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button><button className="sidebar-icon-action" onClick={() => onNavigate('settings')} title="Preferencias"><Settings2 size={16} /></button><button className="sidebar-icon-action" onClick={() => window.open('https://github.com/Promsjjdod/Proyecto_IA', '_blank', 'noopener,noreferrer')} title="Ayuda"><CircleHelp size={16} /></button></div>
        <div className="profile-wrap">
          {profileOpen && <div className="profile-popover popover-menu"><div className="profile-popover-user"><span className="avatar avatar-lg">{user.name.slice(0, 1).toUpperCase()}</span><span><b>{user.name}</b><small>{user.email}</small></span></div><button onClick={() => { onNavigate('settings'); setProfileOpen(false); }}><Settings2 size={15} />Perfil y preferencias</button><button className="logout-button" onClick={onLogout}><LogOut size={15} />Cerrar sesión</button></div>}
          <button className="profile-button" onClick={() => setProfileOpen(!profileOpen)}><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span><span className="profile-copy"><b>{user.name}</b><small>{user.role === 'admin' ? 'Administrador' : 'Cuenta gratuita'}</small></span><ChevronDown size={14} /></button>
        </div>
      </div>
    </aside>
  </>;
}
