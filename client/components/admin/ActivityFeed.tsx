'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Pagination } from '@/components/ui/Pagination';
import { Skeleton } from '@/components/ui/Skeleton';
import { adminApi } from '@/lib/api/admin';
import { ApiError } from '@/lib/api/client';
import type { ActivityEventDto, ActivityFeedPage } from '@/lib/types';
import { customerEventLink } from '@/lib/utils/activity-metrics';
import { formatPoisha } from '@/lib/utils/money';

const FEED_TYPES = [
  '',
  'page.view',
  'product.view',
  'search.performed',
  'cart.add',
  'checkout.started',
  'order.purchased',
  'order.cancelled',
  'auth.login',
  'admin.customer_viewed',
] as const;

const formatTs = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

export const describeEvent = (event: ActivityEventDto): string => {
  switch (event.type) {
    case 'order.purchased':
      // L-2: shared money formatter (৳ + locale grouping), never hand-rolled.
      return `order total ${formatPoisha(event.value ?? 0)}${event.orderId ? ` · ${event.orderId.slice(-6)}` : ''}`;
    case 'order.cancelled':
    case 'admin.order_status_changed':
      return event.orderId ? `order …${event.orderId.slice(-6)}` : '';
    case 'admin.customer_viewed':
      return 'customer detail viewed';
    case 'page.view':
    case 'product.view':
    case 'checkout.viewed':
      return event.path ?? '';
    case 'search.performed':
      return event.query ? `“${event.query}”` : '';
    case 'cart.add':
    case 'cart.update':
    case 'cart.remove':
      return event.quantity !== undefined ? `quantity ${event.quantity}` : '';
    default:
      return event.path ?? '';
  }
};

type FeedState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: ActivityFeedPage };

export interface ActivityFeedProps {
  /** Extra filter row omitted on embedded surfaces. */
  showHeading?: boolean;
}

export function ActivityFeed({ showHeading = true }: ActivityFeedProps) {
  const [type, setType] = useState<(typeof FEED_TYPES)[number]>('');
  const [source, setSource] = useState<'' | 'client' | 'server'>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState<FeedState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      setState({ status: 'loading' });
      try {
        const data = await adminApi.listRecentActivity({
          type: type || undefined,
          source: source || undefined,
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
            message: error instanceof ApiError ? error.message : 'Could not load activity.',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [type, source, from, to, page, reloadKey]);

  return (
    <section aria-label="Recent activity" className="space-y-4">
      {showHeading ? (
        <h2 className="text-base font-semibold text-ink">Recent activity</h2>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="activity-type" className="text-sm font-medium text-ink">
            Type
          </label>
          <select
            id="activity-type"
            value={type}
            onChange={(event) => {
              setPage(1);
              setType(event.target.value as (typeof FEED_TYPES)[number]);
            }}
            className="h-11 w-52 rounded-xl border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            {FEED_TYPES.map((value) => (
              <option key={value} value={value}>
                {value === '' ? 'All types' : value}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="activity-source" className="text-sm font-medium text-ink">
            Source
          </label>
          <select
            id="activity-source"
            value={source}
            onChange={(event) => {
              setPage(1);
              setSource(event.target.value as '' | 'client' | 'server');
            }}
            className="h-11 w-36 rounded-xl border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            <option value="">All sources</option>
            <option value="client">client</option>
            <option value="server">server</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="activity-from" className="text-sm font-medium text-ink">
            From
          </label>
          <input
            id="activity-from"
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
          <label htmlFor="activity-to" className="text-sm font-medium text-ink">
            To
          </label>
          <input
            id="activity-to"
            type="date"
            value={to}
            onChange={(event) => {
              setPage(1);
              setTo(event.target.value);
            }}
            className="h-11 rounded-xl border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent"
          />
        </div>
      </div>

      {state.status === 'loading' ? (
        <div aria-busy="true" className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : state.status === 'error' ? (
        <ErrorState
          title="Activity feed unavailable"
          description={state.message}
          onRetry={() => setReloadKey((key) => key + 1)}
        />
      ) : state.data.items.length === 0 ? (
        <EmptyState
          title="No activity yet"
          description="Nothing matches these filters. Events appear once activity tracking is enabled and generating data."
        />
      ) : (
        <>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
            {state.data.items.map((event) => {
              // L-1: customer links only for customer-actor events (or the
              // viewed customer on admin.customer_viewed) — never an admin id
              // mislabeled as "customer".
              const customerLink = customerEventLink(event);
              return (
                <li
                  key={event.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-sm"
                >
                  <span className="w-16 shrink-0 font-mono text-xs text-muted">
                    {formatTs(event.ts)}
                  </span>
                  <span className="w-44 shrink-0 font-medium text-ink">{event.type}</span>
                  <span
                    className={`w-14 shrink-0 rounded px-1.5 py-0.5 text-center text-xs ${
                      event.source === 'server' ? 'bg-brand/10 text-brand' : 'bg-tile text-muted'
                    }`}
                  >
                    {event.source}
                  </span>
                  <span className="min-w-0 flex-1 text-muted">
                    {describeEvent(event)}
                    {customerLink ? (
                      <Link
                        href={customerLink.href}
                        className="ml-2 text-brand hover:underline"
                      >
                        {customerLink.label}
                      </Link>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
          <Pagination
            page={state.data.page}
            totalPages={state.data.totalPages}
            onPageChange={setPage}
          />
          <p className="text-xs text-muted">Total events: {state.data.total}</p>
        </>
      )}
    </section>
  );
}
