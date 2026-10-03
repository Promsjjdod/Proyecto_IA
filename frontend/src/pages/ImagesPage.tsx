import React, { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { useApp } from '../store/app';
import { Confirm, Spinner } from '../components/ui';
import { timeAgo } from '../lib/format';

export function ImagesPage() {
  const [images, setImages] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [form, setForm] = useState({ prompt: '', negativePrompt: '', aspect: '1:1', resolution: '1024', count: 1, style: 'auto' });
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<any>(null);
  const toast = useApp((s) => s.toast);

  const load = async () => {
    try {
      const data = await api.get('/images');
      setImages(data.images);
      setStatus(data.status);
    } catch (err) { toast(errorMessage(err), 'err'); }
  };
  useEffect(() => { load(); }, []);

  const generate = async () => {
    if (!form.prompt.trim()) return;
    setBusy(true);
    try {
      await api.post('/images', form);
      toast('Image generated', 'ok');
      await load();
    } catch (err) { toast(errorMessage(err), 'err'); } finally { setBusy(false); }
  };

  const copyPrompt = async (p: string) => {
    try { await navigator.clipboard.writeText(p); toast('Prompt copied', 'ok'); } catch { toast('Clipboard unavailable', 'err'); }
  };

  return (
    <div className="page">
      <div className="page-title">
        <h1>Image Generator</h1>
        {status && !status.configured ? <span className="badge warn">not configured — DEMO placeholders</span> : <span className="badge ok">provider connected</span>}
      </div>

      {status && !status.configured && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'var(--warn)' }}>
          <b>No image provider configured.</b>
          <div className="dim" style={{ fontSize: 13, marginTop: 4 }}>{status.instructions}</div>
          <div className="dim" style={{ fontSize: 12.5, marginTop: 4 }}>While DEMO mode is on, generations produce clearly labelled placeholder artwork so you can test the gallery, downloads and regeneration.</div>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(280px, 380px) 1fr', gap: 18 }}>
        <div className="card">
          <label className="field"><span>Prompt</span>
            <textarea className="input" rows={4} value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })}
              placeholder="A minimalist poster of a mountain forge at dawn, ember sparks, flat geometric style" />
          </label>
          <label className="field"><span>Negative prompt</span>
            <input className="input" value={form.negativePrompt} onChange={(e) => setForm({ ...form, negativePrompt: e.target.value })} placeholder="blurry, text, watermark" />
          </label>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label className="field"><span>Aspect ratio</span>
              <select className="input" value={form.aspect} onChange={(e) => setForm({ ...form, aspect: e.target.value })}>
                {['1:1', '16:9', '9:16', '4:3', '3:4'].map((a) => <option key={a}>{a}</option>)}
              </select>
            </label>
            <label className="field"><span>Resolution</span>
              <select className="input" value={form.resolution} onChange={(e) => setForm({ ...form, resolution: e.target.value })}>
                {['512', '768', '1024'].map((r) => <option key={r}>{r}</option>)}
              </select>
            </label>
            <label className="field"><span>Images</span>
              <select className="input" value={form.count} onChange={(e) => setForm({ ...form, count: Number(e.target.value) })}>
                {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="field"><span>Style</span>
              <select className="input" value={form.style} onChange={(e) => setForm({ ...form, style: e.target.value })}>
                {['auto', 'photographic', 'illustration', 'flat-vector', 'isometric', 'pixel-art'].map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} onClick={generate} disabled={busy || !form.prompt.trim()}>
            {busy ? <Spinner label="Generating…" /> : '🖼 Generate'}
          </button>
        </div>

        <div>
          <div className="section-title" style={{ marginTop: 0 }}>Gallery — saved in /generated/images</div>
          {!images.length ? <div className="empty"><h3>No images yet</h3><p>Generated images are stored locally with their full prompt metadata.</p></div> : (
            <div className="grid cols-3">
              {images.map((img) => (
                <div key={img.id} className="img-tile">
                  <img src={`/api/images/${img.id}/content`} alt={img.prompt} loading="lazy" />
                  <div className="bar">
                    <button className="btn ghost sm" title="Download" onClick={() => { const a = document.createElement('a'); a.href = `/api/images/${img.id}/content`; a.download = `${img.id}.png`; a.click(); }}>⬇</button>
                    <button className="btn ghost sm" title="Copy prompt" onClick={() => copyPrompt(img.prompt)}>⧉</button>
                    <button className="btn ghost sm" title="Regenerate" onClick={async () => { setBusy(true); try { await api.post(`/images/${img.id}/regenerate`); await load(); } catch (e) { toast(errorMessage(e), 'err'); } finally { setBusy(false); } }}>⟳</button>
                    <button className="btn ghost sm" title="Delete" onClick={() => setConfirmDel(img)}>🗑</button>
                  </div>
                  <div style={{ padding: '8px 10px', fontSize: 12 }}>
                    <div className="row">
                      <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{img.prompt}</span>
                      {img.demo ? <span className="badge demo">DEMO</span> : null}
                    </div>
                    <div className="faint" style={{ fontSize: 11 }}>{img.aspect} · {img.resolution} · {img.style} · {timeAgo(img.createdAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {confirmDel && (
        <Confirm title="Delete image?" body="The file and its database record will be removed."
          onClose={() => setConfirmDel(null)}
          onConfirm={async () => { await api.del(`/images/${confirmDel.id}`); await load(); }} />
      )}
    </div>
  );
}
