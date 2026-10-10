import { useEffect, useState, type FormEvent } from 'react';
import { ArrowDownToLine, ExternalLink, ImagePlus, LoaderCircle, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { ImageRecord, Project, Provider } from '../types';
import { api } from '../api';
import { EmptyState, ErrorBanner, ProviderIcon } from './common';

const imageProviders = new Set(['openai', 'openai-compatible', 'custom']);
export function ImagesPage({ providers, projects, activeProjectId, onRefreshProjects, onRefreshUsage }: { providers: Provider[]; projects: Project[]; activeProjectId: string | null; onRefreshProjects: () => void; onRefreshUsage: () => void }) {
  const [providerId, setProviderId] = useState('');
  const [modelId, setModelId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('1024x1024');
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [savingProject, setSavingProject] = useState('');
  const eligible = providers.filter((provider) => imageProviders.has(provider.type));
  const activeProvider = eligible.find((provider) => provider.id === providerId);
  const projectId = activeProjectId || projects[0]?.id || '';
  const loadImages = async () => { try { setImages(await api<ImageRecord[]>('/images')); } catch { /* preserve local UI */ } };
  useEffect(() => { if (!providerId && eligible[0]) setProviderId(eligible[0].id); }, [eligible, providerId]);
  useEffect(() => { void loadImages(); }, []);
  const generate = async (event: FormEvent) => {
    event.preventDefault();
    if (!prompt.trim() || !providerId || !modelId.trim()) return;
    if (!window.confirm('Esta petición se enviará al proveedor externo seleccionado y puede generar costes en su cuenta. ¿Continuar?')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<ImageRecord>('/images/generate', { method: 'POST', body: JSON.stringify({ providerId, modelId: modelId.trim(), prompt: prompt.trim(), size, confirmResourceUse: true, requestId: crypto.randomUUID() }) });
      setImages((current) => [result, ...current]); setNotice('Imagen generada y guardada en tu biblioteca.'); onRefreshUsage();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo generar la imagen.'); }
    finally { setBusy(false); }
  };
  const remove = async (image: ImageRecord) => {
    if (!window.confirm('¿Eliminar esta imagen de tu historial?')) return;
    try { await api(`/images/${encodeURIComponent(image.id)}`, { method: 'DELETE' }); setImages((current) => current.filter((item) => item.id !== image.id)); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo eliminar.'); }
  };
  const saveToProject = async (image: ImageRecord) => {
    if (!projectId) { setError('Crea o selecciona un proyecto antes de guardar la imagen allí.'); return; }
    setSavingProject(image.id); setError('');
    try { const result = await api<{ path: string }>(`/projects/${encodeURIComponent(projectId)}/import-image`, { method: 'POST', body: JSON.stringify({ imageId: image.id }) }); setNotice(`Imagen guardada en ${projects.find((p) => p.id === projectId)?.name || 'el proyecto'} / ${result.path}.`); onRefreshProjects(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo copiar la imagen al proyecto.'); }
    finally { setSavingProject(''); }
  };
  return <div className="page-content images-page">
    <div className="page-heading-row"><div><div className="eyebrow"><span className="eyebrow-dot" /> ESTUDIO VISUAL</div><h1>Imágenes</h1><p>Genera y organiza imágenes desde un endpoint de generación compatible.</p></div><span className="future-feature-chip"><Sparkles size={13} />GENERACIÓN EXTERNA</span></div>
    {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}{notice && <div className="success-banner">{notice}<button className="icon-button" onClick={() => setNotice('')}>×</button></div>}
    <div className="image-studio-layout"><section className="image-prompt-panel"><div className="studio-panel-heading"><span className="studio-icon"><ImagePlus size={17} /></span><div><b>Crear una imagen</b><small>Una imagen por solicitud</small></div></div>
      <form onSubmit={generate} className="form-stack"><label>Proveedor<select value={providerId} onChange={(e) => setProviderId(e.target.value)}>{eligible.length ? eligible.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>) : <option value="">Sin proveedores compatibles</option>}</select></label>{activeProvider && <div className="image-provider-callout"><ProviderIcon type={activeProvider.type} size={14} /><span>{activeProvider.name} · endpoint OpenAI Images compatible</span></div>}
        <label>Modelo de imagen<input value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="Identificador real, p. ej. gpt-image-1" required maxLength={120} /></label><small className="field-help">Usa el identificador documentado para el endpoint de imágenes de tu proveedor; los modelos de chat no se asumen como generadores.</small>
        <label>Instrucción de generación<textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={4000} rows={7} placeholder="Describe sujeto, composición, luz, estilo, fondo y detalles importantes…" required /></label>
        <label>Dimensiones<select value={size} onChange={(e) => setSize(e.target.value)}><option>1024x1024</option><option>1536x1024</option><option>1024x1536</option><option>1792x1024</option><option>1024x1792</option></select></label>
        <div className="image-capability-note">En esta versión: generación de una imagen PNG con API compatible con OpenAI. Referencias, transparencia, variaciones y proveedores específicos (Gemini/otros) aún no están conectados.</div>
        <button className="button button-primary image-generate-button" disabled={busy || !eligible.length || !modelId.trim() || !prompt.trim()}>{busy ? <><LoaderCircle size={16} className="spin" />Generando…</> : <><Sparkles size={16} />Generar imagen</>}</button>
      </form></section>
      <section className="image-gallery-panel"><div className="gallery-head"><div><span className="section-kicker">BIBLIOTECA PRIVADA</span><h2>Tu historial</h2></div><span className="section-count">{images.length}</span></div>
        {images.length ? <div className="image-gallery-grid">{images.map((image) => <article className="generated-image-card" key={image.id}><div className="generated-image-wrap"><img src={image.fileUrl} alt={image.prompt} loading="lazy" /><div className="generated-image-overlay"><a className="icon-button" href={image.fileUrl} download={`${image.id}.png`} title="Descargar"><ArrowDownToLine size={15} /></a><a className="icon-button" href={image.fileUrl} target="_blank" rel="noopener noreferrer" title="Abrir imagen"><ExternalLink size={15} /></a><button className="icon-button danger-icon" title="Eliminar imagen" onClick={() => void remove(image)}><Trash2 size={14} /></button></div></div><div className="generated-image-info"><p>{image.prompt}</p><div><span>{image.modelId}</span><small>{new Date(image.createdAt).toLocaleString()}</small></div><button className="button button-secondary button-sm" onClick={() => void saveToProject(image)} disabled={savingProject === image.id}>{savingProject === image.id ? 'Guardando…' : <><Plus size={13} />Guardar en proyecto</>}</button></div></article>)}</div> : <EmptyState icon={<ImagePlus size={23} />} title="Tu biblioteca empieza aquí" description="Las imágenes generadas se guardan de forma privada y pueden copiarse a un proyecto." />}
      </section></div>
  </div>;
}
