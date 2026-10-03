import React, { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { useApp } from '../store/app';
import { StatusBadge, Spinner } from '../components/ui';
import { timeAgo } from '../lib/format';

export function VideoPage() {
  const [videos, setVideos] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [form, setForm] = useState({ prompt: '', duration: 5, resolution: '720p', aspect: '16:9', style: 'auto' });
  const [busy, setBusy] = useState(false);
  const toast = useApp((s) => s.toast);

  const load = async () => {
    try {
      const data = await api.get('/videos');
      setVideos(data.videos);
      setStatus(data.status);
    } catch (err) { toast(errorMessage(err), 'err'); }
  };
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, []);

  const enqueue = async () => {
    if (!form.prompt.trim()) return;
    setBusy(true);
    try {
      await api.post('/videos', form);
      toast('Video job queued', 'ok');
      await load();
    } catch (err) { toast(errorMessage(err), 'err'); } finally { setBusy(false); }
  };

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-title">
        <h1>Video Generator</h1>
        {status && !status.configured ? <span className="badge warn">architecture ready — no provider</span> : <span className="badge ok">provider connected</span>}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <b>Provider interface ready, synthesis backend pending.</b>
        <div className="dim" style={{ fontSize: 13, marginTop: 6 }}>
          {status?.instructions || 'A video provider can be registered server-side; jobs then move through queued → generating → completed automatically.'}
        </div>
        <div className="dim" style={{ fontSize: 12.5, marginTop: 4 }}>
          You can still enqueue jobs now: they will be tracked with honest state transitions and a clear failure reason until a provider is plugged in (see docs/architecture.md).
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <label className="field"><span>Prompt</span>
          <textarea className="input" rows={3} value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            placeholder="Slow camera orbit around a glowing anvil in a dark workshop, sparks rising" />
        </label>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
          <label className="field"><span>Duration (s)</span>
            <input className="input" type="number" min={1} max={60} value={form.duration} onChange={(e) => setForm({ ...form, duration: Number(e.target.value) })} />
          </label>
          <label className="field"><span>Resolution</span>
            <select className="input" value={form.resolution} onChange={(e) => setForm({ ...form, resolution: e.target.value })}>
              {['480p', '720p', '1080p'].map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <label className="field"><span>Aspect ratio</span>
            <select className="input" value={form.aspect} onChange={(e) => setForm({ ...form, aspect: e.target.value })}>
              {['16:9', '9:16', '1:1'].map((a) => <option key={a}>{a}</option>)}
            </select>
          </label>
          <label className="field"><span>Style</span>
            <select className="input" value={form.style} onChange={(e) => setForm({ ...form, style: e.target.value })}>
              {['auto', 'cinematic', 'anime', 'documentary'].map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
        </div>
        <button className="btn primary" onClick={enqueue} disabled={busy || !form.prompt.trim()}>
          {busy ? <Spinner /> : '▶ Enqueue job'}
        </button>
      </div>

      <div className="section-title" style={{ marginTop: 0 }}>Queue</div>
      {!videos.length ? <div className="empty"><h3>Queue empty</h3><p>Enqueued jobs appear here with their live state.</p></div> : (
        <div className="grid">
          {videos.map((v) => (
            <div key={v.id} className="card">
              <div className="spread">
                <b style={{ fontSize: 13.8 }}>{v.prompt.slice(0, 110)}</b>
                <StatusBadge status={v.status} />
              </div>
              <div className="faint" style={{ fontSize: 11.8, marginTop: 4 }}>
                {v.duration}s · {v.resolution} · {v.aspect} · {v.style} · queued {timeAgo(v.createdAt)}
              </div>
              {v.error ? <div style={{ color: 'var(--err)', fontSize: 12.6, marginTop: 6 }}>{v.error}</div> : null}
              {v.path ? <video src={`/api/videos/${v.id}/content`} controls style={{ width: '100%', marginTop: 8, borderRadius: 8 }} /> : null}
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn ghost sm" onClick={async () => { await api.del(`/videos/${v.id}`); await load(); }}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
