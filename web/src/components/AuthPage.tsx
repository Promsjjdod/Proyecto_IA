import { useState, type FormEvent } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { api, setCsrfToken } from '../api';
import type { User } from '../types';
import { BrandMark, ErrorBanner } from './common';

export function AuthPage({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const [register, setRegister] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const data = await api<{ user: User; csrfToken: string }>(register ? '/auth/register' : '/auth/login', {
        method: 'POST', body: JSON.stringify(register ? { name, email, password } : { email, password }),
      });
      setCsrfToken(data.csrfToken); onAuthenticated(data.user);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo iniciar sesión.'); }
    finally { setBusy(false); }
  };
  return <main className="auth-screen">
    <div className="auth-glow auth-glow-a" /><div className="auth-glow auth-glow-b" />
    <div className="auth-layout">
      <section className="auth-intro">
        <div className="brand-lockup"><BrandMark /><div><strong>NEXUS</strong><span>AI WORKSPACE</span></div></div>
        <div className="auth-headline"><div className="eyebrow"><span className="status-pulse" /> TU ESPACIO DE INTELIGENCIA</div><h1>Muchos modelos.<br /><em>Un solo lugar.</em></h1><p>Conecta tus proveedores, crea con agentes y convierte ideas en proyectos que puedes ejecutar.</p></div>
        <div className="auth-feature-list"><div><span>01</span><div><b>Tu stack, a tu manera</b><small>OpenAI, Claude, Gemini, Ollama y más.</small></div></div><div><span>02</span><div><b>De la conversación al proyecto</b><small>Archivos reales, herramientas autorizadas y preview aislado.</small></div></div><div><span>03</span><div><b>Privacidad primero</b><small>Credenciales cifradas y conversaciones separadas por cuenta.</small></div></div></div>
        <div className="auth-footer-note"><ShieldCheck size={15} /> Plataforma autoalojada · Tus claves no se exponen al navegador</div>
      </section>
      <section className="auth-card-wrap">
        <div className="auth-card">
          <div className="auth-card-top"><span className="auth-mobile-logo"><BrandMark /> NEXUS</span><div className="auth-kicker">{register ? 'EMPIEZA AQUÍ' : 'BIENVENIDO DE VUELTA'}</div><h2>{register ? 'Crea tu espacio' : 'Inicia sesión'}</h2><p>{register ? 'Configura tu cuenta para comenzar.' : 'Accede a tus proyectos y conversaciones.'}</p></div>
          {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}
          <form className="auth-form" onSubmit={submit}>
            {register && <label>Nombre completo<input required minLength={2} maxLength={80} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="¿Cómo te llamas?" /></label>}
            <label>Correo electrónico<input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" /></label>
            <label>Contraseña<input required type="password" minLength={register ? 12 : 1} maxLength={200} autoComplete={register ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={register ? 'Al menos 12 caracteres' : 'Tu contraseña'} /></label>
            <button className="button button-primary auth-submit" disabled={busy}>{busy ? <span className="spinner" /> : <>{register ? 'Crear cuenta' : 'Entrar'} <ArrowRight size={16} /></>}</button>
          </form>
          <div className="auth-divider"><span /> <small>o</small> <span /></div>
          <p className="auth-switch">{register ? '¿Ya tienes una cuenta?' : '¿Aún no tienes cuenta?'} <button onClick={() => { setRegister(!register); setError(''); }} type="button">{register ? 'Inicia sesión' : 'Crear cuenta'}</button></p>
          {register && <small className="auth-secure-note">Las cuentas nuevas empiezan como usuario normal. El administrador se configura desde el servidor.</small>}
        </div>
        <div className="auth-legal">Tus datos se almacenan en el servidor de esta instalación.</div>
      </section>
    </div>
  </main>;
}
