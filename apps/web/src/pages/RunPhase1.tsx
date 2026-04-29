import { Phase1RunCard } from '../components/Phase1RunCard';

export function RunPhase1() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Run Phase 1</h1>
          <p className="page-subtitle">Launch a monitored collection run without opening the admin-only control plane.</p>
        </div>
      </div>

      <div className="responsive-grid" style={{ gridTemplateColumns: 'minmax(320px, 760px)' }}>
        <Phase1RunCard
          title="Queue Phase 1 Run"
          subtitle="Pick a subreddit, choose live or backfill, and submit a bounded run with the same backend contract used by the admin console."
        />
      </div>
    </div>
  );
}
