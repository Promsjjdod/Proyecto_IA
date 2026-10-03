import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { getSSE } from '../lib/sse';
import { useApp } from '../store/app';
import { Empty, Spinner, StatusBadge, usePoll } from '../components/ui';
import { Markdown } from '../components/Markdown';
import { timeAgo } from '../lib/format';

const PHASE_ORDER = ['plan', 'analyze', 'tools', 'execute', 'verify', 'result'];

function phaseOf(step: any): string {
  if (step.phase === 'execute' && step.tool) return 'execute';
  return step.phase;
}

export function WorkPage() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [prompt, setPrompt] = useState('');
  const [agentId, setAgentId] = useState('automation');
  const [agents, setAgents] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const toast = useApp((s) => s.toast);

  const load = async () => {
    try {
      const { tasks } = await api.get('/tasks');
      setTasks(tasks);
    } catch (err) { toast(errorMessage(err), 'err'); }
  };
  usePoll(load, 4000);
  useEffect(() => { api.get('/agents').then(({ agents }) => setAgents(agents)).catch(() => undefined); }, []);

  const start = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    try {
      const { task } = await api.post('/tasks', { prompt, agentId });
      setPrompt('');
      nav(`/work/${task.id}`);
    } catch (err) {
      toast(errorMessage(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-title"><h1>WORK</h1><span className="badge accent">autonomous tasks</span></div>
      <p className="dim" style={{ maxWidth: 720, marginTop: -8 }}>
        Hand a large task to an agent. It will plan, analyze, use tools, execute and verify — showing every
        action, tool, result and error. Private model reasoning is never displayed.
      </p>

      <div className="card" style={{ marginBottom: 20 }}>
        <textarea
          className="input"
          rows={3}
          placeholder='Example: "Analyze this project and fix the failing tests" or "Refactor the upload service and add a README section"'
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="row" style={{ marginTop: 10 }}>
          <select className="input" style={{ width: 'auto' }} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.avatar} {a.name}</option>)}
          </select>
          <div className="grow" />
          <button className="btn primary" onClick={start} disabled={busy || !prompt.trim()}>
            {busy ? <Spinner label="Queuing…" /> : 'Start task ⚒'}
          </button>
        </div>
      </div>

      {!tasks.length ? (
        <Empty icon="⚒" title="No work tasks yet" body="Tasks run in phases: PLAN → ANALYZE → TOOLS → EXECUTE → VERIFY → RESULT. Start one above." />
      ) : (
        <div className="grid cols-2">
          {tasks.map((t) => (
            <button key={t.id} className="card" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => nav(`/work/${t.id}`)}>
              <div className="spread">
                <b style={{ fontSize: 14 }}>{t.title}</b>
                <StatusBadge status={t.status} />
              </div>
              <div className="dim" style={{ fontSize: 12.8, margin: '6px 0' }}>{t.prompt.slice(0, 150)}</div>
              <div className="row faint" style={{ fontSize: 11.5 }}>
                <span>{(t.steps || []).length} steps</span>·<span>{t.progress}%</span>·<span>{timeAgo(t.updatedAt)}</span>
              </div>
              <div style={{ marginTop: 8, height: 4, background: 'var(--bg-hover)', borderRadius: 4 }}>
                <div style={{ width: `${t.progress}%`, height: 4, background: t.status === 'failed' ? 'var(--err)' : 'var(--accent)', borderRadius: 4 }} />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function WorkTaskPage() {
  const { id } = useParams();
  const [task, setTask] = useState<any>(null);
  const [steps, setSteps] = useState<any[]>([]);
  const [liveTools, setLiveTools] = useState<any[]>([]);
  const nav = useNavigate();
  const toast = useApp((s) => s.toast);

  const load = async () => {
    try {
      const data = await api.get(`/tasks/${id}`);
      setTask(data.task);
      setSteps(data.steps);
    } catch (err) { toast(errorMessage(err), 'err'); }
  };

  useEffect(() => {
    load();
    const stop = getSSE(`/tasks/${id}/events`, (event, data) => {
      if (event === 'task_updated') { setTask(data.task); setSteps(data.steps || []); }
      if (event === 'step_updated') {
        setSteps((s) => s.map((x) => (x.id === data.step.id ? { ...x, ...data.step } : x)));
      }
      if (event === 'tool_event') {
        setLiveTools((t) => [...t.slice(-8), data]);
      }
    });
    const t = setInterval(load, 5000);
    return () => { stop(); clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!task) return <div className="page"><Spinner label="Loading task…" /></div>;

  const grouped = PHASE_ORDER.map((phase) => ({
    phase,
    steps: steps.filter((s) => phaseOf(s) === phase || (phase === 'tools' && s.phase === 'tools')),
  })).filter((g) => g.steps.length);

  return (
    <div className="page">
      <div className="page-title">
        <button className="btn ghost sm" onClick={() => nav('/work')}>← Work</button>
        <h1 style={{ fontSize: 18 }}>{task.title}</h1>
        <StatusBadge status={task.status} />
        <div className="grow" />
        {['queued', 'planning', 'running', 'verifying'].includes(task.status) && (
          <button className="btn danger sm" onClick={async () => { await api.post(`/tasks/${task.id}/cancel`); load(); }}>Cancel</button>
        )}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="spread" style={{ marginBottom: 8 }}>
          <span className="dim" style={{ fontSize: 13 }}>{task.prompt}</span>
          <span className="mono faint" style={{ fontSize: 12 }}>{task.progress}%</span>
        </div>
        <div style={{ height: 5, background: 'var(--bg-hover)', borderRadius: 5 }}>
          <div style={{ width: `${task.progress}%`, height: 5, background: task.status === 'failed' ? 'var(--err)' : 'var(--accent)', borderRadius: 5, transition: 'width .3s' }} />
        </div>
      </div>

      <div className="tree">
        <div className="tree-node">
          <div className="tree-head"><span className="phase-tag">task</span><b>{task.title}</b></div>
          <div className="tree-body">
            {grouped.map((g) => (
              <div key={g.phase} style={{ marginBottom: 10 }}>
                <div className="phase-tag" style={{ marginBottom: 4 }}>├── {g.phase}</div>
                {g.steps.map((s) => (
                  <div key={s.id} className="tree-node" style={{ margin: '4px 0 4px 14px' }}>
                    <div className="tree-head" style={{ padding: '7px 10px' }}>
                      <span>{s.status === 'done' ? '✅' : s.status === 'failed' ? '❌' : s.status === 'running' ? '⏳' : s.status === 'skipped' ? '' : '◻'}</span>
                      <span className="grow">{s.name}</span>
                      {s.tool ? <code className="inline">{s.tool}</code> : null}
                      <span className="faint mono" style={{ fontSize: 11 }}>{s.status}</span>
                    </div>
                    {(s.detail || s.error) && (
                      <div style={{ padding: '0 12px 10px 36px', fontSize: 12.6 }}>
                        {s.detail ? <div className="dim">{s.detail}</div> : null}
                        {s.error ? <div style={{ color: 'var(--err)' }}>{s.error}</div> : null}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {liveTools.length ? (
        <>
          <div className="section-title">Live tool activity</div>
          <div className="card">
            {liveTools.map((t, i) => (
              <div key={i} className="row" style={{ fontSize: 12.6, padding: '2px 0' }}>
                <span className={`badge ${t.phase === 'completed' ? 'ok' : t.phase === 'failed' || t.phase === 'denied' ? 'err' : 'warn'}`}>{t.phase}</span>
                <code className="inline">{t.tool}</code>
                <span className="dim grow">{t.summary || t.error || t.label || ''}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {task.result ? (
        <>
          <div className="section-title">Result</div>
          <div className="card"><Markdown text={task.result} /></div>
        </>
      ) : null}
      {task.error ? <div className="card" style={{ borderColor: 'var(--err)', marginTop: 12 }}>{task.error}</div> : null}
    </div>
  );
}
