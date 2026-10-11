import { useCallback, useEffect, useState } from 'react';
import { Clock3, RotateCcw, Trash2 } from 'lucide-react';
import type { Chat } from '../types';
import { api } from '../api';
import { EmptyState, ErrorBanner } from './common';

export function TrashPage({ onRefreshChats }: { onRefreshChats: () => void }) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try { setChats(await api<Chat[]>('/chats?trash=true')); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cargar la papelera.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const restore = async (chat: Chat) => {
    setBusyId(chat.id); setError(''); setNotice('');
    try {
      await api(`/chats/${encodeURIComponent(chat.id)}/restore`, { method: 'POST', body: '{}' });
      setChats((current) => current.filter((item) => item.id !== chat.id));
      setNotice(`«${chat.title}» se restauró al historial.`); onRefreshChats();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo restaurar la conversación.'); }
    finally { setBusyId(''); }
  };
  const permanentlyDelete = async (chat: Chat) => {
    if (!window.confirm(`Eliminar definitivamente «${chat.title}» y sus mensajes. Esta acción no se puede deshacer.`)) return;
    setBusyId(chat.id); setError(''); setNotice('');
    try {
      await api(`/chats/${encodeURIComponent(chat.id)}/permanent`, { method: 'DELETE', body: JSON.stringify({ confirm: true }) });
      setChats((current) => current.filter((item) => item.id !== chat.id));
      setNotice(`«${chat.title}» se eliminó definitivamente.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo eliminar la conversación.'); }
    finally { setBusyId(''); }
  };

  return <div className="page-content trash-page">
    <div className="page-heading-row"><div><div className="eyebrow"><span className="eyebrow-dot" /> HISTORIAL RECUPERABLE</div><h1>Papelera</h1><p>Los chats movidos aquí se conservan hasta que los restaures o elimines definitivamente.</p></div><button className="button button-secondary button-sm" onClick={() => void load()} disabled={loading}><Clock3 size={14} />Actualizar</button></div>
    {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}
    {notice && <div className="success-banner">{notice}<button className="icon-button" onClick={() => setNotice('')}>×</button></div>}
    {loading ? <div className="content-loading">Cargando papelera…</div> : chats.length ? <div className="trash-chat-list">{chats.map((chat) => <article className="trash-chat-card" key={chat.id}><div className="trash-chat-icon"><Trash2 size={17} /></div><div className="trash-chat-meta"><b>{chat.title}</b><small>{chat.messageCount} mensajes · Movido {chat.deletedAt ? new Date(chat.deletedAt).toLocaleString() : 'a la papelera'}</small></div><div className="trash-chat-actions"><button className="button button-secondary button-sm" onClick={() => void restore(chat)} disabled={busyId === chat.id}><RotateCcw size={14} />Restaurar</button><button className="button button-danger button-sm" onClick={() => void permanentlyDelete(chat)} disabled={busyId === chat.id}><Trash2 size={14} />Eliminar definitivamente</button></div></article>)}</div> : <EmptyState icon={<Trash2 size={23} />} title="La papelera está vacía" description="Al mover un chat desde el historial, podrás restaurarlo desde aquí." />}
  </div>;
}
