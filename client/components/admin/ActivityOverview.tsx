'use client';

import { LiveVisitorsPanel } from './LiveVisitorsPanel';
import { ActivityFeed } from './ActivityFeed';

/**
 * `/admin/activity` — live monitoring + recent feed (plan §3.2).
 * Range stat cards arrive with Phase 3 analytics; the live panel and feed
 * cover the Phase 2 MVP.
 */
export function ActivityOverview() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Activity</h1>
        <p className="text-sm text-muted">Customer Activity Center · Phase 2</p>
      </div>

      <LiveVisitorsPanel />

      <ActivityFeed />
    </div>
  );
}
