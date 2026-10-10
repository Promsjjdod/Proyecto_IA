import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import { db } from '../db.js';
import { PROJECT_DIR, UPLOAD_DIR } from '../config.js';
import { requireAuth, type AuthRequest } from '../auth.js';
import { ownedProject, listProjectFiles, readProjectFile, writeProjectFile, createProjectFolder, deleteProjectEntry, renameProjectEntry, cleanRelativePath, projectFilePath, assertProjectStorage } from './paths.js';

const router = Router();
router.use(requireAuth);

function projectDto(row: any) { return { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at }; }
function fileType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.xml': 'application/xml; charset=utf-8' };
  return map[ext] || 'text/plain; charset=utf-8';
}
function assertPreviewFile(relative: string) {
  const ext = path.extname(relative).toLowerCase();
  const allowed = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.woff', '.woff2', '.ttf', '.ico']);
  if (!allowed.has(ext)) throw Object.assign(new Error('Tipo de archivo no disponible en la vista previa.'), { status: 415 });
}

router.get('/', (req: AuthRequest, res) => {
  const rows = db.prepare('SELECT * FROM projects WHERE user_id=? ORDER BY updated_at DESC').all(req.user!.id) as any[];
  res.json(rows.map(projectDto));
});
router.post('/', (req: AuthRequest, res) => {
  const name = String(req.body?.name || '').trim();
  if (name.length < 1 || name.length > 100) return res.status(400).json({ error: 'El nombre debe tener entre 1 y 100 caracteres.' });
  const projectCount = (db.prepare('SELECT COUNT(*) AS count FROM projects WHERE user_id=?').get(req.user!.id) as { count: number }).count;
  if (projectCount >= 25) return res.status(429).json({ error: 'Cada cuenta puede tener hasta 25 proyectos.' });
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO projects(id,user_id,name,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, req.user!.id, name, now, now);
  fs.mkdirSync(path.join(PROJECT_DIR, req.user!.id, id), { recursive: true, mode: 0o700 });
  res.status(201).json(projectDto(db.prepare('SELECT * FROM projects WHERE id=?').get(id)));
});
router.patch('/:projectId', (req: AuthRequest, res) => {
  const { project } = ownedProject(req.user!.id, req.params.projectId);
  const name = String(req.body?.name || '').trim();
  if (!name || name.length > 100) return res.status(400).json({ error: 'El nombre debe tener entre 1 y 100 caracteres.' });
  db.prepare('UPDATE projects SET name=?,updated_at=? WHERE id=? AND user_id=?').run(name, new Date().toISOString(), project.id, req.user!.id);
  res.json(projectDto(db.prepare('SELECT * FROM projects WHERE id=?').get(project.id)));
});
router.delete('/:projectId', (req: AuthRequest, res) => {
  const { project, root } = ownedProject(req.user!.id, req.params.projectId);
  if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirma la eliminación.' });
  db.prepare('DELETE FROM projects WHERE id=? AND user_id=?').run(project.id, req.user!.id);
  fs.rmSync(root, { recursive: true, force: true });
  res.json({ ok: true });
});

