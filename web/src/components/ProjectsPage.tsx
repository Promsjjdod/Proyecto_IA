import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Code2, Download, ExternalLink, Eye, File, FilePlus2, Folder, FolderPlus, FolderKanban, Maximize2, MoreHorizontal, Play, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react';
import type { Project, ProjectFile } from '../types';
import { api } from '../api';
import { EmptyState, ErrorBanner, FileDownloadLink, Modal } from './common';

export function ProjectsPage({ projects, activeProjectId, onSelectProject, onRefresh }: { projects: Project[]; activeProjectId: string | null; onSelectProject: (id: string | null) => void; onRefresh: () => void }) {
  const [newProject, setNewProject] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [projectId, setProjectId] = useState(activeProjectId || '');
  useEffect(() => { if (activeProjectId && projects.some((project) => project.id === activeProjectId)) setProjectId(activeProjectId); }, [activeProjectId, projects]);
  const project = projects.find((item) => item.id === projectId);
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await api<Project>('/projects', { method: 'POST', body: JSON.stringify({ name }) }); setProjectId(result.id); onSelectProject(result.id); setNewProject(false); setName(''); onRefresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo crear el proyecto.'); }
    finally { setBusy(false); }
  };
  const removeProject = async (item: Project) => {
    if (!window.confirm(`¿Eliminar el proyecto «${item.name}» y todos sus archivos? Esta acción no se puede deshacer.`)) return;
    try { await api(`/projects/${encodeURIComponent(item.id)}`, { method: 'DELETE', body: JSON.stringify({ confirm: true }) }); setProjectId(''); onSelectProject(null); onRefresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo eliminar.'); }
  };
  if (project) return <ProjectWorkspace project={project} onBack={() => setProjectId('')} onDelete={() => void removeProject(project)} onRefreshProjects={onRefresh} onSetActive={() => onSelectProject(project.id)} />;
  return <div className="page-content projects-page">
    <div className="page-heading-row"><div><div className="eyebrow"><span className="eyebrow-dot" /> ESPACIOS DE TRABAJO</div><h1>Proyectos</h1><p>Archivos, conversaciones y artefactos guardados en tu espacio privado.</p></div><button className="button button-primary" onClick={() => setNewProject(true)}><Plus size={16} />Nuevo proyecto</button></div>
    {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}
    <div className="project-collection"><div className="section-title-row"><div><span className="section-kicker">MIS ESPACIOS</span><h2>Proyectos guardados</h2></div><span className="section-count">{projects.length}</span></div>{projects.length ? <div className="project-grid">{projects.map((item, index) => <article key={item.id} className={`project-card project-card-${index % 3}`}><div className="project-card-head"><div className="project-icon"><FolderKanban size={20} /></div><button className="icon-button danger-icon" title="Eliminar proyecto" onClick={() => void removeProject(item)}><Trash2 size={15} /></button></div><h3>{item.name}</h3><p>Creado {new Date(item.createdAt).toLocaleDateString()} · Actualizado {new Date(item.updatedAt).toLocaleDateString()}</p><div className="project-card-footer"><button className="button button-secondary button-sm" onClick={() => { setProjectId(item.id); onSelectProject(item.id); }}>Abrir proyecto <ArrowUpRight size={14} /></button>{activeProjectId === item.id && <span className="active-project-tag">ACTIVO</span>}</div></article>)}</div> : <EmptyState icon={<FolderKanban size={24} />} title="Crea tu primer proyecto" description="Agrupa archivos, prototipos y conversaciones en un espacio aislado." action={<button className="button button-primary" onClick={() => setNewProject(true)}><Plus size={16} />Crear proyecto</button>} />}</div>
    <div className="project-storage-note"><span><Folder size={15} />Almacenamiento persistente</span><span>Los archivos permanecen en el servidor de esta instalación. No son públicos.</span></div>
    {newProject && <Modal title="Nuevo proyecto" description="Cada proyecto tiene su propio directorio de archivos y vista previa privada." onClose={() => setNewProject(false)}><form className="form-stack" onSubmit={create}><label>Nombre del proyecto<input autoFocus required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="p. ej. Sitio personal" /></label><div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setNewProject(false)}>Cancelar</button><button className="button button-primary" disabled={busy}>{busy ? 'Creando…' : 'Crear proyecto'}</button></div></form></Modal>}
  </div>;
}

