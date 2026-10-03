import React, { useEffect, useRef, useState } from 'react';
import { Braces, RefreshCw, X } from 'lucide-react';
import './usage-debug.css';

const categories = [
  { id: 'jev', label: 'Jev' },
  { id: 'llm', label: 'Thinking / LLM' },
  { id: 'voice', label: 'Voice' },
];
const hasAmount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const usd = value => value.toLocaleString('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 20,
});
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;

function Spend({ usage }) {
  if (!usage || !count(usage.requests)) return <span className="usage-unavailable">Unavailable</span>;
  if (usage.complete === true && hasAmount(usage.exactUsd)) return <><strong>{usd(usage.exactUsd)}</strong><small>Provider-reported</small></>;
  return <>
    {count(usage.estimatedRequests) > 0 && hasAmount(usage.estimatedUsd)
      ? <><strong>≈ {usd(usage.estimatedUsd)}</strong><small>{usage.estimateComplete ? 'Estimated usage cost' : 'Partial estimate'}</small></>
      : <span className="usage-unavailable">Unavailable</span>}
    {count(usage.reportedCostRequests) > 0 && hasAmount(usage.providerReportedUsd) && <small>{usd(usage.providerReportedUsd)} partial</small>}
  </>;
}

function UsageUnits({ usage }) {
  const units = usage?.units || {}, parts = [];
  if (hasAmount(units.inputTokens)) parts.push(`${units.inputTokens.toLocaleString()} input tokens`);
  if (hasAmount(units.outputTokens)) parts.push(`${units.outputTokens.toLocaleString()} output tokens`);
  if (hasAmount(units.characters)) parts.push(`${units.characters.toLocaleString()} characters sent`);
  if (hasAmount(units.audioInputMs)) parts.push(`${(units.audioInputMs / 1000).toFixed(1)}s audio sent`);
  if (hasAmount(units.audioOutputMs)) parts.push(`${(units.audioOutputMs / 1000).toFixed(1)}s audio generated`);
  if (hasAmount(units.sessionDurationMs)) parts.push(`${(units.sessionDurationMs / 1000).toFixed(1)}s GPT-Live session`);
  return parts.length ? <small>{parts.join(' · ')}</small> : null;
}

function Coverage({ usage }) {
  const requests = count(usage?.requests);
  if (!requests) return 'No requests yet';
  const unpriced = count(usage?.unpricedRequests);
  const pending = count(usage?.pendingRequests);
  return `${requests} request${requests === 1 ? '' : 's'}${pending ? ` · ${pending} pending` : ''}${count(usage?.unestimatedRequests) ? ` · ${usage.unestimatedRequests} unestimated` : ''}${count(usage?.missingUsageRequests) ? ` · ${usage.missingUsageRequests} missing usage` : ''}${unpriced ? ` · ${unpriced} without billed cost` : ''}`;
}

function since(value) {
  const date = value && new Date(value);
  return date && Number.isFinite(date.getTime())
    ? date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;
}

function useDebugData(endpoint, testId, enabled, refresh) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setData(null);
    setError('');
    setLoading(true);
  }, [testId]);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false, pending = false;
    const controller = new AbortController();
    setError('');
    setLoading(true);
    async function load() {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const response = await fetch(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ testId }), signal: controller.signal,
        });
        const value = await response.json();
        if (!response.ok) throw Error(value.error || 'Could not read debug data for this test.');
        if (value.testId !== testId) throw Error('Debug data did not match this test.');
        if (!disposed) { setData(value); setError(''); }
      } catch (err) {
        if (!disposed && !controller.signal.aborted) setError(err.message || 'Could not read debug data for this test.');
      } finally {
        pending = false;
        if (!disposed) setLoading(false);
      }
    }
    void load();
    const timer = setInterval(load, 3000);
    document.addEventListener('visibilitychange', load);
    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
      controller.abort();
    };
  }, [endpoint, testId, enabled, refresh]);
  return { data: data?.testId === testId ? data : null, error, loading };
}

