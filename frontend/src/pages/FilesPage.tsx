import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useApp } from '../store/app';
import { Confirm, Modal, Spinner, Empty } from '../components/ui';
import { formatBytes, timeAgo } from '../lib/format';
import { Markdown } from '../components/Markdown';

export function FilesPage() {
  const [files, setFiles] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [confirmDel, setConfirmDel] = useState<any>(null);
  const [renaming, setRenaming] = useState<any>(null);
  const [renameValue, setRenameValue] = useState('');
  const [tree, setTree] = useState<any[]>([]);
  const [treePath, setTreePath] = useState('');
  const [tab, setTab] = useState<'uploads' | 'workspace'>('uploads');
  const [over, setOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useApp((s) => s.toast);
  const [params] = useSearchParams();

  const load = async () => {
    try {
      const data = await api.get(`/files?q=${encodeURIComponent(query)}&folder=${encodeURIComponent(folder)}`);
      setFiles(data.files);
      setStats(data.stats);
    } catch (err) { toast(errorMessage(err), 'err'); }
  };
  const loadTree = async (p: string) => {
    try {
      const data = await api.get(`/workspace-tree?path=${encodeURIComponent(p)}`);
      setTree(data.entries);
      setTreePath(p);
    } catch (err) { toast(errorMessage(err), 'err'); }
  };

  useEffect(() => { load(); loadTree(''); const openId = params.get('open'); if (openId) api.get(`/files/${openId}`).then(({ file, preview }) => setPreview({ file, preview })).catch(() => undefined); }, []);

  const upload = async (list: FileList | File[]) => {
    setUploading(true);
    const form = new FormData();
    for (const f of Array.from(list)) form.append('files', f);
    form.append('folder', folder);
    try {
      await api.upload('/files/upload', form);
      toast('Upload complete', 'ok');
      await load();
    } catch (err) { toast(errorMessage(err), 'err'); } finally { setUploading(false); }
  };

  const openPreview = async (id: string) => {
    try {
      const { file, preview } = await api.get(`/files/${id}`);
      setPreview({ file, preview });
    } catch (err) { toast(errorMessage(err), 'err'); }
  };

  const download = (id: string, name: string) => {
    const a = document.createElement('a');
    a.href = `/api/files/${id}/download`;
    a.download = name;
    a.click();
  };

  return (
    <div className="page">
      <div className="page-title">
        <h1>File Workspace</h1>
        {stats ? <span className="badge">{stats.count} files · {formatBytes(stats.totalBytes)}</span> : null}
        <div className="grow" />
        <button className="btn primary" onClick={() => inputRef.current?.click()} disabled={uploading}>
          {uploading ? <Spinner label="Uploading…" /> : '⬆ Upload'}
        </button>
        <input ref={inputRef} type="file" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'uploads' ? 'active' : ''}`} onClick={() => setTab('uploads')}>Uploads</button>
        <button className={`tab ${tab === 'workspace' ? 'active' : ''}`} onClick={() => setTab('workspace')}>Repository workspace</button>
      </div>

      {tab === 'uploads' ? (
        <>
          <div className="row" style={{ marginBottom: 12, gap: 8 }}>
            <input className="input" style={{ maxWidth: 300 }} placeholder="Search files…" value={query} onChange={(e) => { setQuery(e.target.value); setTimeout(load, 200); }} />
            <input className="input" style={{ maxWidth: 200 }} placeholder="Folder filter" value={folder} onChange={(e) => { setFolder(e.target.value); setTimeout(load, 200); }} />
          </div>
          <div
            className="dropzone"
            style={{ marginBottom: 14, padding: 16 }}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files?.length) upload(e.dataTransfer.files); }}
            onClick={() => inputRef.current?.click()}
          >
            <span className={over ? 'accent' : ''}>Drop files here (TXT, MD, PDF, DOCX, CSV, JSON, JS, TS, PY, HTML, CSS, ZIP, images…) or click to browse</span>
          </div>

          {!files.length ? <Empty icon="⌸" title="No files yet" body="Upload documents, datasets or code to attach them to chats or inspect them with previews." /> : (
            <table className="file-table">
              <thead><tr><th>Name</th><th>Folder</th><th>Kind</th><th>Size</th><th>Added</th><th></th></tr></thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.id}>
                    <td><button className="btn ghost sm" style={{ justifyContent: 'flex-start' }} onClick={() => openPreview(f.id)}>⌸ {f.name}</button></td>
                    <td className="dim">{f.folder || '—'}</td>
                    <td><span className="badge">{f.kind}</span></td>
                    <td className="dim mono" style={{ fontSize: 12 }}>{formatBytes(f.size)}</td>
                    <td className="dim" style={{ fontSize: 12 }}>{timeAgo(f.createdAt)}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn ghost sm" title="Preview" onClick={() => openPreview(f.id)}>👁</button>
                        <button className="btn ghost sm" title="Download" onClick={() => download(f.id, f.name)}>⬇</button>
                        <button className="btn ghost sm" title="Rename" onClick={() => { setRenaming(f); setRenameValue(f.name); }}>✎</button>
                        <button className="btn ghost sm" title="Delete" onClick={() => setConfirmDel(f)}>🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 10 }}>
            <button className="btn sm" onClick={() => loadTree(treePath.split('/').slice(0, -1).join('/'))}>↑ up</button>
            <code className="inline">/{treePath}</code>
            <button className="btn ghost sm" onClick={() => loadTree(treePath)}>⟳</button>
          </div>
          <table className="file-table">
            <tbody>
              {tree.map((e) => (
                <tr key={e.path}>
                  <td style={{ width: 26 }}>{e.type === 'dir' ? '📁' : '📄'}</td>
                  <td>
                    {e.type === 'dir'
                      ? <button className="btn ghost sm" style={{ justifyContent: 'flex-start' }} onClick={() => loadTree(e.path)}>{e.name}</button>
                      : <span>{e.name}</span>}
                  </td>
                  <td className="dim mono" style={{ fontSize: 12 }}>{e.size !== undefined ? formatBytes(e.size) : ''}</td>
                </tr>
              ))}
              {!tree.length && <tr><td className="dim">Empty directory.</td></tr>}
            </tbody>
          </table>
        </>
      )}

      {preview && (
        <Modal wide title={<span>⌸ {preview.file.name} <span className="badge" style={{ marginLeft: 8 }}>{preview.preview.kind}</span></span>} onClose={() => setPreview(null)}>
          <PreviewBody preview={preview.preview} file={preview.file} />
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn" onClick={() => download(preview.file.id, preview.file.name)}> Download</button>
            <button className="btn" onClick={() => setPreview(null)}>Close</button>
          </div>
        </Modal>
      )}

      {confirmDel && (
        <Confirm title="Delete file?" body={<>{confirmDel.name} will be removed from disk and from the database.</>}
          onClose={() => setConfirmDel(null)}
          onConfirm={async () => { await api.del(`/files/${confirmDel.id}`); await load(); }} />
      )}
      {renaming && (
        <Modal title="Rename file" onClose={() => setRenaming(null)}>
          <input className="input" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn" onClick={() => setRenaming(null)}>Cancel</button>
            <button className="btn primary" onClick={async () => { await api.patch(`/files/${renaming.id}`, { name: renameValue }); setRenaming(null); await load(); }}>Save</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PreviewBody({ preview, file }: { preview: any; file: any }) {
  if (preview.error) return <div className="card" style={{ borderColor: 'var(--err)' }}>{preview.error}</div>;
  if (preview.kind === 'image') return <img src={preview.streamUrl} alt={file.name} style={{ maxWidth: '100%', borderRadius: 8 }} />;
  if (preview.kind === 'pdf') return <iframe src={preview.streamUrl} title={file.name} style={{ width: '100%', height: 460, border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }} />;
  if (preview.kind === 'markdown') return <div className="card"><Markdown text={preview.content || ''} /></div>;
  if (preview.kind === 'csv' && preview.table) {
    const [head, ...rows] = preview.table;
    return (
      <div style={{ overflow: 'auto', maxHeight: 420 }}>
        <table className="file-table">
          <thead><tr>{(head || []).map((h: string, i: number) => <th key={i}>{h}</th>)}</tr></thead>
          <tbody>{rows.slice(0, 150).map((r: string[], i: number) => <tr key={i}>{r.map((c: string, j: number) => <td key={j}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }
  if (preview.kind === 'zip') {
    return (
      <div>
        <div className="hint" style={{ marginBottom: 6 }}>{preview.totalEntries} entries in archive:</div>
        <pre className="code">{(preview.zipEntries || []).join('\n')}</pre>
      </div>
    );
  }
  if (preview.content !== undefined) return <pre className="code" style={{ maxHeight: 420 }}>{preview.content}{preview.truncated ? '\n… [truncated]' : ''}</pre>;
  return <div className="dim">No text preview available for this binary file. Use Download.</div>;
}
