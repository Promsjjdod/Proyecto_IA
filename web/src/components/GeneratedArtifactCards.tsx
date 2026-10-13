import { useEffect, useMemo, useState } from 'react';
import { Check, Code2, Copy, Download, Eye, Maximize2, X } from 'lucide-react';
import { artifactDownload, artifactPreviewDocument, artifactPreviewSandbox, detectCodeArtifacts, type CodeArtifact } from '../artifacts';

type PreviewState = { artifactId: string; tab: 'preview' | 'code' };

export function ArtifactPreviewFrame({ artifact, content, onError }: { artifact: CodeArtifact; content: string; onError: () => void }) {
  return <iframe className="artifact-preview-frame" title={`Vista previa de ${artifact.filename}`} srcDoc={artifactPreviewDocument(artifact, content)} sandbox={artifactPreviewSandbox} referrerPolicy="no-referrer" onError={onError} />;
}

export function GeneratedArtifactCards({ content }: { content: string }) {
  const artifacts = useMemo(() => detectCodeArtifacts(content), [content]);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [editedContent, setEditedContent] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [frameError, setFrameError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const selected = artifacts.find((artifact) => artifact.id === preview?.artifactId);
  const selectedContent = selected ? editedContent[selected.id] ?? selected.content : '';

  useEffect(() => {
    if (!preview) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPreview(null); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [preview]);

  if (!artifacts.length) return null;

  const contentFor = (artifact: CodeArtifact) => editedContent[artifact.id] ?? artifact.content;
  const copyCode = async (artifact: CodeArtifact) => {
    try {
      await navigator.clipboard.writeText(contentFor(artifact));
      setCopiedId(artifact.id);
      setActionError('');
      window.setTimeout(() => setCopiedId((current) => current === artifact.id ? null : current), 1400);
    } catch {
      setActionError('No se pudo copiar el código. Comprueba los permisos del portapapeles del navegador.');
    }
  };
  const downloadCode = (artifact: CodeArtifact) => {
    const file = artifactDownload(artifact, contentFor(artifact));
    const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
    const link = document.createElement('a');
    link.href = url;
    link.download = file.filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const showPreview = (artifact: CodeArtifact, tab: PreviewState['tab']) => {
    setFrameError(false);
    setExpanded(false);
    setPreview({ artifactId: artifact.id, tab });
  };

  return <>
    <section className="generated-artifact-list" aria-label="Artefactos de código generados">
      {artifacts.map((artifact) => <article className="generated-artifact-card" key={artifact.id}>
        <div className="generated-artifact-icon"><Code2 size={16} /></div>
        <div className="generated-artifact-info"><b>{artifact.filename}</b><small>{artifact.kind === 'html-document' ? 'Documento HTML completo' : artifact.kind === 'html-fragment' ? 'Fragmento HTML' : artifact.kind === 'css' ? 'Hoja de estilos CSS' : 'Código JavaScript'}</small></div>
        <div className="generated-artifact-actions">
          {artifact.language === 'html' && <button className="button button-secondary button-sm" onClick={() => showPreview(artifact, 'preview')}><Eye size={13} />Vista previa</button>}
          <button className="button button-quiet button-sm" onClick={() => showPreview(artifact, 'code')}><Code2 size={13} />Editar código</button>
          <button className="button button-quiet button-sm" onClick={() => void copyCode(artifact)}>{copiedId === artifact.id ? <Check size={13} /> : <Copy size={13} />}{copiedId === artifact.id ? 'Copiado' : 'Copiar código'}</button>
          <button className="button button-quiet button-sm" onClick={() => downloadCode(artifact)}><Download size={13} />Descargar</button>
        </div>
      </article>)}
      {actionError && <p className="generated-artifact-error" role="alert">{actionError}</p>}
    </section>
    {selected && preview && <div className="modal-backdrop artifact-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}>
      <section className={`artifact-preview-modal ${expanded ? 'artifact-preview-expanded' : ''}`} role="dialog" aria-modal="true" aria-label={`${selected.filename} ${preview.tab === 'preview' ? 'vista previa' : 'código'}`}>
        <header className="artifact-preview-modal-head">
          <div><span className="generated-artifact-icon"><Code2 size={15} /></span><div><b>{selected.filename}</b><small>{preview.tab === 'preview' ? 'Vista previa aislada' : 'Código editable en esta sesión'}</small></div></div>
          <div className="artifact-preview-modal-actions">
            <button className={`icon-button ${expanded ? 'active' : ''}`} aria-label={expanded ? 'Reducir vista previa' : 'Ampliar vista previa'} title={expanded ? 'Reducir' : 'Ampliar'} onClick={() => setExpanded((value) => !value)}><Maximize2 size={15} /></button>
            <button className="icon-button" aria-label="Cerrar vista previa" title="Volver al chat" onClick={() => setPreview(null)}><X size={16} /></button>
          </div>
        </header>
        <nav className="artifact-preview-tabs" aria-label="Opciones del artefacto">
          {selected.language === 'html' && <button className={preview.tab === 'preview' ? 'selected' : ''} onClick={() => { setFrameError(false); setPreview({ ...preview, tab: 'preview' }); }}><Eye size={13} />Vista previa</button>}
          <button className={preview.tab === 'code' ? 'selected' : ''} onClick={() => setPreview({ ...preview, tab: 'code' })}><Code2 size={13} />Código</button>
          <button onClick={() => void copyCode(selected)}>{copiedId === selected.id ? <Check size={13} /> : <Copy size={13} />}{copiedId === selected.id ? 'Copiado' : 'Copiar código'}</button>
          <button onClick={() => downloadCode(selected)}><Download size={13} />Descargar</button>
        </nav>
        {preview.tab === 'preview' && selected.language === 'html' ? <div className="artifact-preview-frame-wrap">
          {frameError && <p className="generated-artifact-error" role="alert">No se pudo cargar la vista previa. El código original sigue disponible en la pestaña Código.</p>}
          <ArtifactPreviewFrame key={`${selected.id}-${selectedContent}`} artifact={selected} content={selectedContent} onError={() => setFrameError(true)} />
        </div> : <textarea className="artifact-code-editor" aria-label={`Código de ${selected.filename}`} spellCheck={false} value={selectedContent} onChange={(event) => setEditedContent((current) => ({ ...current, [selected.id]: event.target.value }))} />}
        {actionError && <p className="generated-artifact-error" role="alert">{actionError}</p>}
      </section>
    </div>}
  </>;
}