function ProjectWorkspace({ project, onBack, onDelete, onRefreshProjects, onSetActive }: { project: Project; onBack: () => void; onDelete: () => void; onRefreshProjects: () => void; onSetActive: () => void }) {
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [previewVersion, setPreviewVersion] = useState(Date.now());
  const [showPreview, setShowPreview] = useState(true);
  const [previewWidth, setPreviewWidth] = useState<'desktop' | 'mobile'>('desktop');
  const [revisions, setRevisions] = useState<any[]>([]);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const unsaved = content !== savedContent;
  const previewFile = files.find((file) => file.path === 'index.html') || files.find((file) => file.type === 'file' && ['.html', '.htm'].includes(file.path.slice(file.path.lastIndexOf('.')).toLowerCase()));
  const previewUrl = previewFile ? `/api/projects/${encodeURIComponent(project.id)}/preview/${previewFile.path.split('/').map(encodeURIComponent).join('/')}?v=${previewVersion}` : '';
  const tree = useMemo(() => files, [files]);
  const loadFiles = async (preferred?: string) => {
    try {
      const list = await api<ProjectFile[]>(`/projects/${encodeURIComponent(project.id)}/files`); setFiles(list);
      const candidate = preferred || selectedPath || list.find((file) => file.type === 'file')?.path || '';
      if (candidate && list.some((file) => file.path === candidate && file.type === 'file')) await loadFile(candidate, false);
      else if (!list.length) { setSelectedPath(''); setContent(''); setSavedContent(''); }
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron cargar los archivos.'); }
  };
  const loadFile = async (filePath: string, reportError = true) => {
    try { const file = await api<{ path: string; content: string }>(`/projects/${encodeURIComponent(project.id)}/file?path=${encodeURIComponent(filePath)}`); setSelectedPath(file.path); setContent(file.content); setSavedContent(file.content); }
    catch (e) { if (reportError) setError(e instanceof Error ? e.message : 'No se pudo abrir el archivo.'); }
  };
  useEffect(() => { void loadFiles(); /* loads the project tree on change */ }, [project.id]);
  const save = async () => {
    if (!selectedPath) return;
    setBusy(true); setError('');
    try { await api(`/projects/${encodeURIComponent(project.id)}/file`, { method: 'PUT', body: JSON.stringify({ path: selectedPath, content }) }); setSavedContent(content); setNotice('Cambios guardados.'); setPreviewVersion(Date.now()); void loadFiles(selectedPath); onRefreshProjects(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar.'); }
    finally { setBusy(false); }
  };
  const createFile = async () => {
    const filePath = window.prompt('Ruta del nuevo archivo (por ejemplo src/main.js)', 'index.html');
    if (!filePath?.trim()) return;
    try { await api(`/projects/${encodeURIComponent(project.id)}/file`, { method: 'PUT', body: JSON.stringify({ path: filePath.trim(), content: '' }) }); await loadFiles(filePath.trim()); setNotice('Archivo creado.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo crear el archivo.'); }
  };
  const createFolder = async () => {
    const folder = window.prompt('Ruta de la nueva carpeta', 'src');
    if (!folder?.trim()) return;
    try { await api(`/projects/${encodeURIComponent(project.id)}/folder`, { method: 'POST', body: JSON.stringify({ path: folder.trim() }) }); await loadFiles(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo crear la carpeta.'); }
  };
  const deleteEntry = async (file: ProjectFile) => {
    if (!window.confirm(`¿Eliminar ${file.type === 'directory' ? 'la carpeta y su contenido' : 'el archivo'} «${file.path}»?`)) return;
    try { await api(`/projects/${encodeURIComponent(project.id)}/entry`, { method: 'DELETE', body: JSON.stringify({ path: file.path, confirm: true, recursive: true }) }); if (selectedPath === file.path) { setSelectedPath(''); setContent(''); } await loadFiles(); setNotice('Elemento eliminado.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo eliminar.'); }
  };
  const renameEntry = async (file: ProjectFile) => {
    const to = window.prompt('Nueva ruta relativa', file.path);
    if (!to?.trim() || to === file.path) return;
    try { await api(`/projects/${encodeURIComponent(project.id)}/rename`, { method: 'POST', body: JSON.stringify({ from: file.path, to: to.trim() }) }); if (selectedPath === file.path) setSelectedPath(to.trim()); await loadFiles(to.trim()); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo renombrar.'); }
  };
  const openRevisions = async () => {
    if (!selectedPath) return;
    try { const list = await api<any[]>(`/projects/${encodeURIComponent(project.id)}/revisions?path=${encodeURIComponent(selectedPath)}`); setRevisions(list); setRevisionOpen(true); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo consultar el historial.'); }
  };
  const restore = async (revisionId: string) => {
    if (!window.confirm('¿Restaurar esta versión? El contenido actual quedará en el historial.')) return;
    try { await api(`/projects/${encodeURIComponent(project.id)}/revisions/${encodeURIComponent(revisionId)}/restore`, { method: 'POST', body: JSON.stringify({ confirm: true }) }); await loadFile(selectedPath); setRevisionOpen(false); setPreviewVersion(Date.now()); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo restaurar.'); }
  };
  return <div className="workspace-page">
    <div className="workspace-topbar"><button className="button button-quiet button-sm" onClick={onBack}><ArrowLeft size={15} />Proyectos</button><div className="workspace-project-title"><FolderKanban size={16} /><b>{project.name}</b><span>{unsaved ? 'CAMBIOS SIN GUARDAR' : 'GUARDADO'}</span></div><div className="workspace-actions"><button className="button button-quiet button-sm" onClick={onSetActive}>Usar en chat</button><a className="button button-secondary button-sm" href={`/api/projects/${encodeURIComponent(project.id)}/download`}><Download size={14} />Descargar proyecto</a><button className="icon-button danger-icon" onClick={onDelete} title="Eliminar proyecto"><Trash2 size={15} /></button></div></div>
    {error && <div className="workspace-alert"><ErrorBanner message={error} onDismiss={() => setError('')} /></div>}{notice && <div className="workspace-toast">{notice}<button onClick={() => setNotice('')}>×</button></div>}
    <div className="workspace-layout"><aside className="file-explorer"><div className="file-explorer-head"><div><span>EXPLORADOR</span><b>Archivos</b></div><div><button className="icon-button" title="Nueva carpeta" onClick={() => void createFolder()}><FolderPlus size={15} /></button><button className="icon-button" title="Nuevo archivo" onClick={() => void createFile()}><FilePlus2 size={15} /></button><button className="icon-button" title="Actualizar lista" onClick={() => void loadFiles()}><RefreshCw size={14} /></button></div></div><div className="file-tree">{tree.length ? tree.map((file) => <div key={file.path} className={`file-tree-row ${selectedPath === file.path ? 'selected' : ''}`} style={{ paddingLeft: `${12 + (file.path.split('/').length - 1) * 12}px` }}><button onClick={() => file.type === 'file' && void loadFile(file.path)} title={file.path}>{file.type === 'directory' ? <Folder size={14} /> : <File size={14} />}<span>{file.name}</span></button><div className="file-row-actions"><button onClick={() => void renameEntry(file)} title="Renombrar">⋯</button><button onClick={() => void deleteEntry(file)} title="Eliminar"><X size={12} /></button></div></div>) : <div className="file-tree-empty"><File size={17} /><span>Este proyecto está vacío.</span><button onClick={() => void createFile()}>Crear index.html</button></div>}</div><div className="file-explorer-bottom"><span>{files.filter((file) => file.type === 'file').length} archivos</span><span>máx. 1 MB por archivo</span></div></aside>
      <main className="code-workbench"><div className="workbench-toolbar"><div className="file-tab"><Code2 size={14} />{selectedPath || 'Selecciona un archivo'}{unsaved && <i />}</div><div className="workbench-toolbar-actions"><button className="icon-text-button" disabled={!selectedPath} onClick={() => void openRevisions()}><MoreHorizontal size={14} />Versiones</button><a className="icon-text-button" href={selectedPath ? `/api/projects/${encodeURIComponent(project.id)}/download-file?path=${encodeURIComponent(selectedPath)}` : undefined} aria-disabled={!selectedPath}><Download size={14} />Descargar</a><button className="button button-primary button-sm" disabled={!selectedPath || !unsaved || busy} onClick={() => void save()}>{busy ? <span className="spinner" /> : <Save size={14} />}Guardar</button></div></div>
        {selectedPath ? <div className="code-editor-wrap"><div className="line-numbers" aria-hidden="true">{content.split('\n').map((_line, index) => <span key={index}>{index + 1}</span>)}</div><textarea className="code-editor" value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false} aria-label={`Editor ${selectedPath}`} /></div> : <EmptyState icon={<Code2 size={23} />} title="Selecciona un archivo" description="Crea un archivo o pídele a un agente con permisos que genere un proyecto en este espacio." action={<button className="button button-primary button-sm" onClick={() => void createFile()}><Plus size={15} />Crear archivo</button>} />}
      </main>
      <section className={`preview-workbench ${showPreview ? 'preview-visible' : 'preview-collapsed'}`}><div className="preview-toolbar"><div><span className="preview-live-dot" /><b>Vista previa</b><small>{previewFile?.path || 'sin HTML'}</small></div><div className="preview-actions"><button className={`icon-button ${previewWidth === 'mobile' ? 'active' : ''}`} title="Vista móvil" onClick={() => setPreviewWidth(previewWidth === 'mobile' ? 'desktop' : 'mobile')}><Maximize2 size={14} /></button><button className="icon-button" title="Actualizar vista previa" onClick={() => setPreviewVersion(Date.now())}><RefreshCw size={14} /></button>{previewUrl && <a className="icon-button" href={previewUrl} target="_blank" rel="noopener noreferrer" title="Abrir en una pestaña"><ExternalLink size={14} /></a>}<button className="icon-button" title="Ocultar vista previa" onClick={() => setShowPreview(false)}><X size={14} /></button></div></div>{previewUrl ? <div className={`preview-frame-shell preview-${previewWidth}`}><iframe key={previewVersion} src={previewUrl} title="Vista previa aislada del proyecto" sandbox="allow-scripts" referrerPolicy="no-referrer" /></div> : <div className="preview-empty"><Eye size={23} /><b>Vista previa local</b><p>Crea un archivo HTML para ejecutar el proyecto dentro de un iframe aislado.</p><button className="button button-secondary button-sm" onClick={() => void createFile()}>Crear index.html</button><small>No se publica en Internet. La ejecución está aislada y no tiene acceso a las APIs de Nexus.</small></div>}{!showPreview && <button className="preview-reopen" onClick={() => setShowPreview(true)}><Play size={14} />Ver preview</button>}</section>
    </div>
    {revisionOpen && <Modal title={`Versiones de ${selectedPath}`} description="El editor guarda versiones al guardar cambios. Restaura solo si reconoces la fecha." onClose={() => setRevisionOpen(false)}>{revisions.length ? <div className="revision-list">{revisions.map((revision) => <div key={revision.id}><span><b>{new Date(revision.created_at).toLocaleString()}</b><small>{Number(revision.bytes).toLocaleString()} caracteres</small></span><button className="button button-secondary button-sm" onClick={() => void restore(revision.id)}>Restaurar</button></div>)}</div> : <div className="empty-inline">Todavía no hay versiones guardadas.</div>}</Modal>}
  </div>;
}
