'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './probe.module.css';

const WORKER = (process.env.NEXT_PUBLIC_GAME_SERVER || 'https://cambio-game.shrysjain.workers.dev').replace(/\/$/, '');
const tests = [
  ['Direct HTTP', 'Browser → Cloudflare Worker'],
  ['HTTP relay', 'Browser → Vercel → Cloudflare Worker'],
  ['Direct WebSocket', 'Browser ↔ Cloudflare Worker'],
  ['WebSocket relay', 'Browser ↔ Vercel ↔ Cloudflare Worker'],
];
type Result = { status: 'Waiting' | 'Running' | 'Passed' | 'Failed' | 'Stopped'; detail: string };
const initial = (): Result[] => tests.map(() => ({ status: 'Waiting', detail: '' }));

async function httpProbe(url: string, signal: AbortSignal, relay: boolean) {
  const start = performance.now();
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]) });
  const body = await response.json();
  if (!response.ok || body.ok !== true || (relay ? body.via !== 'vercel' : body.service !== 'cambio')) throw new Error(body.error || `Unexpected response (${response.status})`);
  return `${Math.round(performance.now() - start)} ms round trip${relay ? ` · ${body.upstreamMs} ms Vercel → Worker` : ''}`;
}

function socketProbe(url: string, duration: number, signal: AbortSignal, progress: (detail: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    let socket: WebSocket | undefined, readyTimer: ReturnType<typeof setTimeout>, pingTimer: ReturnType<typeof setInterval>;
    let cycleTimer: ReturnType<typeof setTimeout>, replyTimer: ReturnType<typeof setTimeout>;
    let finished = false, echoes = 0, reconnects = 0, totalMs = 0;
    let pending: { id: string; at: number } | null = null;
    const start = Date.now();
    const stats = () => `${echoes} echoes · ${echoes ? Math.round(totalMs / echoes) : '—'} ms average · ${reconnects} planned reconnects`;
    function cleanConnection() { clearTimeout(readyTimer); clearTimeout(replyTimer); clearInterval(pingTimer); pending = null; }
    function finish(error?: Error) {
      if (finished) return;
      finished = true; cleanConnection(); clearTimeout(cycleTimer); clearTimeout(endTimer);
      signal.removeEventListener('abort', abort);
      socket?.close();
      if (error) reject(error); else resolve(stats());
    }
    const abort = () => finish(new Error('Stopped'));
    const endTimer = setTimeout(() => finish(echoes < 2 || pending ? new Error('Not enough confirmed echoes to pass') : undefined), duration);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    function connect() {
      if (finished) return;
      let ready = false;
      socket = new WebSocket(url);
      const current = socket;
      readyTimer = setTimeout(() => finish(new Error('Timed out waiting for the Worker connection')), 10000);
      const ping = () => {
        if (finished || pending || current.readyState !== WebSocket.OPEN) return;
        pending = { id: crypto.randomUUID(), at: performance.now() };
        current.send(JSON.stringify({ type: 'ping', id: pending.id }));
        replyTimer = setTimeout(() => finish(new Error('Worker echo timed out')), 8000);
      };
      current.onmessage = event => {
        if (finished) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'error') { finish(new Error(data.error)); return; }
          if (data.type === 'ready' && !ready) {
            ready = true; clearTimeout(readyTimer); ping(); pingTimer = setInterval(ping, 2000);
          }
          if (data.type === 'echo' && pending && data.id === pending.id && typeof data.workerTime === 'number') {
            echoes++; totalMs += performance.now() - pending.at; pending = null; clearTimeout(replyTimer);
            progress(`${Math.floor((Date.now() - start) / 1000)}s · ${stats()}`);
          }
        } catch { finish(new Error('Unexpected diagnostic response')); }
      };
      current.onerror = () => finish(new Error('WebSocket connection failed; the browser did not provide a network reason'));
      current.onclose = event => {
        if (finished) return;
        cleanConnection();
        if (event.code === 1000 && event.reason === 'Diagnostic reconnect') {
          reconnects++; cycleTimer = setTimeout(connect, 200);
        } else finish(new Error(`Connection closed (${event.code})${event.reason ? ` · ${event.reason}` : ''}`));
      };
    }
    connect();
  });
}

