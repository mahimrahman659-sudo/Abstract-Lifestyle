'use client';

import { useState } from 'react';
import { ProductImage } from '@/components/catalog/ProductCard';
import { cn } from '@/lib/utils/cn';

export function ProductGallery({ images, name }: { images: string[]; name: string }) {
  const [selected, setSelected] = useState(0);
  const current = images[selected] ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl border border-line bg-tile">
        <ProductImage src={current} name={name} />
      </div>
      {images.length > 1 ? (
        <ul className="flex gap-2" aria-label="Product images">
          {images.map((image, index) => (
            <li key={image}>
              <button
                type="button"
                aria-label={`View image ${index + 1}`}
                aria-current={index === selected ? 'true' : undefined}
                onClick={() => setSelected(index)}
                className={cn(
                  'relative block size-16 overflow-hidden rounded-xl border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  index === selected ? 'border-accent' : 'border-line',
                )}
              >
                <ProductImage src={image} name={`${name} thumbnail ${index + 1}`} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
