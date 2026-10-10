import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { ArrowUp, Check, Clipboard, GitCompareArrows, Paperclip, Plus, RotateCcw, ShieldCheck, Sparkles, Square, X } from 'lucide-react';
import type { Attachment, Message, Model, Provider, User } from '../types';
import { api, streamChat, uploadFile } from '../api';
import { ErrorBanner, ProviderIcon } from './common';
import { Markdown } from './Markdown';

function key(providerId: string, modelId: string) { return `${providerId}::${modelId}`; }
function splitModel(value: string) { const [providerId, ...rest] = value.split('::'); return { providerId, modelId: rest.join('::') }; }

export function ComparePage({ user, providers, modelsByProvider, activeProjectId, onContinue, onRefreshUsage }: { user: User; providers: Provider[]; modelsByProvider: Record<string, Model[]>; activeProjectId: string | null; onContinue: (chatId: string, providerId: string, modelId: string) => void; onRefreshUsage: () => void }) {
  const modelEntries = useMemo(() => providers.flatMap((provider) => (modelsByProvider[provider.id] || []).filter((model) => model.status !== 'unavailable').map((model) => ({ provider, model, value: key(provider.id, model.id) }))), [providers, modelsByProvider]);
  const [modelA, setModelA] = useState(modelEntries[0]?.value || '');
  const [modelB, setModelB] = useState(modelEntries[1]?.value || '');
  const storageKey = `nexus-compare-${user.id}`;
  const [chatIds, setChatIds] = useState<{ a: string | null; b: string | null }>(() => { try { return JSON.parse(localStorage.getItem(storageKey) || '{"a":null,"b":null}'); } catch { return { a: null, b: null }; } });
  const [messagesA, setMessagesA] = useState<Message[]>([]);
  const [messagesB, setMessagesB] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busyA, setBusyA] = useState(false);
  const [busyB, setBusyB] = useState(false);
  const [statusA, setStatusA] = useState('');
  const [statusB, setStatusB] = useState('');
  const [errorA, setErrorA] = useState('');
  const [errorB, setErrorB] = useState('');
  const [globalError, setGlobalError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [rating, setRating] = useState<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const controllers = useRef<{ a: AbortController | null; b: AbortController | null }>({ a: null, b: null });
  const activeA = modelEntries.find((entry) => entry.value === modelA);
  const activeB = modelEntries.find((entry) => entry.value === modelB);
  useEffect(() => { if (!modelA && modelEntries[0]) setModelA(modelEntries[0].value); if (!modelB && modelEntries[1]) setModelB(modelEntries[1].value); }, [modelEntries, modelA, modelB]);
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(chatIds)); }, [chatIds, storageKey]);
  useEffect(() => { if (chatIds.a) void api<Message[]>(`/chats/${encodeURIComponent(chatIds.a)}/messages`).then(setMessagesA).catch(() => setMessagesA([])); else setMessagesA([]); }, [chatIds.a]);
  useEffect(() => { if (chatIds.b) void api<Message[]>(`/chats/${encodeURIComponent(chatIds.b)}/messages`).then(setMessagesB).catch(() => setMessagesB([])); else setMessagesB([]); }, [chatIds.b]);
  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(event.target.files || []); event.target.value = '';
    if (attachments.length + list.length > 5) { setGlobalError('Se permiten hasta 5 adjuntos.'); return; }
    setUploading(true); setGlobalError('');
    try { const items: Attachment[] = []; for (const file of list) items.push(await uploadFile(file)); setAttachments((current) => [...current, ...items]); }
    catch (error) { setGlobalError(error instanceof Error ? error.message : 'No se pudo adjuntar.'); }
    finally { setUploading(false); }
  };
  const removeAttachment = (id: string) => { setAttachments((current) => current.filter((item) => item.id !== id)); void api(`/uploads/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined); };
  const ensureChat = async (side: 'a' | 'b', selected: { provider: Provider; model: Model }) => {
    const existing = chatIds[side]; if (existing) return existing;
    const created = await api<{ id: string }>('/chats', { method: 'POST', body: JSON.stringify({ title: `Comparación ${side.toUpperCase()} · ${selected.model.displayName}`, projectId: activeProjectId }) });
    setChatIds((current) => ({ ...current, [side]: created.id })); return created.id;
  };
  const sendSide = async (side: 'a' | 'b', text: string, id: string, selected: { provider: Provider; model: Model }, attachmentsSnapshot: Attachment[]) => {
    const setMessages = side === 'a' ? setMessagesA : setMessagesB;
    const setBusy = side === 'a' ? setBusyA : setBusyB;
    const setStatus = side === 'a' ? setStatusA : setStatusB;
    const setError = side === 'a' ? setErrorA : setErrorB;
    const localId = crypto.randomUUID();
    const userMessage: Message = { id: `local-user-${localId}`, role: 'user', content: text, createdAt: new Date().toISOString(), attachments: attachmentsSnapshot };
    const assistantMessage: Message = { id: `local-assistant-${localId}`, role: 'assistant', content: '', createdAt: new Date().toISOString(), meta: { pending: true } };
    setMessages((current) => [...current.filter((message) => !message.id.startsWith('local-')), userMessage, assistantMessage]);
    setBusy(true); setStatus('Conectando…'); setError('');
    const controller = new AbortController(); controllers.current[side] = controller;
    try {
      let errorText = '';
      await streamChat(id, { content: text, providerId: selected.provider.id, modelId: selected.model.id, mode: 'MEDIO', projectId: activeProjectId, attachmentIds: attachmentsSnapshot.map((item) => item.id), requestId: crypto.randomUUID() }, controller.signal, {
        onDelta: (delta) => setMessages((current) => current.map((message) => message.id === assistantMessage.id ? { ...message, content: message.content + delta } : message)),
        onStatus: (event) => setStatus(event.message || 'Generando…'),
        onTool: (event) => setStatus(`${event.name}: ${event.ok ? 'completado' : 'error'}`),
        onError: (message) => { errorText = message; setError(message); },
      });
      const history = await api<Message[]>(`/chats/${encodeURIComponent(id)}/messages`).catch(() => null);
      if (history) setMessages(history);
      else if (errorText) setMessages((current) => current.map((message) => message.id === assistantMessage.id ? { ...message, meta: { failed: true, error: errorText } } : message));
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setError(error instanceof Error ? error.message : 'Esta respuesta falló.');
      const history = await api<Message[]>(`/chats/${encodeURIComponent(id)}/messages`).catch(() => null); if (history) setMessages(history);
    } finally { setBusy(false); setStatus(''); controllers.current[side] = null; }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if ((!text && !attachments.length) || busyA || busyB || uploading) return;
    if (!activeA || !activeB) { setGlobalError('Selecciona dos modelos configurados antes de comparar.'); return; }
    if (attachments.some((item) => item.isImage) && (activeA.model.capabilities.vision !== true || activeB.model.capabilities.vision !== true)) { setGlobalError('Ambos modelos deben tener Visión marcada y verificada para adjuntar imágenes.'); return; }
    const prompt = text || 'Analiza el archivo adjunto y resume lo más importante.';
    setGlobalError(''); setDraft('');
    const snapshots = attachments;
    setAttachments([]);
    try {
      const [idA, idB] = await Promise.all([ensureChat('a', activeA), ensureChat('b', activeB)]);
      await Promise.allSettled([sendSide('a', prompt, idA, activeA, snapshots), sendSide('b', prompt, idB, activeB, snapshots)]);
      onRefreshUsage();
    } catch (error) { setGlobalError(error instanceof Error ? error.message : 'No se pudo iniciar la comparación.'); }
  };
  const cancel = (side: 'a' | 'b') => controllers.current[side]?.abort();
  const reset = () => { if (busyA || busyB) return; setChatIds({ a: null, b: null }); setMessagesA([]); setMessagesB([]); setErrorA(''); setErrorB(''); setRating({}); };
  const copy = (text: string) => void navigator.clipboard?.writeText(text);
  const renderPanel = (side: 'a' | 'b') => {
    const selected = side === 'a' ? activeA : activeB;
    const history = side === 'a' ? messagesA : messagesB;
    const isBusy = side === 'a' ? busyA : busyB;
    const status = side === 'a' ? statusA : statusB;
    const error = side === 'a' ? errorA : errorB;
    const chatId = chatIds[side];
    return <section className={`compare-panel compare-panel-${side}`} key={side}><div className="compare-panel-head"><div className="compare-side-label"><span className={`compare-letter compare-letter-${side}`}>{side.toUpperCase()}</span><div><b>Modelo {side.toUpperCase()}</b><small>{selected ? selected.provider.name : 'Selecciona modelo'}</small></div></div><div className="compare-select-wrap">{selected && <ProviderIcon type={selected.provider.type} size={15} />}<select value={side === 'a' ? modelA : modelB} onChange={(event) => side === 'a' ? setModelA(event.target.value) : setModelB(event.target.value)}>{modelEntries.map((entry) => <option value={entry.value} key={entry.value}>{entry.model.displayName} · {entry.provider.name}</option>)}</select></div>{isBusy && <button className="icon-button" title={`Cancelar modelo ${side.toUpperCase()}`} onClick={() => cancel(side)}><Square size={14} /></button>}</div>
      <div className="compare-message-scroll">{history.length ? history.map((message) => <article className={`compare-message compare-${message.role}`} key={message.id}><div className="compare-message-label">{message.role === 'user' ? 'TÚ' : <><Sparkles size={12} /> {selected?.model.displayName || 'MODELO'}</>}</div>{message.attachments?.length && <div className="compare-attachments">{message.attachments.map((file) => <span key={file.id}>{file.name}</span>)}</div>}{message.role === 'user' ? <p>{message.content}</p> : <><Markdown content={message.content} />{message.meta?.failed && <p className="failed-note">{message.meta.error}</p>}{message.content && <div className="compare-actions"><button onClick={() => copy(message.content)}><Clipboard size={12} />Copiar</button><button className={rating[message.id] === 'up' ? 'rated' : ''} onClick={() => setRating({ ...rating, [message.id]: 'up' })}>Útil</button><button className={rating[message.id] === 'down' ? 'rated' : ''} onClick={() => setRating({ ...rating, [message.id]: 'down' })}>No útil</button>{chatId && selected && <button onClick={() => onContinue(chatId, selected.provider.id, selected.model.id)}>Continuar en chat</button>}</div>}</>}</article>) : <div className="compare-empty-panel"><div><GitCompareArrows size={22} /><b>Respuesta {side.toUpperCase()}</b><p>La conversación de este lado conserva su propio contexto.</p></div></div>}</div>
      {isBusy && <div className="compare-status"><span className="stream-bars"><i /><i /><i /></span>{status || 'Generando…'}</div>}{error && <div className="compare-error"><ErrorBanner message={error} onDismiss={() => side === 'a' ? setErrorA('') : setErrorB('')} /></div>}
    </section>;
  };
  return <div className="page-content compare-page"><div className="page-heading-row"><div><div className="eyebrow"><span className="eyebrow-dot" /> RESPUESTAS EN PARALELO</div><h1>Comparar modelos</h1><p>Envía una única pregunta a dos modelos. Cada panel conserva un historial independiente.</p></div><button className="button button-quiet button-sm" onClick={reset} disabled={busyA || busyB}><RotateCcw size={14} />Nueva comparación</button></div>
    {globalError && <ErrorBanner message={globalError} onDismiss={() => setGlobalError('')} />}
    <div className="compare-info-strip"><ShieldCheck size={15} /><span>La misma entrada se envía a los dos proveedores en paralelo. Se aplican sus límites y políticas habituales.</span></div>
    <div className="compare-panels">{renderPanel('a')}{renderPanel('b')}</div>
    <form className="compare-composer" onSubmit={submit}>{attachments.length > 0 && <div className="composer-attachments">{attachments.map((item) => <div className="attachment-chip" key={item.id}><span>{item.name}</span><button type="button" onClick={() => removeAttachment(item.id)}><X size={13} /></button></div>)}</div>}<div className="compare-composer-box"><input ref={fileInput} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif,text/plain,text/markdown,text/csv,application/json,text/javascript,text/css,application/xml" onChange={handleUpload} /><button type="button" className="composer-icon-button" onClick={() => fileInput.current?.click()} title="Adjuntar a los dos modelos"><Plus size={17} /></button><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Escribe una pregunta para ambos modelos…" maxLength={64_000} rows={2} /><button className="send-button" disabled={(!draft.trim() && !attachments.length) || busyA || busyB || uploading} title="Enviar a ambos"><ArrowUp size={17} /></button></div><div className="compare-composer-foot"><span>{activeA?.model.displayName || 'Modelo A'} <b>+</b> {activeB?.model.displayName || 'Modelo B'}</span><span><Paperclip size={12} /> Adjuntos idénticos · contextos separados</span></div></form>
  </div>;
}
