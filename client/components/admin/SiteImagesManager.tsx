'use client';

import Image from 'next/image';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ACCEPTED_TYPES, MAX_BYTES } from '@/components/admin/ImageUploader';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Notice, type NoticeTone } from '@/components/ui/Notice';
import { Skeleton } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import { adminApi } from '@/lib/api/admin';
import { ApiError } from '@/lib/api/client';
import type { SiteImage, SiteImageKey } from '@/lib/types';

interface SlotMeta {
  key: SiteImageKey;
  label: string;
  description: string;
  aspectClass: string;
}

const SLOTS: SlotMeta[] = [
  {
    key: 'hero',
    label: 'Hero image',
    description: 'Large panel in the home page hero.',
    aspectClass: 'aspect-[4/5] sm:aspect-[16/10]',
  },
  {
    key: 'promo-1',
    label: 'Promo — wide photo',
    description: 'Wide photo in the home promo banner.',
    aspectClass: 'aspect-[3/2]',
  },
  {
    key: 'promo-2',
    label: 'Promo — portrait photo',
    description: 'Portrait photo in the home promo banner.',
    aspectClass: 'aspect-[3/4]',
  },
];

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'success'; slots: SiteImage[] };

interface ManagerNotice {
  tone: NoticeTone;
  message: string;
}

export function SiteImagesManager() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [notice, setNotice] = useState<ManagerNotice | null>(null);
  const [busyKey, setBusyKey] = useState<SiteImageKey | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const inputRefs = useRef<Partial<Record<SiteImageKey, HTMLInputElement | null>>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      setState({ status: 'loading' });
      try {
        const { items } = await adminApi.getSiteImages();
        if (!cancelled) {
          setState({ status: 'success', slots: items });
        }
      } catch {
        if (!cancelled) {
          setState({ status: 'error' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const applyItem = (item: SiteImage) => {
    setState((prev) =>
      prev.status === 'success'
        ? {
            status: 'success',
            slots: prev.slots.map((slot) => (slot.key === item.key ? item : slot)),
          }
        : prev,
    );
  };

  const handleFile = async (key: SiteImageKey, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setNotice({ tone: 'error', message: `${file.name}: only JPEG, PNG or WebP is allowed.` });
      return;
    }
    if (file.size > MAX_BYTES) {
      setNotice({ tone: 'error', message: `${file.name}: must be 5 MB or smaller.` });
      return;
    }

    setBusyKey(key);
    setNotice(null);
    try {
      const { assets } = await adminApi.uploadImages([file]);
      const asset = assets[0];
      if (!asset) {
        setNotice({ tone: 'error', message: 'Upload failed. Please try again.' });
        return;
      }
      const { item } = await adminApi.updateSiteImage(key, asset);
      applyItem(item);
      setNotice({
        tone: 'success',
        message: 'Image saved — the home page shows it within about a minute.',
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof ApiError ? error.message : 'Upload failed. Please try again.',
      });
    } finally {
      setBusyKey(null);
    }
  };

  const handleRemove = async (key: SiteImageKey) => {
    setBusyKey(key);
    setNotice(null);
    try {
      const { item } = await adminApi.updateSiteImage(key, null);
      applyItem(item);
      setNotice({
        tone: 'info',
        message: 'Image removed — the storefront placeholder is shown again.',
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof ApiError ? error.message : 'Could not remove the image.',
      });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Site images</h1>
        <p className="mt-1 text-sm text-muted">
          Marketing photos for the home page. Uploaded images replace the placeholders without a
          redeploy; removing one falls back to the placeholder.
        </p>
      </div>

      {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}

      {state.status === 'loading' ? (
        <div className="grid gap-4 md:grid-cols-3">
          {SLOTS.map((slot) => (
            <div key={slot.key} className="rounded-xl border border-line bg-surface p-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-2 h-3 w-48" />
              <Skeleton className={`mt-3 w-full rounded-lg ${slot.aspectClass}`} />
              <Skeleton className="mt-3 h-8 w-28" />
            </div>
          ))}
        </div>
      ) : null}

      {state.status === 'error' ? (
        <ErrorState
          title="Could not load site images"
          description="Please refresh the page in a moment."
          onRetry={() => setReloadKey((key) => key + 1)}
        />
      ) : null}

      {state.status === 'success' ? (
        <div className="grid gap-4 md:grid-cols-3">
          {SLOTS.map((meta) => {
            const slot = state.slots.find((item) => item.key === meta.key);
            const busy = busyKey === meta.key;
            return (
              <div key={meta.key} className="rounded-xl border border-line bg-surface p-4">
                <h2 className="text-sm font-semibold text-ink">{meta.label}</h2>
                <p className="mt-1 text-xs text-muted">{meta.description}</p>

                <div
                  className={`relative mt-3 w-full overflow-hidden rounded-lg bg-tile ${meta.aspectClass}`}
                >
                  {slot?.image ? (
                    <Image
                      src={slot.image.url}
                      alt={meta.label}
                      fill
                      sizes="(max-width: 768px) 100vw, 33vw"
                      className="object-cover"
                    />
                  ) : (
                    <p
                      role="img"
                      aria-label={`No ${meta.label.toLowerCase()} uploaded yet`}
                      className="grid h-full place-items-center px-4 text-center text-xs text-muted"
                    >
                      No image — the storefront placeholder is shown.
                    </p>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    ref={(element) => {
                      inputRefs.current[meta.key] = element;
                    }}
                    id={`site-image-${meta.key}`}
                    type="file"
                    accept={ACCEPTED_TYPES.join(',')}
                    className="sr-only"
                    onChange={(event) => void handleFile(meta.key, event)}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busyKey !== null}
                    onClick={() => inputRefs.current[meta.key]?.click()}
                  >
                    {busy ? 'Saving…' : slot?.image ? 'Replace image' : 'Upload image'}
                  </Button>
                  {slot?.image ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busyKey !== null}
                      onClick={() => void handleRemove(meta.key)}
                    >
                      Remove
                    </Button>
                  ) : null}
                  {busy ? <Spinner label="Saving image" /> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}