// The "now serving" strip everyone sees, logged in or not.
export default function StatusBoard({ state, connected }) {
  return (
    <section className="board" aria-live="polite">
      <div className="board-main">
        <span className="eyebrow light">Now serving</span>
        <span className="board-number">{state?.nowServing ? `#${state.nowServing}` : '—'}</span>
      </div>
      <div className="board-side">
        <div>
          <strong>{state ? state.waitingCount : '…'}</strong>
          <span>waiting</span>
        </div>
        <div>
          <strong>{state ? `~${state.avgMinutesPerPatient}` : '…'}</strong>
          <span>min / patient</span>
        </div>
      </div>
      <span className={`live ${connected ? 'on' : ''}`}>{connected ? 'Live' : 'Reconnecting…'}</span>
    </section>
  );
}