function Activity({ data }) {
  const events = (data.events || []).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return <>
    <p className="usage-activity-note">{events.length} recorded event{events.length === 1 ? '' : 's'}{data.truncated ? ' · Recent events only' : ''}</p>
    {typeof data.storageError === 'string' && data.storageError && <p className="usage-message" role="alert">{data.storageError}</p>}
    {!events.length && <p className="usage-message">New imports, tutor requests, and whiteboard decisions will appear here as they happen.</p>}
    <ol className="usage-events">
      {events.map(event => <li key={event.id}>
        <div className="usage-event-heading">
          <span>{String(event.type || 'event').replaceAll(/[_.:-]/g, ' ')}</span>
          <time dateTime={event.at} title={event.at}>{new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
        </div>
        <span className="usage-event-origin">{event.origin}</span>
        <details className="usage-event-details">
          <summary>Event details</summary>
          <pre>{JSON.stringify({ at: event.at, sessionId: event.sessionId, turnId: event.turnId, ...event.details }, null, 2)}</pre>
        </details>
      </li>)}
    </ol>
    <footer className="usage-activity-footer">
      <p>Events are recorded from this update onward. Source text and credentials are not included.</p>
      {typeof data.measurement === 'string' && data.measurement && <p>{data.measurement}</p>}
    </footer>
  </>;
}

export default function UsageDebug({ testId, onClose }) {
  const dialog = useRef(null);
  const [tab, setTab] = useState('usage');
  const [refresh, setRefresh] = useState(0);
  const usage = useDebugData('/api/debug/usage', testId, tab === 'usage', refresh);
  const activity = useDebugData('/api/debug/activity', testId, tab === 'activity', refresh);
  const { data, error, loading } = tab === 'usage' ? usage : activity;
  useEffect(() => {
    const element = dialog.current;
    if (!element.open) element.showModal();
    return () => { if (element.open) element.close(); };
  }, []);

  const started = since(data?.trackingStartedAt);
  const totals = data?.totals;
  return <dialog ref={dialog} className="usage-debug" aria-label="Test usage and activity debug" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <header>
      <div><span className="usage-eyebrow"><Braces size={12}/>Development only</span><h2>Test usage</h2></div>
      <button className="icon-button" onClick={onClose} aria-label="Close test usage"><X size={17}/></button>
    </header>
    <div className="usage-tabs" aria-label="Debug view">
      <button aria-pressed={tab === 'usage'} onClick={() => setTab('usage')}>Spend</button>
      <button aria-pressed={tab === 'activity'} onClick={() => setTab('activity')}>Activity</button>
    </div>
    <p className="usage-explanation">{tab === 'usage' ? 'Costs for this test in USD. Estimates use documented API rates and measured usage; they are not your invoice. Missing usage stays visible, never assumed free.' : 'A timeline of this test’s imports, tutor calls, and whiteboard decisions. Expand an event to inspect what happened.'}</p>
    <div className="usage-period">
      <span>{started ? `Tracked since ${started}` : 'Tracking starts with new events'}</span>
      <button className="icon-button" onClick={() => setRefresh(value => value + 1)} aria-label={tab === 'usage' ? 'Refresh test usage' : 'Refresh test activity'}><RefreshCw size={14}/></button>
    </div>
    {error && <p className="usage-message" role="alert">{error}{data ? ' Showing the last successful update.' : ''}</p>}
    {loading && !data && <p className="usage-message" role="status">Loading {tab === 'usage' ? 'usage' : 'activity'}…</p>}
    {data && tab === 'activity' && <Activity data={data}/>}
    {data && tab === 'usage' && <>
      {['read-error','write-error'].includes(data.storage?.status) && <p className="usage-message" role="alert">Usage is currently held in memory because the ledger could not be {data.storage.status === 'read-error' ? 'read. The existing file is preserved.' : 'saved. Saving will retry automatically.'} Keep the app open until saving recovers.</p>}
      {count(data.unattributed?.requests) > 0 && <p className="usage-message">{data.unattributed.requests} app request(s) have no test assignment. They are recorded separately in Usage details and are excluded from this test’s total.</p>}
      <div className="usage-columns" aria-hidden="true"><span>Service</span><span>Usage cost</span></div>
      <dl className="usage-rows">
        {categories.map(category => {
          const usage = data.categories?.find(item => item.id === category.id);
          return <div className="usage-row" key={category.id}>
            <dt>{category.label}<small><Coverage usage={usage}/></small><UsageUnits usage={usage}/></dt>
            <dd><Spend usage={usage}/></dd>
          </div>;
        })}
        <div className="usage-row usage-total">
          <dt>Total<small><Coverage usage={totals}/></small></dt>
          <dd><Spend usage={totals}/></dd>
        </div>
      </dl>
      <details className="usage-details">
        <summary>Usage details</summary>
        <pre>{JSON.stringify({ testId: data.testId, scope: data.scope, trackingStartedAt: data.trackingStartedAt, totals, categories: data.categories, unattributed: data.unattributed, storage: data.storage }, null, 2)}</pre>
      </details>
      <details className="usage-details">
        <summary>Pricing sources and assumptions</summary>
        {(totals?.estimateSources || []).map(rate => <div className="usage-rate" key={rate.rateId}>
          <a href={rate.source} target="_blank" rel="noreferrer">{rate.rateId}</a>
          <small>Verified {rate.verifiedAt}</small>
          {(rate.notes || []).map((note,index) => <p key={index}>{note}</p>)}
        </div>)}
        {!totals?.estimateSources?.length && <p className="usage-message">No supported rate and usage combination has been recorded yet.</p>}
      </details>
      <footer>
        <p>Earlier usage is not reconstructed. Updates every 3 seconds while this panel is open.</p>
        {(data.notes || []).map((note, index) => <p key={index}>{note}</p>)}
      </footer>
    </>}
  </dialog>;
}
