import { useQueue } from '../lib/useQueue.js';

// Full-screen board for a TV or tablet in the waiting area. Shows numbers only (no names).
export default function DisplayPage() {
  const { state, connected } = useQueue();
  const upcoming = state?.waitingNumbers.slice(0, 6) || [];
  return (
    <div className="display">
      <div className="display-label">Now serving</div>
      <div className="display-number">{state?.nowServing ? `#${state.nowServing}` : '—'}</div>
      <div className="display-next">
        <span>Next</span>
        {upcoming.length ? upcoming.map((n) => <b key={n}>#{n}</b>) : <em>No one waiting</em>}
      </div>
      <div className="display-foot">
        {state ? `${state.waitingCount} waiting` : ''} {connected ? '' : '· reconnecting…'}
      </div>
    </div>
  );
}
