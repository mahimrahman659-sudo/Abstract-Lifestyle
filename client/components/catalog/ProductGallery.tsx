'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { ImageZoomDialog } from '@/components/catalog/ImageZoomDialog';
import { ProductImage } from '@/components/catalog/ProductCard';
import { BrandPanel } from '@/components/ui/BrandPanel';
import { cn } from '@/lib/utils/cn';

/** How many thumbnails fit before the column starts scrolling (see class below). */

interface ThumbnailListProps {
  images: string[];
  name: string;
  selected: number;
  onSelect: (index: number) => void;
  className: string;
  label: string;
}

/**
 * Thumbnail buttons shared by the desktop column and the mobile swipe strip.
 * Each instance keeps its own roving-tabindex refs (Arrow/Home/End move the
 * selection and the focus within that list).
 */
function ThumbnailList({ images, name, selected, onSelect, className, label }: ThumbnailListProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (index: number) => {
    onSelect(index);
    refs.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (images.length === 0) {
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      select((index + 1) % images.length);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      select((index - 1 + images.length) % images.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      select(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      select(images.length - 1);
    }
  };

  return (
    <ul className={className} aria-label={label}>
      {images.map((image, index) => (
        <li key={`${image}-${index}`} className="shrink-0 snap-start">
          <button
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            aria-label={`View image ${index + 1}`}
            aria-current={index === selected ? 'true' : undefined}
            tabIndex={index === selected ? 0 : -1}
            onClick={() => onSelect(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'relative block h-20 w-16 overflow-hidden rounded-lg border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:h-[88px] sm:w-full',
              index === selected ? 'border-ink' : 'border-line',
            )}
          >
            <ProductImage src={image} name={`${name} thumbnail ${index + 1}`} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Product image gallery: selects an image by index (0 = first), marks the
 * selected thumbnail with aria-current and supports Arrow keys / Home / End.
 *
 * - Desktop/tablet: vertical thumbnail column, showing up to 5 at once and
 *   scrolling when a product has more.
 * - Mobile: horizontal swipe strip (scroll-snap) under the main image.
 * - Zoom dialog on the current image; placeholder when there are no images.
 */
export function ProductGallery({ images, name }: { images: string[]; name: string }) {
  const [selected, setSelected] = useState(0);
  const current = images[selected] ?? null;
  const currentAlt = images.length > 0 ? `${name} — image ${selected + 1}` : name;

  return (
    <div>
      <div className="flex gap-3 sm:gap-4">
        {images.length > 1 ? (
          <ThumbnailList
            images={images}
            name={name}
            selected={selected}
            onSelect={setSelected}
            label="Product images"
            className="hidden max-h-[488px] w-[72px] shrink-0 flex-col gap-3 overflow-y-auto overscroll-contain sm:flex"
          />
        ) : null}

        <div className="relative aspect-[4/5] w-full flex-1 overflow-hidden rounded-2xl border border-line bg-tile">
          {images.length === 0 ? (
            <BrandPanel label={`${name} — photos coming soon`} caption="Abstract Lifestyle" />
          ) : (
            <ImageZoomDialog src={current} alt={currentAlt} />
          )}
        </div>
      </div>

      {/* Mobile: swipeable strip of thumbnails (up to 5 visible; scrolls beyond). */}
      {images.length > 1 ? (
        <ThumbnailList
          images={images}
          name={name}
          selected={selected}
          onSelect={setSelected}
          label="Product images"
          className="mt-3 flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain pb-1 sm:hidden"
        />
      ) : null}
    </div>
  );
}

