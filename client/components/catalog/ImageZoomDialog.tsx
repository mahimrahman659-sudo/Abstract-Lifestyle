'use client';

import { useRef } from 'react';
import { ProductImage } from '@/components/catalog/ProductCard';
import { Button } from '@/components/ui/Button';
import { SearchIcon } from '@/components/ui/icons';

interface ImageZoomDialogProps {
  src: string | null;
  alt: string;
}

/**
 * Zoomable product image: clicking the image (or the magnifier button) opens a
 * native modal <dialog> (Escape closes, focus is trapped and restored) showing
 * the large image with its alt text. Built like SizeGuideDialog.
 */
export function ImageZoomDialog({ src, alt }: ImageZoomDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        aria-label={`Zoom image: ${alt}`}
        onClick={() => dialogRef.current?.showModal()}
        className="block h-full w-full cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <ProductImage src={src} name={alt} />
      </button>
      <button
        type="button"
        aria-label={`Zoom image: ${alt}`}
        onClick={() => dialogRef.current?.showModal()}
        className="absolute bottom-4 right-4 grid size-10 place-items-center rounded-full bg-white text-ink shadow-md transition-colors hover:bg-tile focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <SearchIcon className="size-4" />
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby="image-zoom-title"
        className="mx-auto w-full max-w-2xl rounded-2xl border border-line bg-surface p-6 shadow-xl backdrop:bg-ink/40"
      >
        <h2 id="image-zoom-title" className="text-lg font-semibold text-ink">
          {alt}
        </h2>
        <div className="relative mt-4 aspect-[4/5] w-full overflow-hidden rounded-xl border border-line bg-tile">
          <ProductImage src={src} name={alt} className="object-contain p-2" />
        </div>
        <form method="dialog" className="mt-6 flex justify-end">
          <Button type="submit" variant="secondary" size="sm">
            Close
          </Button>
        </form>
      </dialog>
    </>
  );
}