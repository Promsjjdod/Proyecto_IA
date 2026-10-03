import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useChats } from '../store/chats';
import { useApp } from '../store/app';
import { MessageView, ToolChips } from '../components/MessageView';
import { Composer } from '../components/Composer';
import { Markdown } from '../components/Markdown';

const SUGGESTIONS = [
  'Explain this workspace and what ForgeAI can do',
  'Write a TypeScript function that debounces async calls',
  'Plan a migration from REST to GraphQL in 5 steps',
  'Summarize the README of this repository',
];

export function ChatPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { current, messages, stream, openChat, send, patchChat, pendingApproval } = useChats();
  const toast = useApp((s) => s.toast);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [model, setModel] = useState('');
  const [providerId, setProviderId] = useState('');
  const [agentId, setAgentId] = useState<string | null>(null);

  useEffect(() => {
    if (id) openChat(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (current) { setModel(current.model || ''); setProviderId(current.providerId || ''); setAgentId(current.agentId); }
  }, [current?.id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, stream.text, stream.tools.length]);

  const changeModel = async (m: string, p: string) => {
    setModel(m); setProviderId(p);
    if (current) await patchChat(current.id, { model: m, providerId: p } as any);
  };
  const changeAgent = async (a: string | null) => {
    setAgentId(a);
    if (current) await patchChat(current.id, { agentId: a } as any);
  };

  return (
    <>
      <div className="chat-scroll" ref={scrollRef} style={{ padding: '0 18px' }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          {!messages.length && !stream.active && (
            <div style={{ padding: '9vh 8px 20px', textAlign: 'center' }}>
              <img src="/brand/icon-192.png" alt="ForgeAI" width={64} height={64} style={{ borderRadius: 16 }} />
              <h1 style={{ fontSize: 23, margin: '14px 0 4px', letterSpacing: '-.01em' }}>ForgeAI</h1>
              <div className="dim" style={{ marginBottom: 22 }}>Build. Think. Create. — your local AI workspace.</div>
              <div className="grid cols-2" style={{ maxWidth: 640, margin: '0 auto', textAlign: 'left' }}>
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="card" style={{ cursor: 'pointer', textAlign: 'left', fontSize: 13.2, color: 'var(--text-dim)' }}
                    onClick={async () => { await send(s, { model, providerId, agentId }); }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.filter((m) => m.role !== 'tool').map((m) => (
            <MessageView
              key={m.id}
              message={m}
              onEdit={async (content) => { await send(content, { editMessageId: m.id, model, providerId, agentId }); }}
              onRegenerate={async () => { await send('', { regenerate: true, model, providerId, agentId }); }}
            />
          ))}

          {stream.active || stream.text || stream.tools.length ? (
            <div className="msg-row">
              <div className="msg-avatar ai"><img src="/brand/favicon-32.png" alt="" width={18} height={18} style={{ borderRadius: 4 }} /></div>
              <div className="msg-body">
                <div className="msg-meta">
                  <b style={{ color: 'var(--text)' }}>{model || 'ForgeAI'}</b>
                  {stream.usage?.demo ? <span className="badge demo">DEMO</span> : null}
                  {stream.active && !stream.text ? (
                    <span className="row" style={{ gap: 4 }}><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /> thinking</span>
                  ) : null}
                  {stream.active && stream.text ? <span className="faint mono" style={{ fontSize: 11 }}>generating… ~{Math.round(stream.text.length / 4)} tok</span> : null}
                </div>
                <ToolChips tools={stream.tools} />
                {stream.text ? <Markdown text={stream.text} /> : null}
                {stream.error ? (
                  <div className="card" style={{ borderColor: 'var(--err)', padding: 12, marginTop: 8 }}>
                    <div style={{ color: 'var(--err)', fontSize: 13.6, marginBottom: 10 }}>⚠ {stream.error}</div>
                    <div className="row">
                      <button className="btn sm" onClick={() => send('', { regenerate: true, model, providerId, agentId })}>Retry</button>
                      <button className="btn sm" onClick={() => nav('/settings?tab=providers')}>Settings</button>
                      <button className="btn sm" onClick={() => toast('Pick another provider in the selector below.', 'info')}>Change Provider</button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          <div style={{ height: 24 }} />
        </div>
      </div>

      <Composer
        model={model}
        providerId={providerId}
        agentId={agentId}
        onModelChange={changeModel}
        onAgentChange={changeAgent}
      />
    </>
  );
}
