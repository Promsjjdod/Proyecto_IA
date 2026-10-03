import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ChatPage } from './pages/ChatPage';
import { useApp } from './store/app';
import { api } from './lib/api';

const WorkPage = lazy(() => import('./pages/WorkPage').then((m) => ({ default: m.WorkPage })));
const WorkTaskPage = lazy(() => import('./pages/WorkPage').then((m) => ({ default: m.WorkTaskPage })));
const AgentsPage = lazy(() => import('./pages/AgentsPage').then((m) => ({ default: m.AgentsPage })));
const AgentEditorPage = lazy(() => import('./pages/AgentsPage').then((m) => ({ default: m.AgentEditorPage })));
const PluginsPage = lazy(() => import('./pages/PluginsPage').then((m) => ({ default: m.PluginsPage })));
const FilesPage = lazy(() => import('./pages/FilesPage').then((m) => ({ default: m.FilesPage })));
const ImagesPage = lazy(() => import('./pages/ImagesPage').then((m) => ({ default: m.ImagesPage })));
const VideoPage = lazy(() => import('./pages/VideoPage').then((m) => ({ default: m.VideoPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const StatusPage = lazy(() => import('./pages/StatusPage').then((m) => ({ default: m.StatusPage })));
const AboutPage = lazy(() => import('./pages/AboutPage').then((m) => ({ default: m.AboutPage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));

function Fallback() {
  return <div className="page" style={{ display: 'grid', placeItems: 'center', height: '60vh' }}><span className="spinner" /></div>;
}

export default function App() {
  const [authState, setAuthState] = useState<'loading' | 'login' | 'ok'>('loading');

  useEffect(() => {
    useApp.getState().applyAppearance();
    api.get('/auth/me')
      .then((me) => setAuthState(me.authenticated === false && me.authRequired ? 'login' : 'ok'))
      .catch((err) => setAuthState(err?.status === 401 ? 'login' : 'ok')); // 401 = login needed; offline = show UI with error states
  }, []);

  if (authState === 'loading') return <Fallback />;
  if (authState === 'login') {
    return (
      <Suspense fallback={<Fallback />}>
        <LoginPage />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<Fallback />}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<ChatPage />} />
          <Route path="/chat/:id" element={<ChatPage />} />
          <Route path="/work" element={<WorkPage />} />
          <Route path="/work/:id" element={<WorkTaskPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agents/:id" element={<AgentEditorPage />} />
          <Route path="/plugins" element={<PluginsPage />} />
          <Route path="/files" element={<FilesPage />} />
          <Route path="/images" element={<ImagesPage />} />
          <Route path="/video" element={<VideoPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
