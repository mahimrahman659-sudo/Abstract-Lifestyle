'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ImageUploader } from '@/components/admin/ImageUploader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Notice, type NoticeTone } from '@/components/ui/Notice';
import type { AdminImageAsset, CategoryTreeItem } from '@/lib/types';
import type { CreateProductPayload, ProductStatus } from '@/lib/types';
import { formatPoisha, parseTakaToPoisha } from '@/lib/utils/money';

export interface ProductFormValues {
  name: string;
  /** Public URL slug (lowercase, dashes). */
  slug: string;
  description: string;
  categoryId: string;
  takaPrice: string;
  /** Optional original price in taka ("" = no sale). */
  compareAtTaka: string;
  status: ProductStatus;
  images: AdminImageAsset[];
}

export interface ProductFormNotice {
  tone: NoticeTone;
  message: string;
}

interface ProductFormProps {
  initialValues: ProductFormValues;
  categories: CategoryTreeItem[];
  submitting: boolean;
  submitLabel: string;
  notice: ProductFormNotice | null;
  onSubmit: (payload: CreateProductPayload) => void;
  extraActions?: ReactNode;
  /**
   * A new product cannot be published before it has variants and images, so the
   * create form locks the status to draft; the edit form offers every status.
   */
  allowActiveStatus?: boolean;
}

type FieldErrors = Partial<
  Record<'name' | 'slug' | 'description' | 'categoryId' | 'takaPrice' | 'compareAtTaka', string>
>;

const STATUS_OPTIONS: Array<{ value: ProductStatus; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
];