export default function ConnectionCheck() {
  const [results, setResults] = useState(initial);
  const [running, setRunning] = useState(false);
  const [duration, setDuration] = useState(20000);
  const [started, setStarted] = useState('');
  const [checkedDuration, setCheckedDuration] = useState(20000);
  const [copied, setCopied] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  function update(index: number, result: Result) { setResults(old => old.map((r, i) => i === index ? result : r)); }
  async function run() {
    const check = new AbortController(); controller.current = check;
    setRunning(true); setCheckedDuration(duration); setCopied(false); setStarted(new Date().toISOString()); setResults(initial());
    const wsOrigin = window.location.origin.replace(/^http/, 'ws');
    const jobs = [
      () => httpProbe(`${WORKER}/health`, check.signal, false),
      () => httpProbe('/api/connection-check/http', check.signal, true),
      () => socketProbe(`${WORKER.replace(/^http/, 'ws')}/diagnostics/echo`, duration, check.signal, detail => update(2, { status: 'Running', detail })),
      () => socketProbe(`${wsOrigin}/api/connection-check/ws`, duration, check.signal, detail => update(3, { status: 'Running', detail })),
    ];
    await Promise.all(jobs.map(async (job, i) => {
      update(i, { status: 'Running', detail: i > 1 ? 'Opening connection…' : 'Contacting server…' });
      try { update(i, { status: 'Passed', detail: await job() }); }
      catch (error) { update(i, { status: check.signal.aborted ? 'Stopped' : 'Failed', detail: check.signal.aborted ? 'Check stopped' : error instanceof Error ? error.message : 'Connection failed' }); }
    }));
    if (controller.current === check) { controller.current = null; setRunning(false); }
  }
  async function copy() {
    const report = [`Cambio connection check`, `Time: ${started}`, `Duration: ${checkedDuration / 1000}s`, `Build: ${process.env.NEXT_PUBLIC_BUILD_SHA ?? 'local'}`, `Page: ${window.location.origin}/connection-check`, `Worker: ${WORKER}`, `Browser: ${navigator.userAgent}`, ...results.map((r, i) => `${tests[i][0]}: ${r.status} — ${r.detail}`)].join('\n');
    try { await navigator.clipboard.writeText(report); setCopied(true); } catch { setCopied(false); }
  }
  return <main className={styles.page}>
    <a className={styles.back} href="/">← Cambio</a>
    <h1>Connection check</h1>
    <p className={styles.intro}>Compare direct and relayed connections. This check never joins a room or changes your game.</p>
    <div className={styles.controls}>
      <label>WebSocket check <select disabled={running} value={duration} onChange={event => setDuration(Number(event.target.value))}><option value={20000}>20 seconds</option><option value={360000}>6 minutes · stability & reconnects</option></select></label>
      <button className="button primary" disabled={running} onClick={run}>Run checks</button>
      {running && <button className="text-button" onClick={() => controller.current?.abort()}>Stop</button>}
    </div>
    <div className={styles.results} aria-live="polite" aria-atomic="false">{tests.map(([title, path], i) => <section key={title} className={styles.row}>
      <div><h2>{title}</h2><p>{path}</p><small>{results[i].detail || 'Not run yet'}</small></div>
      <span className={`${styles.status} ${results[i].status === 'Passed' ? styles.pass : results[i].status === 'Failed' ? styles.fail : ''}`}>{results[i].status}</span>
    </section>)}</div>
    <div className={styles.bottom}><p>Keep this tab open during the check. Longer checks deliberately reconnect about every 45–50 seconds.</p><button className="text-button" disabled={!started || running} onClick={copy}>{copied ? 'Copied' : 'Copy results'}</button></div>
    <p className={styles.note}>If direct tests fail but relayed tests pass, the Vercel path is a promising fallback. Passing HTTP alone does not confirm that multiplayer traffic will work.</p>
  </main>;
}
