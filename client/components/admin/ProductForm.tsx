'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { ImageUploader } from '@/components/admin/ImageUploader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Notice, type NoticeTone } from '@/components/ui/Notice';
import type { CategoryTreeItem } from '@/lib/types';
import type { CreateProductPayload, ProductStatus } from '@/lib/types';
import { formatPoisha, parseTakaToPoisha } from '@/lib/utils/money';

export interface ProductFormValues {
  name: string;
  description: string;
  categoryId: string;
  takaPrice: string;
  status: ProductStatus;
  images: string[];
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
}

type FieldErrors = Partial<Record<'name' | 'description' | 'categoryId' | 'takaPrice', string>>;

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
}: ProductFormProps) {
  const [values, setValues] = useState<ProductFormValues>(initialValues);
  const [errors, setErrors] = useState<FieldErrors>({});

  const setField = <K extends keyof ProductFormValues>(field: K, value: ProductFormValues[K]) => {
    setValues((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
  };

  const price = parseTakaToPoisha(values.takaPrice);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: FieldErrors = {};

    const name = values.name.trim();
    if (name.length === 0) {
      nextErrors.name = 'Name is required';
    } else if (name.length > 120) {
      nextErrors.name = 'Name must be at most 120 characters';
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

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || price === null) {
      return;
    }

    onSubmit({
      name,
      description,
      category: values.categoryId,
      basePrice: price,
      images: values.images,
      status: values.status,
    });
  };

  const categoryOptions: Array<{ id: string; label: string }> = [];
  for (const root of categories) {
    categoryOptions.push({ id: root.id, label: root.name });
    for (const child of root.children) {
      categoryOptions.push({ id: child.id, label: `— ${child.name}` });
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
          className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="product-status" className="text-sm font-medium text-ink">
          Status
        </label>
        <select
          id="product-status"
          disabled={submitting}
          value={values.status}
          onChange={(event) => setField('status', event.target.value as ProductStatus)}
          className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:w-60"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
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
