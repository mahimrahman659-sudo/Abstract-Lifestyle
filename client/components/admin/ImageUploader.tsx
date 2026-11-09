'use client';

import Image from 'next/image';
import { useRef, useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Notice, type NoticeTone } from '@/components/ui/Notice';
import { Spinner } from '@/components/ui/Spinner';
import { adminApi } from '@/lib/api/admin';
import { ApiError } from '@/lib/api/client';
import type { AdminImageAsset } from '@/lib/types';

const ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/avif',
  'image/bmp',
  'image/tiff',
];
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 10;

export { ACCEPTED_TYPES, MAX_BYTES };

interface ImageUploaderProps {
  images: AdminImageAsset[];
  onChange: (images: AdminImageAsset[]) => void;
  disabled?: boolean;
}

interface UploadNotice {
  tone: NoticeTone;
  message: string;
}

export function ImageUploader({ images, onChange, disabled = false }: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<UploadNotice | null>(null);

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) {
      return;
    }

    const problems: string[] = [];
    const valid: File[] = [];
    for (const file of files) {
      // Unknown/empty MIME types pass here — the server verifies content.
      if (file.type && !ACCEPTED_TYPES.includes(file.type)) {
        problems.push(
          `${file.name}: only image files are allowed (JPEG, PNG, WebP, HEIC, AVIF, BMP or TIFF)`,
        );
      } else if (file.size > MAX_BYTES) {
        problems.push(`${file.name}: must be 5 MB or smaller`);
      } else {
        valid.push(file);
      }
    }
    if (images.length + valid.length > MAX_IMAGES) {
      setNotice({ tone: 'error', message: `A product can have at most ${MAX_IMAGES} images.` });
      return;
    }
    if (valid.length === 0) {
      setNotice({ tone: 'error', message: problems.join(' · ') });
      return;
    }

    setUploading(true);
    setNotice(null);
    try {
      const { assets } = await adminApi.uploadImages(valid);
      onChange([...images, ...assets]);
      setNotice({
        tone: 'success',
        message: `Uploaded ${assets.length} image${assets.length === 1 ? '' : 's'}.${
          problems.length > 0 ? ` Skipped: ${problems.join(' · ')}` : ''
        }`,
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof ApiError ? error.message : 'Upload failed. Please try again.',
      });
    } finally {
      setUploading(false);
    }
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= images.length) {
      return;
    }
    const next = [...images];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const makeMain = (index: number) => {
    const next = [...images];
    const [picked] = next.splice(index, 1);
    next.unshift(picked);
    onChange(next);
  };

  const remove = (index: number) => {
    onChange(images.filter((_, position) => position !== index));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          id="image-file-input"
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          multiple
          className="sr-only"
          onChange={(event) => void handleFiles(event)}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={disabled || uploading || images.length >= MAX_IMAGES}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? 'Uploading…' : 'Choose images'}
        </Button>
        {uploading ? <Spinner label="Uploading images" /> : null}
        <label htmlFor="image-file-input" className="text-xs text-muted">
          JPEG, PNG, WebP, HEIC, AVIF, BMP or TIFF · max 5 MB each · up to 10
        </label>
      </div>

      {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}

      {images.length > 0 ? (
        <ul className="flex flex-wrap gap-3">
          {images.map((image, index) => (
            <li key={`${image.publicId ?? image.url}-${index}`} className="w-32 rounded-xl border border-line bg-surface p-2">
              <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-tile">
                <Image
                  src={image.url}
                  alt={`Product image ${index + 1}`}
                  fill
                  sizes="128px"
                  className="object-cover"
                />
              </div>
              <p className="mt-1 text-center text-[11px] font-medium text-muted">
                {index === 0 ? 'Main image' : `Image ${index + 1}`}
              </p>
              <div className="mt-1 flex justify-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Move image ${index + 1} left`}
                  disabled={index === 0 || disabled}
                  onClick={() => move(index, -1)}
                >
                  ←
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Move image ${index + 1} right`}
                  disabled={index === images.length - 1 || disabled}
                  onClick={() => move(index, 1)}
                >
                  →
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Make image ${index + 1} the main image`}
                  disabled={index === 0 || disabled}
                  onClick={() => makeMain(index)}
                >
                  ★
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove image ${index + 1}`}
                  disabled={disabled}
                  onClick={() => remove(index)}
                >
                  ✕
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">
          No images yet — a neutral placeholder is shown on the storefront.
        </p>
      )}
    </div>
  );

}