router.get('/:projectId/files', (req: AuthRequest, res, next) => {
  try { const { root } = ownedProject(req.user!.id, req.params.projectId); res.json(listProjectFiles(root)); }
  catch (error) { next(error); }
});
router.get('/:projectId/file', (req: AuthRequest, res, next) => {
  try { res.json(readProjectFile(req.user!.id, req.params.projectId, String(req.query.path || ''))); }
  catch (error) { next(error); }
});
router.put('/:projectId/file', (req: AuthRequest, res, next) => {
  try {
    const result = writeProjectFile(req.user!.id, req.params.projectId, String(req.body?.path || ''), req.body?.content);
    res.json(result);
  } catch (error) { next(error); }
});
router.post('/:projectId/folder', (req: AuthRequest, res, next) => {
  try { res.status(201).json(createProjectFolder(req.user!.id, req.params.projectId, String(req.body?.path || ''))); }
  catch (error) { next(error); }
});
router.post('/:projectId/rename', (req: AuthRequest, res, next) => {
  try { res.json(renameProjectEntry(req.user!.id, req.params.projectId, String(req.body?.from || ''), String(req.body?.to || ''))); }
  catch (error) { next(error); }
});
router.delete('/:projectId/entry', (req: AuthRequest, res, next) => {
  try {
    if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirma la eliminación del archivo o carpeta.' });
    res.json(deleteProjectEntry(req.user!.id, req.params.projectId, String(req.body?.path || ''), req.body?.recursive === true));
  } catch (error) { next(error); }
});
router.get('/:projectId/revisions', (req: AuthRequest, res, next) => {
  try {
    ownedProject(req.user!.id, req.params.projectId);
    const relative = cleanRelativePath(req.query.path);
    const rows = db.prepare('SELECT id,relative_path,created_at,length(content) bytes FROM file_revisions WHERE project_id=? AND user_id=? AND relative_path=? ORDER BY created_at DESC LIMIT 25').all(req.params.projectId, req.user!.id, relative);
    res.json(rows);
  } catch (error) { next(error); }
});
router.post('/:projectId/revisions/:revisionId/restore', (req: AuthRequest, res, next) => {
  try {
    if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirma la restauración de esta versión.' });
    ownedProject(req.user!.id, req.params.projectId);
    const revision = db.prepare('SELECT * FROM file_revisions WHERE id=? AND project_id=? AND user_id=?').get(req.params.revisionId, req.params.projectId, req.user!.id) as any;
    if (!revision) return res.status(404).json({ error: 'Versión no encontrada.' });
    res.json(writeProjectFile(req.user!.id, req.params.projectId, revision.relative_path, revision.content));
  } catch (error) { next(error); }
});
router.get('/:projectId/download', (req: AuthRequest, res, next) => {
  try {
    const { project, root } = ownedProject(req.user!.id, req.params.projectId);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${project.name.replace(/[^\w.-]+/g, '_')}.zip"`);
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', next);
    archive.pipe(res);
    archive.glob('**/*', { cwd: root, dot: true, ignore: ['.git/**', '.env', '**/.env', '**/.git/**', '**/node_modules/**'] });
    void archive.finalize();
  } catch (error) { next(error); }
});
router.get('/:projectId/download-file', (req: AuthRequest, res, next) => {
  try {
    const { root } = ownedProject(req.user!.id, req.params.projectId);
    const { absolute, relative } = projectFilePath(root, String(req.query.path || ''));
    const stat = fs.statSync(absolute);
    if (!stat.isFile() || stat.size > 20_000_000) return res.status(413).json({ error: 'El archivo no se puede descargar o supera 20 MB.' });
    res.download(absolute, path.basename(relative));
  } catch (error) { next(error); }
});
router.post('/:projectId/import-image', (req: AuthRequest, res, next) => {
  try {
    const { root } = ownedProject(req.user!.id, req.params.projectId);
    const image = db.prepare('SELECT * FROM images WHERE id=? AND user_id=?').get(String(req.body?.imageId || ''), req.user!.id) as any;
    if (!image) return res.status(404).json({ error: 'Imagen no encontrada.' });
    const source = path.join(UPLOAD_DIR, req.user!.id, image.relative_path);
    if (!fs.existsSync(source)) return res.status(404).json({ error: 'El archivo de imagen no está disponible.' });
    const sourceStat = fs.statSync(source);
    if (!sourceStat.isFile()) return res.status(404).json({ error: 'El archivo de imagen no está disponible.' });
    const folder = path.join(root, 'assets');
    const destinationName = `generated-${image.id}.png`;
    assertProjectStorage(root, `assets/${destinationName}`, sourceStat.size);
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    fs.copyFileSync(source, path.join(folder, destinationName), fs.constants.COPYFILE_EXCL);
    res.status(201).json({ path: `assets/${destinationName}` });
  } catch (error) { next(error); }
});

// Every preview resource is served only after authenticating the owner. The iframe uses sandbox="allow-scripts"
// (never allow-same-origin) and this restrictive CSP; generated scripts cannot reach application APIs.
router.use('/:projectId/preview', (req: AuthRequest, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).end();
  try {
    const relative = cleanRelativePath(req.url.split('?')[0].replace(/^\//, '') || 'index.html');
    assertPreviewFile(relative);
    const { root } = ownedProject(req.user!.id, req.params.projectId);
    const { absolute } = projectFilePath(root, relative);
    const stat = fs.statSync(absolute);
    if (!stat.isFile() || stat.size > 20_000_000) return res.status(413).end('Preview resource too large.');
    res.setHeader('Content-Type', fileType(relative));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' data:; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; frame-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'");
    res.setHeader('Referrer-Policy', 'no-referrer');
    fs.createReadStream(absolute).pipe(res);
  } catch (error) { next(error); }
});

export default router;
