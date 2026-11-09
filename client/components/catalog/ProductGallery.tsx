'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { ImageZoomDialog } from '@/components/catalog/ImageZoomDialog';
import { ProductImage } from '@/components/catalog/ProductCard';
import { BrandPanel } from '@/components/ui/BrandPanel';
import { cn } from '@/lib/utils/cn';

/**
 * Product image gallery: selects an image by index (0 = first), marks the
 * selected thumbnail with aria-current, supports ArrowLeft/ArrowRight/Home/End
 * among thumbnails (selection follows focus), and zooms the current image via
 * ImageZoomDialog. Handles 0 images (placeholder), 1 (no thumbnails) and many.
 */
export function ProductGallery({ images, name }: { images: string[]; name: string }) {
  const [selected, setSelected] = useState(0);
  const thumbRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = images[selected] ?? null;
  const currentAlt = images.length > 0 ? `${name} — image ${selected + 1}` : name;

  const selectThumbnail = (index: number) => {
    setSelected(index);
    thumbRefs.current[index]?.focus();
  };

  const handleThumbnailKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (images.length === 0) {
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      selectThumbnail((index + 1) % images.length);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      selectThumbnail((index - 1 + images.length) % images.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      selectThumbnail(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      selectThumbnail(images.length - 1);
    }
  };

  return (
    <div className="flex gap-3 sm:gap-4">
      {images.length > 1 ? (
        <ul className="flex w-16 shrink-0 flex-col gap-3 sm:w-[72px]" aria-label="Product images">
          {images.map((image, index) => (
            <li key={`${image}-${index}`}>
              <button
                ref={(element) => {
                  thumbRefs.current[index] = element;
                }}
                type="button"
                aria-label={`View image ${index + 1}`}
                aria-current={index === selected ? 'true' : undefined}
                tabIndex={index === selected ? 0 : -1}
                onClick={() => setSelected(index)}
                onKeyDown={(event) => handleThumbnailKeyDown(event, index)}
                className={cn(
                  'relative block aspect-[4/5] w-full overflow-hidden rounded-lg border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  index === selected ? 'border-ink' : 'border-line',
                )}
              >
                <ProductImage src={image} name={`${name} thumbnail ${index + 1}`} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="relative aspect-[4/5] w-full flex-1 overflow-hidden rounded-2xl border border-line bg-tile">
        {images.length === 0 ? (
          <BrandPanel label={`${name} — photos coming soon`} caption="Abstract Lifestyle" />
        ) : (
          <ImageZoomDialog src={current} alt={currentAlt} />
        )}
      </div>
    </div>
  );
}
