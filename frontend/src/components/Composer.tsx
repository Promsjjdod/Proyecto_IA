import React, { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { useApp } from '../store/app';
import { useChats } from '../store/chats';

export interface ComposerProps {
  chatId?: string;
  model?: string;
  providerId?: string;
  agentId?: string | null;
  onModelChange?: (model: string, providerId: string) => void;
  onAgentChange?: (agentId: string | null) => void;
  placeholder?: string;
}

export function Composer({ chatId, model, providerId, agentId, onModelChange, onAgentChange, placeholder }: ComposerProps) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [attachments, setAttachments] = useState<{ fileId: string; name: string; mime: string; size: number }[]>([]);
  const [showTools, setShowTools] = useState(false);
  const [tools, setTools] = useState<any[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { stream, send, stop, current } = useChats();
  const toast = useApp((s) => s.toast);

  useEffect(() => {
    api.get('/models').then(({ providers }) => setProviders(providers)).catch(() => setProviders([]));
    api.get('/agents').then(({ agents }) => setAgents(agents.filter((a: any) => a.enabled))).catch(() => setAgents([]));
    api.get('/tools').then(({ tools }) => setTools(tools)).catch(() => setTools([]));
  }, []);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`;
  }, [text]);

  const activeProvider = providers.find((p) => p.provider.id === (providerId || current?.providerId || providers.find((x) => x.provider.isDefault)?.provider.id));
  const models: any[] = activeProvider?.models || [];

  const submit = async () => {
    const content = text.trim();
    if (!content && !attachments.length) return;
    setBusy(true);
    setText('');
    const atts = attachments;
    setAttachments([]);
    try {
      await send(content, { attachments: atts.length ? atts : undefined, model, providerId, agentId });
    } catch (err) {
      toast(errorMessage(err), 'err');
    } finally {
      setBusy(false);
      taRef.current?.focus();
    }
  };

  const upload = async (files: FileList | File[]) => {
    const form = new FormData();
    for (const f of Array.from(files).slice(0, 6)) form.append('files', f);
    try {
      const { files: stored } = await api.upload('/files/upload', form);
      setAttachments((a) => [...a, ...stored.map((s: any) => ({ fileId: s.id, name: s.name, mime: s.mime, size: s.size }))]);
      toast(`Attached ${stored.length} file(s)`, 'ok');
    } catch (err) {
      toast(errorMessage(err), 'err');
    }
  };

  return (
    <div
      className="composer"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) upload(e.dataTransfer.files); }}
    >
      {attachments.length ? (
        <div className="row wrap" style={{ marginBottom: 8 }}>
          {attachments.map((a) => (
            <span key={a.fileId} className="badge accent">
              ⌸ {a.name}
              <button className="btn ghost sm" style={{ padding: '0 3px' }} onClick={() => setAttachments((x) => x.filter((y) => y.fileId !== a.fileId))}>✕</button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="composer-box">
        <textarea
          ref={taRef}
          rows={1}
          placeholder={placeholder || 'Message ForgeAI…  (Enter to send, Shift+Enter for a new line, drop files anywhere)'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
        />
        <div className="composer-bar">
          <button className="btn ghost icon" title="Attach files" onClick={() => fileRef.current?.click()}>📎</button>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />

          <select
            className="input"
            style={{ width: 'auto', maxWidth: 210, padding: '4px 8px', fontSize: 12.5 }}
            title="Provider / model"
            value={`${providerId || activeProvider?.provider.id || ''}::${model || current?.model || ''}`}
            onChange={(e) => {
              const [pid, mid] = e.target.value.split('::');
              onModelChange?.(mid, pid);
            }}
          >
            {providers.map((p) => (
              <optgroup key={p.provider.id} label={`${p.provider.icon} ${p.provider.name}${p.reachable ? '' : ' (offline)'}`}>
                {(p.models || []).map((m: any) => (
                  <option key={`${p.provider.id}::${m.id}`} value={`${p.provider.id}::${m.id}`}>
                    {m.name}{m.status === 'demo' ? ' (demo)' : m.size ? ` · ${m.size}` : ''}
                  </option>
                ))}
                {!(p.models || []).length && <option value={`${p.provider.id}::`}>{p.provider.name} — no models reachable</option>}
              </optgroup>
            ))}
            {!providers.length && <option value="">No providers</option>}
          </select>

          <select
            className="input"
            style={{ width: 'auto', maxWidth: 170, padding: '4px 8px', fontSize: 12.5 }}
            title="Agent"
            value={agentId ?? current?.agentId ?? ''}
            onChange={(e) => onAgentChange?.(e.target.value || null)}
          >
            <option value="">No agent</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.avatar} {a.name}</option>)}
          </select>

          <button className="btn ghost icon" title="Available tools" onClick={() => setShowTools((v) => !v)}>🧰</button>

          <div className="grow" />
          {stream.active ? (
            <button className="btn danger sm" onClick={stop}>■ Stop</button>
          ) : (
            <button className="btn primary sm" onClick={submit} disabled={busy || (!text.trim() && !attachments.length)}>
              Send ↵
            </button>
          )}
        </div>
      </div>

      {showTools && (
        <div className="card" style={{ marginTop: 8, maxHeight: 210, overflow: 'auto' }}>
          <div className="hint" style={{ marginBottom: 8 }}>Tools available in this installation (agents choose which to use; dangerous tools always ask for confirmation):</div>
          {tools.map((t) => (
            <div key={t.name} className="row" style={{ padding: '3px 0', fontSize: 12.8 }}>
              <code className="inline">{t.name}</code>
              <span className="dim grow" style={{ fontSize: 12 }}>{t.description.slice(0, 110)}</span>
              {t.dangerous ? <span className="badge warn">confirm</span> : null}
              {t.permissions?.map((p: string) => <span key={p} className="badge">{p}</span>)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
