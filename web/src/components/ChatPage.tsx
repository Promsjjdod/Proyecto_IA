import { useEffect, useRef, useState, type ChangeEvent, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react';
import { Activity, ArrowDown, ArrowUp, AudioLines, Check, ChevronDown, CircleStop, Clipboard, Code2, Download, Eye, FilePlus2, ImagePlus, Mic, Paperclip, Pencil, Plus, RotateCcw, Sparkles, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import type { Agent, Attachment, Chat, Message, Model, Mode, Project, Provider, User } from '../types';
import { api, streamChat, uploadFile } from '../api';
import { EmptyState, ErrorBanner, ProviderIcon } from './common';
import { Markdown } from './Markdown';

const suggestions = [
  { title: 'Piensa conmigo', prompt: 'Ayúdame a ordenar una idea y convertirla en un plan concreto.' },
  { title: 'Construye algo', prompt: 'Crea un ejemplo completo y bien estructurado de una landing page moderna.' },
  { title: 'Analiza un tema', prompt: 'Explícame un tema complejo de forma clara, con ejemplos y una síntesis final.' },
  { title: 'Revisa mi código', prompt: 'Revisa este código, identifica riesgos y sugiere mejoras verificables.' },
];
type Artifact = { path: string; bytes?: number; validationStatus?: string; validationMessage?: string };
function ArtifactCards({ projectId, artifacts, onOpenProjectFile }: { projectId: string; artifacts: Artifact[]; onOpenProjectFile: (projectId: string, path: string) => void }) {
  const safeArtifacts = artifacts.filter((item) => typeof item?.path === 'string' && item.path.length > 0);
  if (!projectId || !safeArtifacts.length) return null;
  return <section className="artifact-result-card"><div className="artifact-result-heading"><Code2 size={15} /><b>Archivos guardados en el proyecto</b><span>{safeArtifacts.length}</span></div>
    {safeArtifacts.map((artifact) => {
      const fileUrl = `/api/projects/${encodeURIComponent(projectId)}/download-file?path=${encodeURIComponent(artifact.path)}`;
      const previewUrl = `/api/projects/${encodeURIComponent(projectId)}/preview/${artifact.path.split('/').map(encodeURIComponent).join('/')}`;
      const extension = artifact.path.slice(artifact.path.lastIndexOf('.')).toLowerCase();
      const canPreview = ['.html', '.htm'].includes(extension);
      return <article className="artifact-result-item" key={artifact.path}><div className="artifact-result-info"><b title={artifact.path}>{artifact.path}</b><small>{artifact.validationMessage || 'Guardado en el espacio de trabajo.'}{typeof artifact.bytes === 'number' ? ` · ${artifact.bytes.toLocaleString()} bytes` : ''}</small></div><div className="artifact-result-actions"><button className="button button-secondary button-sm" onClick={() => onOpenProjectFile(projectId, artifact.path)}>Abrir editor</button><a className="button button-quiet button-sm" href={fileUrl} download><Download size={13} />Descargar</a></div>{canPreview && <details className="artifact-preview"><summary><Eye size={13} />Vista previa aislada</summary><iframe src={previewUrl} title={`Vista previa aislada de ${artifact.path}`} sandbox="allow-scripts" referrerPolicy="no-referrer" loading="lazy" /></details>}</article>;
    })}
  </section>;
}

export function ChatPage({ user, chats, chatId, onChatChange, messages, onMessagesChange, onRefreshChats, onRefreshUsage, providers, modelsByProvider, providerId, modelId, mode, agents, selectedAgentId, onAgentChange, activeProjectId, projects, onGoProviders, onModeChange, pendingAttachments, onPendingAttachmentsConsumed, onOpenProjectFile }: {
  user: User; chats: Chat[]; chatId: string | null; onChatChange: (id: string | null) => void; messages: Message[]; onMessagesChange: Dispatch<SetStateAction<Message[]>>; onRefreshChats: () => void; onRefreshUsage: () => void;
  providers: Provider[]; modelsByProvider: Record<string, Model[]>; providerId: string; modelId: string; mode: Mode; agents: Agent[]; selectedAgentId: string; onAgentChange: (id: string) => void;
  activeProjectId: string | null; projects: Project[]; onGoProviders: () => void; onModeChange: (mode: Mode) => void;
  pendingAttachments: (Attachment & { preview?: string })[]; onPendingAttachmentsConsumed: () => void; onOpenProjectFile: (projectId: string, path: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<(Attachment & { preview?: string })[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState('');
  const [chatError, setChatError] = useState('');
  const [speechError, setSpeechError] = useState('');
  const [listening, setListening] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const [edited, setEdited] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const activeController = useRef<AbortController | null>(null);
  const recognition = useRef<any>(null);
  const recognitionBaseDraft = useRef('');
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const effectiveProviderId = selectedAgent?.providerId || providerId;
  const effectiveModelId = selectedAgent?.modelId || modelId;
  const selectedProvider = providers.find((provider) => provider.id === effectiveProviderId);
  const selectedModel = (modelsByProvider[effectiveProviderId] || []).find((model) => model.id === effectiveModelId);
  const effectiveMode = selectedAgent?.mode || mode;
  const currentChat = chats.find((chat) => chat.id === chatId);
  const currentProject = projects.find((project) => project.id === activeProjectId);
  const modeTitle: Record<Mode, string> = { LOW: 'Respuestas ágiles y breves', MEDIO: 'Equilibrio de calidad y velocidad', ALTO: 'Más profundidad y detalle', EXTRA: 'Presupuesto ampliado para tareas complejas', MAX: 'Mejor configuración disponible para esta cuenta' };

  useEffect(() => { setAttachments([]); setDraft(''); setChatError(''); setConnectionError(''); }, [chatId]);
  useEffect(() => {
    if (!pendingAttachments.length) return;
    const incoming = pendingAttachments.filter((item) => !attachments.some((current) => current.id === item.id));
    if (attachments.length + incoming.length > 5) setChatError('Un mensaje admite hasta 5 adjuntos. Quita o envía alguno antes de añadir esta imagen.');
    else {
      setAttachments((current) => {
        const fresh = pendingAttachments.filter((item) => !current.some((existing) => existing.id === item.id));
        return [...current, ...fresh.map((item) => ({ ...item, preview: item.preview || (item.source === 'image-library' ? item.fileUrl : undefined) }))];
      });
      setDraft((current) => current || 'Analiza esta imagen y explica sus elementos principales.');
    }
    onPendingAttachmentsConsumed();
  }, [pendingAttachments, onPendingAttachmentsConsumed]);
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [messages, busyText]);
  useEffect(() => { if (edited) { inputRef.current?.focus(); setEdited(false); } }, [edited]);

  const resizeInput = () => {
    const element = inputRef.current; if (!element) return;
    element.style.height = 'auto'; element.style.height = `${Math.min(element.scrollHeight, 240)}px`;
  };
  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (attachments.length + files.length > 5) { setChatError('Se permiten hasta 5 adjuntos por mensaje.'); return; }
    setUploading(true); setChatError('');
    try {
      const uploaded: (Attachment & { preview?: string })[] = [];
      for (const file of files) {
        const result = await uploadFile(file);
        uploaded.push({ ...result, source: 'upload', preview: result.isImage ? URL.createObjectURL(file) : undefined });
      }
      setAttachments((current) => [...current, ...uploaded]);
    } catch (error) { setChatError(error instanceof Error ? error.message : 'No se pudo adjuntar el archivo.'); }
    finally { setUploading(false); }
  };
  const removeAttachment = (id: string) => {
    const item = attachments.find((file) => file.id === id);
    if (item?.preview?.startsWith('blob:')) URL.revokeObjectURL(item.preview);
    setAttachments((current) => current.filter((file) => file.id !== id));
    if (item?.source !== 'image-library') void api(`/uploads/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined);
  };

  const send = async (value = draft, options: { existingMessageId?: string; continueFromMessageId?: string } = {}) => {
    const text = value.trim();
    if ((!text && !attachments.length && !options.existingMessageId && !options.continueFromMessageId) || busy || uploading) return;
    if (!providerId || !modelId) { setChatError('Conecta y selecciona un modelo para empezar.'); return; }
    if (attachments.some((item) => item.isImage) && selectedModel?.capabilities?.vision !== true) {
      setChatError('Este modelo no tiene capacidad de imagen verificada/configurada. Puedes continuar con archivos de texto o configurarla desde Proveedores.');
      return;
    }
    const prompt = options.continueFromMessageId ? 'Continuar la respuesta anterior.' : text || `Analiza el archivo adjunto${attachments.length > 1 ? 's' : ''} y resume lo más importante.`;
    if (effectiveMode === 'MAX' && !window.confirm('MAX reserva hasta 6 000 unidades internas para la salida y puede usar más recursos externos. Los proveedores pueden aplicar cargos propios. ¿Continuar?')) return;
    let confirmWorkflowRuns = false;
    if (selectedAgent?.tools.includes('run_workflows')) {
      if (!window.confirm('Este agente podrá listar y ejecutar una automatización durante esta solicitud. El flujo puede llamar proveedores externos, consumir cuotas o escribir archivos dentro del proyecto autorizado. Se permitirá como máximo una ejecución. ¿Autorizar?')) return;
      confirmWorkflowRuns = true;
    }
    let activeId = chatId;
    try {
      if (!activeId) {
        const created = await api<Chat>('/chats', { method: 'POST', body: JSON.stringify({ title: 'Nuevo chat', projectId: activeProjectId }) });
        activeId = created.id; onChatChange(activeId);
      }
      const attachmentSnapshot = options.existingMessageId ? [] : attachments.map(({ id, name, mimeType, size, isImage, source, fileUrl }) => ({ id, name, mimeType, size, isImage, source, fileUrl }));
      const requestId = crypto.randomUUID();
      const userMessage: Message | null = options.existingMessageId ? null : { id: `local-user-${requestId}`, role: 'user', content: prompt, createdAt: new Date().toISOString(), attachments: attachmentSnapshot, ...(options.continueFromMessageId ? { meta: { kind: 'continuation', continuationOf: options.continueFromMessageId } } : {}) };
      const assistantMessage: Message = { id: `local-assistant-${requestId}`, role: 'assistant', content: '', createdAt: new Date().toISOString(), meta: { pending: true } };
      onMessagesChange([...messages.filter((message) => !message.id.startsWith('local-')), ...(userMessage ? [userMessage] : []), assistantMessage]);
      setDraft('');
      setBusy(true); setChatError(''); setConnectionError(''); setBusyText('Preparando la solicitud…');
      const controller = new AbortController(); activeController.current = controller;
      let streamError = '';
      const completion = await streamChat(activeId, {
        content: options.existingMessageId || options.continueFromMessageId ? '' : prompt,
        existingMessageId: options.existingMessageId,
        continueFromMessageId: options.continueFromMessageId,
        attachmentIds: options.existingMessageId ? undefined : options.continueFromMessageId ? [] : attachmentSnapshot.filter((file) => file.source !== 'image-library').map((file) => file.id),
        imageIds: options.existingMessageId ? undefined : options.continueFromMessageId ? [] : attachmentSnapshot.filter((file) => file.source === 'image-library').map((file) => file.id),
        providerId: effectiveProviderId, modelId: effectiveModelId, mode: effectiveMode, projectId: activeProjectId, agentId: selectedAgentId || undefined,
        requestId, confirmWorkflowRuns,
      }, controller.signal, {
        onDelta: (delta) => onMessagesChange((current) => current.map((message) => message.id === assistantMessage.id ? { ...message, content: message.content + delta } : message)),
        onStatus: (status) => setBusyText(status.message || 'Generando respuesta…'),
        onTool: (tool) => setBusyText(`${tool.name}: ${tool.ok ? (tool.staged ? 'preparado, aún no guardado' : 'completado') : 'requiere atención'}`),
        onFinish: (finish) => setBusyText(finish.status === 'complete' ? 'El proveedor confirmó el final.' : finish.status === 'incomplete' ? 'El proveedor detuvo la generación por su límite.' : 'El proveedor no confirmó el estado final.'),
        onError: (error) => { streamError = error; setConnectionError(error); },
      });
      if (completion.completionStatus === 'incomplete') setConnectionError('La respuesta alcanzó un límite antes de confirmarse completa. El fragmento quedó guardado; puedes continuarla o regenerarla.');
      else if (completion.completionStatus === 'unverified') setConnectionError('El proveedor cerró la conexión sin confirmar que la respuesta terminara. Revisa el fragmento antes de continuar.');
      if (streamError) setConnectionError(streamError);
      const latestMessages = await api<Message[]>(`/chats/${encodeURIComponent(activeId)}/messages`).catch(() => null);
      if (latestMessages) onMessagesChange(latestMessages);
      else if (streamError) onMessagesChange((current) => current.map((message) => message.id === assistantMessage.id ? { ...message, meta: { failed: true, error: streamError } } : message));
      if (!options.existingMessageId) {
        attachments.forEach((item) => item.preview?.startsWith('blob:') && URL.revokeObjectURL(item.preview));
        setAttachments([]);
      }
      onRefreshChats(); onRefreshUsage();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        const message = error instanceof Error ? error.message : 'No se pudo completar la solicitud.';
        setChatError(message);
        if (activeId) {
          const latestMessages = await api<Message[]>(`/chats/${encodeURIComponent(activeId)}/messages`).catch(() => null);
          if (latestMessages) onMessagesChange(latestMessages);
        }
      } else if (activeId) {
        const latestMessages = await api<Message[]>(`/chats/${encodeURIComponent(activeId)}/messages`).catch(() => null);
        if (latestMessages) onMessagesChange(latestMessages);
      }
      onRefreshChats(); onRefreshUsage();
    } finally { setBusy(false); setBusyText(''); activeController.current = null; }
  };
  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
  };
  const stop = () => activeController.current?.abort();
  const startRecognition = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { setSpeechError('El navegador no ofrece reconocimiento de voz. Puedes dictar con el teclado del sistema.'); return; }
    setSpeechError('');
    recognitionBaseDraft.current = draft.trimEnd();
    const recog = new SpeechRecognition(); recognition.current = recog;
    recog.lang = user.preferences?.voiceLanguage || 'es-ES'; recog.interimResults = true; recog.continuous = false;
    recog.onresult = (event: any) => {
      let finalText = ''; let interim = '';
      for (let i = 0; i < event.results.length; i += 1) { const item = event.results[i]; if (item.isFinal) finalText += item[0].transcript; else interim += item[0].transcript; }
      const recognized = `${finalText}${interim}`;
      setDraft(`${recognitionBaseDraft.current}${recognitionBaseDraft.current && recognized ? ' ' : ''}${recognized}`);
      resizeInput();
    };
    recog.onerror = (event: any) => setSpeechError(event.error === 'not-allowed' ? 'Permite el micrófono en el navegador para usar el dictado.' : `Dictado: ${event.error || 'error del navegador'}.`);
    recog.onend = () => setListening(false);
    try { recog.start(); setListening(true); } catch { setSpeechError('No se pudo iniciar el micrófono.'); }
  };
  const stopRecognition = () => { recognition.current?.stop(); setListening(false); };
  const speak = (message: Message) => {
    if (!('speechSynthesis' in window)) { setSpeechError('Tu navegador no ofrece síntesis de voz.'); return; }
    if (speakingId === message.id) { window.speechSynthesis.cancel(); setSpeakingId(null); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message.content.slice(0, 8_000));
    utterance.lang = user.preferences?.voiceLanguage || 'es-ES';
    utterance.onend = () => setSpeakingId(null); utterance.onerror = () => setSpeakingId(null);
    window.speechSynthesis.speak(utterance); setSpeakingId(message.id);
  };
  const editUserMessage = async (message: Message) => {
    const next = window.prompt('Edita tu mensaje. Al guardar se eliminarán las respuestas posteriores y se volverá a generar.', message.content);
    if (next === null || !next.trim()) return;
    if (!chatId) return;
    try {
      await api(`/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(message.id)}`, { method: 'PATCH', body: JSON.stringify({ content: next.trim() }) });
      const updated = await api<Message[]>(`/chats/${encodeURIComponent(chatId)}/messages`); onMessagesChange(updated);
      await send('', { existingMessageId: message.id });
    } catch (error) { setChatError(error instanceof Error ? error.message : 'No se pudo editar el mensaje.'); }
  };
  const regenerate = async (message: Message, index: number) => {
    const previous = [...messages.slice(0, index)].reverse().find((item) => item.role === 'user');
    if (!previous) return;
    const trimmed = messages.slice(0, index + 1);
    onMessagesChange(trimmed);
    await send('', { existingMessageId: previous.id });
  };
  const renameChat = async () => {
    if (!chatId || !currentChat) return;
    const name = window.prompt('Nombre de la conversación', currentChat.title);
    if (!name?.trim()) return;
    try { await api(`/chats/${encodeURIComponent(chatId)}`, { method: 'PATCH', body: JSON.stringify({ title: name.trim() }) }); onRefreshChats(); }
    catch (error) { setChatError(error instanceof Error ? error.message : 'No se pudo renombrar.'); }
  };
  const deleteChat = async () => {
    if (!chatId || !window.confirm('¿Mover esta conversación a la papelera? Podrás restaurarla más tarde.')) return;
    try { await api(`/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' }); onChatChange(null); onMessagesChange([]); onRefreshChats(); }
    catch (error) { setChatError(error instanceof Error ? error.message : 'No se pudo eliminar.'); }
  };

  return <div className={`chat-page ${messages.length ? 'chat-has-messages' : ''}`}>
    {chatId && <div className="chat-toolbar"><div className="chat-toolbar-meta"><div className="chat-context-pill"><span className="context-dot" />{currentProject?.name || 'Espacio personal'}</div>{currentChat && <span className="chat-toolbar-title">{currentChat.title}</span>}{selectedAgent && <span className="agent-active-tag"><Sparkles size={12} />{selectedAgent.name}</span>}</div><div className="chat-toolbar-actions"><button className="icon-button" title="Renombrar conversación" onClick={() => void renameChat()}><Pencil size={15} /></button><button className="icon-button danger-icon" title="Mover a la papelera" onClick={() => void deleteChat()}><Trash2 size={15} /></button></div></div>}
    {chatError && <div className="chat-alert"><ErrorBanner message={chatError} onDismiss={() => setChatError('')} /></div>}
    {connectionError && !chatError && <div className="chat-alert"><ErrorBanner message={connectionError} onDismiss={() => setConnectionError('')} /></div>}
    {messages.length === 0 ? <div className="chat-empty-layout">
      <div className="chat-empty-hero"><div className="hero-symbol"><div className="hero-orbit hero-orbit-one" /><div className="hero-orbit hero-orbit-two" /><Sparkles size={32} /></div><div className="hero-kicker"><span /> MODELOS LISTOS PARA COLABORAR</div><h1>¿Qué te gustaría<br /><em>crear hoy?</em></h1><p>Pregunta, explora o construye. Tú eliges el modelo; Nexus conecta el resto.</p>{currentProject && <div className="active-project-context"><b>Proyecto activo: {currentProject.name}</b><small>El proyecto se asociará al chat. Para que el modelo lea archivos, elige un agente con permiso de lectura.</small></div>}{!providers.length && <button className="button button-primary" onClick={onGoProviders}>Conecta tu primer proveedor <ArrowUp size={15} /></button>}
      </div>
      <div className="suggestion-grid">{suggestions.map((item, index) => <button key={item.title} className="suggestion-card" onClick={() => { setDraft(item.prompt); inputRef.current?.focus(); }}><span className={`suggestion-number suggestion-number-${index}`}>0{index + 1}</span><b>{item.title}</b><small>{item.prompt}</small><ArrowUp size={14} className="suggestion-arrow" /></button>)}</div>
      {providers.length > 0 && <div className="provider-strip"><span>CONÉCTATE CON</span>{providers.slice(0, 4).map((provider) => <span key={provider.id} className="provider-strip-item"><ProviderIcon type={provider.type} size={14} />{provider.name}</span>)}</div>}
    </div> : <div className="message-list" ref={listRef}>
      {messages.map((message, index) => <article key={message.id} className={`message-row message-${message.role}`}>
        <div className={`message-avatar ${message.role === 'assistant' ? 'assistant-avatar' : 'user-avatar'}`}>{message.role === 'assistant' ? <Sparkles size={15} /> : user.name.slice(0, 1).toUpperCase()}</div>
        <div className="message-content-wrap"><div className="message-meta"><b>{message.role === 'assistant' ? 'Nexus' : 'Tú'}</b>{message.role === 'assistant' && message.modelId && <span className="message-model"><ProviderIcon type={providers.find((provider) => provider.id === message.providerId)?.type} size={12} />{message.modelId}</span>}{message.mode && <span className="message-mode">{message.mode}</span>}{message.meta?.responseTimeMs && <span className="message-time"><Activity size={11} />{(message.meta.responseTimeMs / 1000).toFixed(1)} s</span>}</div>
          {message.attachments?.length ? <div className="message-attachments">{message.attachments.map((file) => file.isImage ? <a href={file.fileUrl || `/api/uploads/${encodeURIComponent(file.id)}`} target="_blank" rel="noreferrer" key={file.id}><img src={file.fileUrl || `/api/uploads/${encodeURIComponent(file.id)}`} alt={file.name} /></a> : <span key={file.id} className="message-file"><FilePlus2 size={13} />{file.name}</span>)}</div> : null}
          {message.role === 'user' ? message.meta?.kind === 'continuation' ? <div className="user-message-text continuation-request"><small>CONTINUACIÓN SOLICITADA</small>{message.content}</div> : <div className="user-message-text">{message.content}</div> : message.meta?.pending ? <div className="streaming-cursor-wrap"><Markdown content={message.content} />{!message.content && <div className="thinking-indicator"><span /><span /><span /></div>}</div> : <>
            {message.content ? <Markdown content={message.content} /> : <p className="muted-message">No se recibió una respuesta. Puedes reintentar.</p>}
            {message.meta?.status && message.meta.status !== 'complete' && <div className="failed-note">{message.meta.status === 'incomplete' ? `El proveedor informó un límite de salida (${message.meta.finishReason || 'sin motivo'}). El fragmento quedó guardado.` : message.meta.status === 'unverified' ? 'La conexión terminó sin una confirmación de finalización. Revisa el fragmento antes de continuar.' : message.meta.status === 'cancelled' ? 'La generación se interrumpió. El fragmento parcial quedó guardado.' : `La generación no terminó: ${message.meta.error || 'error del proveedor'}.`}</div>}
          </>}
          {message.role === 'assistant' && !message.meta?.pending && Array.isArray(message.meta?.artifacts) && <ArtifactCards projectId={String(message.meta.projectId || '')} artifacts={message.meta.artifacts as Artifact[]} onOpenProjectFile={onOpenProjectFile} />}
          {message.role === 'assistant' && !message.meta?.pending && <div className="message-actions"><button onClick={() => void navigator.clipboard?.writeText(message.content)}><Clipboard size={13} />Copiar</button><button onClick={() => void regenerate(message, index)} disabled={busy}><RotateCcw size={13} />Regenerar</button>{message.content && ['incomplete', 'cancelled', 'unverified', 'failed'].includes(message.meta?.status) && <button onClick={() => void send('', { continueFromMessageId: message.id })} disabled={busy}><RotateCcw size={13} />Continuar como mensaje nuevo</button>}<button onClick={() => speak(message)}>{speakingId === message.id ? <VolumeX size={13} /> : <Volume2 size={13} />}{speakingId === message.id ? 'Detener voz' : 'Leer'}</button></div>}
          {message.role === 'user' && <div className="message-actions"><button onClick={() => void editUserMessage(message)} disabled={busy}><Pencil size={13} />Editar y regenerar</button></div>}
        </div>
      </article>)}
      {busy && <div className="stream-state"><span className="stream-bars"><i /><i /><i /></span><span>{busyText || 'Generando respuesta…'}</span>{selectedProvider && <span className="stream-provider"><ProviderIcon type={selectedProvider.type} size={12} />{selectedModel?.displayName || modelId}</span>}</div>}
      <div className="message-scroll-end" />
    </div>}
    <div className="composer-area">
      {speechError && <div className="speech-note" role="status">{speechError}<button className="icon-button" onClick={() => setSpeechError('')}><X size={13} /></button></div>}
      {attachments.length > 0 && <div className="composer-attachments">{attachments.map((file) => <div className="attachment-chip" key={file.id}>{file.preview ? <img src={file.preview} alt="" /> : <FilePlus2 size={14} />}<span>{file.name}</span><button onClick={() => removeAttachment(file.id)} title="Quitar archivo"><X size={13} /></button></div>)}</div>}
      <div className={`composer-box ${busy ? 'composer-busy' : ''}`}>
        <div className="composer-main"><textarea ref={inputRef} value={draft} onChange={(event) => { setDraft(event.target.value); resizeInput(); }} onKeyDown={onComposerKeyDown} placeholder={selectedAgent ? `Habla con ${selectedAgent.name}…` : 'Escribe tu mensaje…'} rows={1} maxLength={64_000} aria-label="Escribe tu mensaje" />
          <div className="composer-actions"><div className="composer-left-actions"><input ref={fileRef} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif,text/plain,text/markdown,text/csv,application/json,text/javascript,text/css,application/xml" onChange={handleFiles} />
            <button className="composer-icon-button" onClick={() => fileRef.current?.click()} disabled={busy || uploading} title="Adjuntar imagen o archivo de texto"><Plus size={17} /></button>
            <button className={`composer-icon-button ${listening ? 'active-mic' : ''}`} onClick={listening ? stopRecognition : startRecognition} title={listening ? 'Detener dictado' : 'Dictar texto (el navegador puede procesar audio externamente)'} disabled={busy}>{listening ? <AudioLines size={17} /> : <Mic size={16} />}</button>
            <span className="composer-separator" />
            <label className="agent-picker"><Sparkles size={13} /><select value={selectedAgentId} onChange={(event) => onAgentChange(event.target.value)} aria-label="Elegir agente"><option value="">Chat normal</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><ChevronDown size={12} /></label>
            <label className="composer-mode-mobile"><select value={mode} onChange={(event) => onModeChange(event.target.value as Mode)} aria-label="Modo de respuesta"><option value="LOW">LOW</option><option value="MEDIO">MEDIO</option><option value="ALTO">ALTO</option><option value="EXTRA">EXTRA</option><option value="MAX">MAX</option></select></label>
          </div>
          {busy ? <button className="send-button stop-button" onClick={stop} title="Detener respuesta"><CircleStop size={17} /></button> : <button className="send-button" onClick={() => void send()} disabled={(!draft.trim() && attachments.length === 0) || uploading} title="Enviar mensaje"><ArrowUp size={17} /></button>}
        </div></div>
      </div>
      <div className="composer-footnote"><span><Activity size={12} />{selectedProvider ? `${selectedProvider.name} · ${selectedModel?.displayName || modelId}` : 'Conecta un modelo para empezar'}</span><span className="composer-footnote-center">{effectiveMode} · {modeTitle[effectiveMode]}</span><span>Enter para enviar · Shift + Enter para nueva línea</span></div>
      {listening && <div className="external-audio-disclaimer"><span className="recording-dot" />Dictado activo: la transcripción se añade al borrador; no se envía hasta que pulses enviar.</div>}
    </div>
  </div>;
}