export function ProductForm({
  initialValues,
  categories,
  submitting,
  submitLabel,
  notice,
  onSubmit,
  extraActions,
  allowActiveStatus = true,
}: ProductFormProps) {
  const [values, setValues] = useState<ProductFormValues>(initialValues);
  const [errors, setErrors] = useState<FieldErrors>({});

  // Unsaved changes: warn before a reload/tab close throws away typed data and
  // uploaded images (the browser has no hook for in-app navigation).
  const dirty = JSON.stringify(values) !== JSON.stringify(initialValues);
  useEffect(() => {
    if (!dirty || submitting) {
      return;
    }
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, submitting]);

  const setField = <K extends keyof ProductFormValues>(field: K, value: ProductFormValues[K]) => {
    setValues((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
  };

  const price = parseTakaToPoisha(values.takaPrice);
  const compareAt = values.compareAtTaka.trim() === '' ? null : parseTakaToPoisha(values.compareAtTaka);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: FieldErrors = {};

    const name = values.name.trim();
    if (name.length === 0) {
      nextErrors.name = 'Name is required';
    } else if (name.length > 120) {
      nextErrors.name = 'Name must be at most 120 characters';
    }

    const slug = values.slug.trim();
    if (slug.length > 0 && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      nextErrors.slug = 'Use lowercase letters, numbers and single dashes, e.g. mens-pant';
    }

    const description = values.description.trim();
    if (description.length === 0) {
      nextErrors.description = 'Description is required';
    } else if (description.length > 2000) {
      nextErrors.description = 'Description must be at most 2000 characters';
    }

    if (!values.categoryId) {
      nextErrors.categoryId = 'Choose a category';
    }

    if (price === null) {
      nextErrors.takaPrice = 'Enter a valid price in taka, e.g. 89.99';
    }

    // Compare-at is optional, but when set it must be higher than the price.
    if (values.compareAtTaka.trim() !== '' && compareAt === null) {
      nextErrors.compareAtTaka = 'Enter a valid price in taka, e.g. 89.99';
    } else if (compareAt !== null && price !== null && compareAt <= price) {
      nextErrors.compareAtTaka = 'Compare-at price must be greater than the price.';
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || price === null) {
      return;
    }

    onSubmit({
      name,
      slug: slug.length > 0 ? slug : undefined,
      description,
      category: values.categoryId,
      basePrice: price,
      compareAtPrice: compareAt,
      images: values.images,
      status: allowActiveStatus ? values.status : 'draft',
    });
  };

  // Products live on leaf categories only; a parent category groups
  // subcategories and cannot hold products itself.
  const leafOptions: Array<{ id: string; label: string }> = [];
  const allOptions: Array<{ id: string; label: string }> = [];
  for (const root of categories) {
    allOptions.push({ id: root.id, label: root.name });
    if (root.children.length === 0) {
      leafOptions.push({ id: root.id, label: root.name });
    }
    for (const child of root.children) {
      const option = { id: child.id, label: `${root.name} / ${child.name}` };
      allOptions.push(option);
      leafOptions.push(option);
    }
  }
  const categoryOptions = leafOptions.length > 0 ? leafOptions : allOptions;
  if (values.categoryId && !categoryOptions.some((option) => option.id === values.categoryId)) {
    // Legacy product filed on a parent category: keep it selectable so the
    // admin can see where it is while moving it to a subcategory.
    const current = allOptions.find((option) => option.id === values.categoryId);
    if (current) {
      categoryOptions.unshift({ ...current, label: `${current.label} (parent — pick a subcategory)` });
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}

      <Input
        label="Name"
        required
        disabled={submitting}
        value={values.name}
        error={errors.name}
        onChange={(event) => setField('name', event.target.value)}
      />

      <Input
        label="URL slug"
        disabled={submitting}
        value={values.slug}
        error={errors.slug}
        hint="Lowercase letters, numbers and dashes. Changing it breaks existing links to this product."
        onChange={(event) => setField('slug', event.target.value.toLowerCase())}
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="product-description" className="text-sm font-medium text-ink">
          Description
        </label>
        <textarea
          id="product-description"
          required
          rows={4}
          disabled={submitting}
          value={values.description}
          onChange={(event) => setField('description', event.target.value)}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={errors.description ? 'product-description-error' : undefined}
          className={`w-full rounded-xl border bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
            errors.description ? 'border-danger' : 'border-line'
          }`}
        />
        {errors.description ? (
          <p id="product-description-error" role="alert" className="text-xs text-danger">
            {errors.description}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="product-category" className="text-sm font-medium text-ink">
            Category
          </label>
          <select
            id="product-category"
            required
            disabled={submitting}
            value={values.categoryId}
            onChange={(event) => setField('categoryId', event.target.value)}
            aria-invalid={errors.categoryId ? true : undefined}
            className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <option value="">Select a category…</option>
            {categoryOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          {errors.categoryId ? (
            <p role="alert" className="text-xs text-danger">
              {errors.categoryId}
            </p>
          ) : null}
        </div>

        <Input
          label="Base price (৳)"
          inputMode="decimal"
          required
          disabled={submitting}
          value={values.takaPrice}
          error={errors.takaPrice}
          hint={price !== null ? `Stored as ${price} poisha (${formatPoisha(price)})` : 'Enter taka, e.g. 89.99'}
          onChange={(event) => setField('takaPrice', event.target.value)}
        />

        <Input
          label="Compare-at price (৳) (optional)"
          inputMode="decimal"
          disabled={submitting}
          value={values.compareAtTaka}
          error={errors.compareAtTaka}
          hint={
            compareAt !== null
              ? `Shows as the struck-through original (${formatPoisha(compareAt)}). Variants with their own price override use their own compare-at.`
              : 'Original price before a sale. Applies to variants without a price override.'
          }
          onChange={(event) => setField('compareAtTaka', event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="product-status" className="text-sm font-medium text-ink">
          Status
        </label>
        <select
          id="product-status"
          disabled={submitting || !allowActiveStatus}
          value={allowActiveStatus ? values.status : 'draft'}
          onChange={(event) => setField('status', event.target.value as ProductStatus)}
          className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60 sm:w-60"
        >
          {STATUS_OPTIONS.filter((option) => allowActiveStatus || option.value === 'draft').map(
            (option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ),
          )}
        </select>
        <p className="text-xs text-muted">
          {allowActiveStatus
            ? 'Active products need at least one variant and one image before they can be published.'
            : 'New products are saved as drafts. Add variants and images, then publish from the edit page.'}
        </p>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">Images</legend>
        <ImageUploader
          images={values.images}
          disabled={submitting}
          onChange={(images) => setField('images', images)}
        />
      </fieldset>

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Button type="submit" loading={submitting} disabled={submitting}>
          {submitLabel}
        </Button>
        {extraActions}
      </div>
    </form>
  );

}
