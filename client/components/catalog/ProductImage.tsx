'use client';

import Image from 'next/image';
import { useState } from 'react';

export interface ProductImageProps {
  src: string | null;
  name: string;
  /** Extra classes for the img (e.g. object-contain padding). */
  className?: string;
  sizes?: string;
}

/** Neutral placeholder shown when a product has no (working) image. */
function ImagePlaceholder({ name, className }: { name: string; className: string }) {
  return (
    <div
      className={`flex h-full w-full items-center justify-center bg-gradient-to-br from-tile to-cream/60 text-muted ${className}`}
      role="img"
      aria-label={`No image available for ${name}`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-10 fill-none stroke-current opacity-50"
        strokeWidth="1.1"
      >
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="9" cy="10" r="1.5" />
        <path d="m5 17 4-4 3 3 3-3 4 4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/**
 * Product image with a graceful fallback: a missing `src` **or** a failed load
 * (deleted/broken remote asset) renders the same neutral placeholder inside the
 * same sized box, so there is no broken-image icon and no layout shift.
 */
export function ProductImage({ src, name, className = '', sizes }: ProductImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) {
    return <ImagePlaceholder name={name} className={className} />;
  }

  return (
    <Image
      src={src}
      alt={name}
      fill
      sizes={sizes ?? '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw'}
      className={`object-cover ${className}`}
      onError={() => setFailedSrc(src)}
    />
  );
}
