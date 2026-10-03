import React, { useState } from 'react';
import { Markdown } from './Markdown';
import { CopyButton } from './ui';
import { clockTime, duration } from '../lib/format';
import type { Message, ToolEvent } from '../store/chats';

export function ToolChips({ tools }: { tools: ToolEvent[] }) {
  if (!tools.length) return null;
  return (
    <div style={{ margin: '6px 0' }}>
      {tools.map((t, i) => (
        <span key={i} className={`tool-chip ${t.phase === 'completed' || t.phase === 'approved' ? 'ok' : t.phase === 'failed' || t.phase === 'denied' ? 'err' : t.phase === 'approval_required' ? 'wait' : ''}`}>
          {t.phase === 'started' ? <span className="spinner" style={{ width: 10, height: 10 }} /> : t.phase === 'completed' ? '✓' : t.phase === 'failed' ? '✕' : t.phase === 'denied' ? '🛡' : '…'}
          <span>{t.label || t.tool}</span>
          {t.summary ? <span className="faint" style={{ fontSize: 11 }}>· {t.summary.slice(0, 60)}</span> : null}
        </span>
      ))}
    </div>
  );
}

export function MessageView({ message, isStreaming, streamTools, onEdit, onRegenerate, demo }: {
  message: Message;
  isStreaming?: boolean;
  streamTools?: ToolEvent[];
  onEdit?: (content: string) => void;
  onRegenerate?: () => void;
  demo?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const isUser = message.role === 'user';
  const toolMessages = message.meta?.toolCalls?.length ? message.meta.toolCalls : null;

  return (
    <div className="msg-row">
      <div className={`msg-avatar ${isUser ? 'user' : 'ai'}`}>
        {isUser ? '☺' : <img src="/brand/favicon-32.png" alt="" width={18} height={18} style={{ borderRadius: 4 }} />}
      </div>
      <div className="msg-body">
        <div className="msg-meta">
          <b style={{ color: 'var(--text)' }}>{isUser ? 'You' : message.model || 'ForgeAI'}</b>
          {demo && !isUser ? <span className="badge demo">DEMO</span> : null}
          {!isUser && message.providerId ? <span className="badge">{message.providerId}</span> : null}
          <span>{clockTime(message.createdAt)}</span>
          {!isUser && message.tokensOut ? <span className="faint mono" style={{ fontSize: 11 }}>{message.tokensOut} tok{message.tokensPerSec ? ` · ${message.tokensPerSec} tok/s` : ''} · {duration(message.durationMs)}</span> : null}
        </div>

        {toolMessages ? (
          <div>
            {toolMessages.map((tc: any) => (
              <span key={tc.id} className="tool-chip ok">✓ {tc.name}</span>
            ))}
          </div>
        ) : null}
        {isStreaming && streamTools?.length ? <ToolChips tools={streamTools} /> : null}

        {editing ? (
          <div>
            <textarea className="input" rows={6} value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn primary sm" onClick={() => { onEdit?.(draft); setEditing(false); }}>Save & resend</button>
              <button className="btn sm" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : message.role === 'tool' ? (
          <pre className="code" style={{ margin: 0 }}>{message.content}</pre>
        ) : isUser ? (
          <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
        ) : (
          <Markdown text={message.content} />
        )}

        {message.error ? (
          <div className="card" style={{ borderColor: 'var(--err)', marginTop: 8, padding: 10 }}>
            <div className="row" style={{ color: 'var(--err)', fontSize: 13.4 }}>⚠ {message.error}</div>
          </div>
        ) : null}

        {!isStreaming && (
          <div className="msg-actions">
            <CopyButton text={message.content} />
            {isUser && onEdit ? <button className="btn ghost sm" onClick={() => { setDraft(message.content); setEditing(true); }}>Edit</button> : null}
            {!isUser && onRegenerate ? <button className="btn ghost sm" onClick={onRegenerate}>Regenerate</button> : null}
          </div>
        )}
      </div>
    </div>
  );
}
