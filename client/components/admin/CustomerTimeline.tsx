'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Pagination } from '@/components/ui/Pagination';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/utils/cn';
import { adminApi } from '@/lib/api/admin';
import { ApiError } from '@/lib/api/client';
import type { CustomerTimelineResult } from '@/lib/types';
import { describeEvent } from './ActivityFeed';

const formatTs = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

type TimelineState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: CustomerTimelineResult };

export interface CustomerTimelineProps {
  customerId: string;
}

/**
 * Customer detail timeline (plan §3.3): two labeled streams — activity
 * events (this feature) and authoritative order status history (read from
 * `orders.statusHistory`). Date filters apply to the activity stream.
 */
export function CustomerTimeline({ customerId }: CustomerTimelineProps) {
  const [tab, setTab] = useState<'activity' | 'orders'>('activity');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState<TimelineState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      setState({ status: 'loading' });
      try {
        const data = await adminApi.getCustomerTimeline(customerId, {
          from: from ? new Date(from).toISOString() : undefined,
          to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
          page,
          limit: 25,
        });
        if (!cancelled) {
          setState({ status: 'success', data });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof ApiError ? error.message : 'Could not load the timeline.',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId, from, to, page, reloadKey]);

  if (state.status === 'loading') {
    return (
      <div aria-busy="true" className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <ErrorState
        title="Timeline unavailable"
        description={state.message}
        onRetry={() => setReloadKey((key) => key + 1)}
      />
    );
  }

  const { data } = state;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{data.user.name}</h1>
        <p className="text-sm text-muted">
          {data.user.email} · joined{' '}
          {new Date(data.user.createdAt).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </p>
      </div>

      <div role="tablist" aria-label="Customer detail" className="flex gap-1 border-b border-line">
        {(['activity', 'orders'] as const).map((value) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              'rounded-t-xl px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              tab === value ? 'bg-accent text-white' : 'text-muted hover:bg-tile hover:text-ink',
            )}
          >
            {value === 'activity' ? 'Activity' : 'Orders'}
          </button>
        ))}
      </div>

      {tab === 'activity' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="timeline-from" className="text-sm font-medium text-ink">
                From
              </label>
              <input
                id="timeline-from"
                type="date"
                value={from}
                onChange={(event) => {
                  setPage(1);
                  setFrom(event.target.value);
                }}
                className="h-11 rounded-xl border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="timeline-to" className="text-sm font-medium text-ink">
                To
              </label>
              <input
                id="timeline-to"
                type="date"
                value={to}
                onChange={(event) => {
                  setPage(1);
                  setTo(event.target.value);
                }}
                className="h-11 rounded-xl border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent"
              />
            </div>
            <p className="pb-2 text-xs text-muted">
              Timeline views may be recorded in the activity log when tracking is enabled —
              best-effort, not a guaranteed audit trail.
            </p>
          </div>

          {data.activity.items.length === 0 ? (
            <EmptyState
              title="No activity in this range"
              description="Adjust the dates, or note that collection begins once activity tracking is enabled."
            />
          ) : (
            <>
              <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
                {data.activity.items.map((event) => (
                  <li
                    key={event.id}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-sm"
                  >
                    <span className="w-36 shrink-0 font-mono text-xs text-muted">
                      {formatTs(event.ts)}
                    </span>
                    <span className="w-44 shrink-0 font-medium text-ink">{event.type}</span>
                    <span
                      className={`w-14 shrink-0 rounded px-1.5 py-0.5 text-center text-xs ${
                        event.source === 'server'
                          ? 'bg-brand/10 text-brand'
                          : 'bg-tile text-muted'
                      }`}
                    >
                      {event.source}
                    </span>
                    <span className="min-w-0 flex-1 text-muted">{describeEvent(event)}</span>
                  </li>
                ))}
              </ul>
              <Pagination
                page={data.activity.page}
                totalPages={data.activity.totalPages}
                onPageChange={setPage}
              />
              <p className="text-xs text-muted">Total events: {data.activity.total}</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-muted">
            Authoritative order history from order records — never derived from activity events.
          </p>
          {data.orderHistoryTruncated ? (
            <p className="text-xs text-muted">
              Showing the 100 most recent status changes; older entries are not displayed.
            </p>
          ) : null}
          {data.orderHistory.length === 0 ? (
            <EmptyState title="No orders yet" description="This customer has no order history." />
          ) : (
            <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
              {data.orderHistory.map((entry, index) => (
                <li
                  key={`${entry.order}-${entry.status}-${entry.at}-${index}`}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-sm"
                >
                  <span className="w-36 shrink-0 font-mono text-xs text-muted">
                    {formatTs(entry.at)}
                  </span>
                  <span className="w-44 shrink-0 font-medium capitalize text-ink">
                    {entry.status}
                  </span>
                  <span className="min-w-0 flex-1 text-muted">
                    <Link
                      href={`/admin/orders/${entry.order}`}
                      className="text-brand hover:underline"
                    >
                      {entry.orderNumber}
                    </Link>
                    {entry.by ? ' · by admin' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
