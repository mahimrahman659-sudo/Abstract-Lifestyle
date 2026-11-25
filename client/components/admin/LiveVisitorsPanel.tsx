'use client';

import { useEffect, useRef, useState } from 'react';
import { ErrorState } from '@/components/ui/ErrorState';
import { Notice } from '@/components/ui/Notice';
import { Skeleton } from '@/components/ui/Skeleton';
import { adminApi } from '@/lib/api/admin';
import { ApiError } from '@/lib/api/client';
import type { LiveActivityDto } from '@/lib/types';
import { displayLiveMetric, sessionListMode } from '@/lib/utils/activity-metrics';

const POLL_MS = 30_000;
const STALE_AFTER_MS = 90_000;

type LiveState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: LiveActivityDto; fetchedAt: number };

const formatTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const relativeSeconds = (iso: string): string => {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
};

/**
 * Near-real-time visitor panel (plan §3.2). Auto-polls every 30s with an
 * AbortController per request; shows a staleness notice when the last
 * successful poll is older than 90s. The visitor numbers are APPROXIMATE by
 * design and must never drive urgency claims.
 *
 * States are distinct: loading (skeleton) · unavailable (error + retry) ·
 * disabled (notice + "—" metrics) · stale (notice, numbers kept).
 */
export function LiveVisitorsPanel() {
  const [state, setState] = useState<LiveState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [clientStale, setClientStale] = useState(false);
  const fetchedAtRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let inFlight: AbortController | null = null;
    const load = async (): Promise<void> => {
      // L-3: abort the previous poll before starting the next one, and stop
      // caring about responses whose request was aborted.
      inFlight?.abort();
      const controller = new AbortController();
      inFlight = controller;
      try {
        const data = await adminApi.getLiveActivity(controller.signal);
        if (!cancelled && !controller.signal.aborted) {
          fetchedAtRef.current = Date.now();
          setClientStale(false);
          setState({ status: 'success', data, fetchedAt: fetchedAtRef.current });
        }
      } catch (error) {
        if (!cancelled && !controller.signal.aborted) {
          setState({
            status: 'error',
            message: error instanceof ApiError ? error.message : 'Live activity is unavailable.',
          });
        }
      }
    };
    void load();
    const interval = setInterval(() => void load(), POLL_MS);
    // Staleness is computed inside effects (render stays pure): a poll that
    // has not succeeded for >90s marks the panel stale until the next load.
    const ticker = setInterval(() => {
      setClientStale(
        fetchedAtRef.current > 0 && Date.now() - fetchedAtRef.current > STALE_AFTER_MS,
      );
    }, 10_000);
    return () => {
      cancelled = true;
      inFlight?.abort();
      clearInterval(interval);
      clearInterval(ticker);
    };
  }, [reloadKey]);

  if (state.status === 'loading') {
    return (
      <section aria-busy="true" className="rounded-2xl border border-line bg-surface p-4">
        <Skeleton className="h-5 w-40" />
        <div className="mt-3 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <ErrorState
        title="Live activity unavailable"
        description={state.message}
        onRetry={() => setReloadKey((key) => key + 1)}
      />
    );
  }

  const { data, fetchedAt } = state;
  const isStale = clientStale || data.stale;
  const listMode = sessionListMode(data.trackingEnabled, data.sessions.length);

  return (
    <section
      aria-label="Live visitors"
      className="rounded-2xl border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-ink">Live (last 5 minutes)</h2>
        <p className="text-xs text-muted">
          updated {formatTime(new Date(fetchedAt).toISOString())}
        </p>
      </div>

      {!data.trackingEnabled ? (
        <Notice className="mt-3" tone="info">
          Activity tracking is disabled (ACTIVITY_EVENTS_ENABLED=false) — live visitor metrics
          are unavailable (shown as “—”). Cart and checkout counts remain live operational data.
        </Notice>
      ) : null}

      {isStale || data.stale ? (
        <Notice className="mt-3" tone="info">
          Data may be stale{data.stale ? ' (a query exceeded its time budget)' : ''} — showing the
          last successful refresh.
        </Notice>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Tracking-dependent metrics: real values while collecting (incl. a
            genuine 0), “—” when disabled — never a misleading zero (M-1). */}
        <StatCard
          label="Visitors"
          value={displayLiveMetric(data.trackingEnabled, data.visitors5m)}
        />
        <StatCard label="With items in cart" value={String(data.cartsWithItems)} />
        <StatCard label="Open checkouts" value={String(data.openCheckouts)} />
        <StatCard
          label="Sessions listed"
          value={displayLiveMetric(data.trackingEnabled, data.sessions.length)}
        />
      </div>

      <p className="mt-3 text-xs text-muted">
        Approximate — counts visitors with activity in the last 5 minutes; closed tabs may linger,
        bots are not filtered, this is not an exact session count. Never shown to customers.
      </p>

      {listMode === 'disabled' ? (
        <p className="mt-4 text-sm text-muted">
          Session list unavailable while tracking is disabled. Historical events remain visible in
          the feed below.
        </p>
      ) : listMode === 'empty' ? (
        <p className="mt-4 text-sm text-muted">No activity in the last 5 minutes.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {data.sessions.map((session) => (
            <li
              key={session.identity}
              className="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <span className="font-mono text-xs text-muted">{session.identity}</span>
              <span className="min-w-0 flex-1 truncate text-ink" title={session.path ?? ''}>
                {session.path ?? '—'}
              </span>
              <span className="text-xs text-muted">
                {session.events} event{session.events === 1 ? '' : 's'} ·{' '}
                {relativeSeconds(session.lastTs)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-tile px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="text-xl font-semibold text-ink">{value}</p>
    </div>
  );
}
