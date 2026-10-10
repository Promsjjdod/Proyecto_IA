import type { ReactNode } from 'react';
import { ArrowDownToLine, Link2, Sparkles } from 'lucide-react';
import { siAnthropic, siDeepseek, siGoogle, siOllama } from 'simple-icons';

const simpleBrand: Record<string, any> = { anthropic: siAnthropic, google: siGoogle, deepseek: siDeepseek, ollama: siOllama };
const brandColors: Record<string, string> = { openai: '#75c9a8', anthropic: '#d58a65', google: '#6da8ff', deepseek: '#5aa9ff', ollama: '#dedede' };
export function ProviderIcon({ type, size = 18, className = '' }: { type?: string; size?: number; className?: string }) {
  const key = (type || '').toLowerCase();
  const icon = simpleBrand[key];
  if (!icon) return <span className={`provider-glyph ${className}`} style={{ width: size, height: size }} aria-label={`${key || 'custom'} provider`} >{key === 'openai' ? <Sparkles size={size * 0.68} /> : <Link2 size={size * 0.68} />}</span>;
  return <svg className={`provider-brand ${className}`} width={size} height={size} role="img" aria-label={`${icon.title} icon`} viewBox="0 0 24 24" style={{ color: brandColors[key] || 'currentColor' }}><path fill="currentColor" d={icon.path} /></svg>;
}

export function BrandMark() {
  return <div className="brand-mark" aria-hidden="true"><div className="brand-mark-inner"><Sparkles size={17} strokeWidth={2.1} /></div></div>;
}

export function Modal({ title, description, onClose, children, wide = false }: { title: string; description?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`modal-card ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-head"><div><h2>{title}</h2>{description && <p>{description}</p>}</div><button className="icon-button" aria-label="Cerrar" onClick={onClose}>×</button></div>
      {children}
    </section>
  </div>;
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return <div className="error-banner" role="alert"><span>{message}</span>{onDismiss && <button className="icon-button" onClick={onDismiss} aria-label="Cerrar aviso">×</button>}</div>;
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-state-icon">{icon}</div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function FileDownloadLink({ href, children = 'Descargar' }: { href: string; children?: ReactNode }) {
  return <a className="button button-secondary button-sm" href={href}><ArrowDownToLine size={15} />{children}</a>;
}
