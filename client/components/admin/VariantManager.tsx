'use client';

import { useState, type FormEvent } from 'react';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Notice, type NoticeTone } from '@/components/ui/Notice';
import { Price } from '@/components/ui/Price';
import { adminApi } from '@/lib/api/admin';
import { ApiError } from '@/lib/api/client';
import { SIZE_CHIPS } from '@/lib/catalog/size-order';
import type { AdminVariant, BulkVariantPayload, VariantPayload } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import { parseTakaToPoisha, poishaToTakaInput } from '@/lib/utils/money';
import { fieldErrorsFromApi } from '@/lib/validation/server-errors';

interface VariantManagerProps {
  productId: string;
  variants: AdminVariant[];
  /** Product gallery URLs — a variant can feature one or more of them. */
  productImages: string[];
  reload: () => Promise<void>;
}

interface VariantFormValues {
  sku: string;
  size: string;
  color: string;
  priceTaka: string;
  /** Optional original price in taka; only used when the variant has a price. */
  compareAtTaka: string;
  stock: string;
  lowStockThreshold: string;
  images: string[];
}

type VariantField = keyof VariantFormValues | 'form';
type VariantErrors = Partial<Record<VariantField, string>>;

interface BulkErrors {
  prefix?: string;
  price?: string;
  compareAt?: string;
  sizes?: string;
  form?: string;
}

const emptyVariant: VariantFormValues = {
  sku: '',
  size: '',
  color: '',
  priceTaka: '',
  compareAtTaka: '',
  stock: '0',
  lowStockThreshold: '5',
  images: [],
};

const toFormValues = (variant: AdminVariant): VariantFormValues => ({
  sku: variant.sku,
  size: variant.size ?? '',
  color: variant.color ?? '',
  priceTaka: variant.price === null ? '' : poishaToTakaInput(variant.price),
  compareAtTaka:
    variant.compareAtPrice === null ? '' : poishaToTakaInput(variant.compareAtPrice),
  stock: String(variant.stock),
  lowStockThreshold: String(variant.lowStockThreshold),
  images: variant.images,
});

const buildPayload = (values: VariantFormValues): VariantPayload | null => {
  const price = values.priceTaka.trim() === '' ? null : parseTakaToPoisha(values.priceTaka);
  if (values.priceTaka.trim() !== '' && price === null) {
    return null;
  }
  const compareAt =
    values.compareAtTaka.trim() === '' ? null : parseTakaToPoisha(values.compareAtTaka);
  if (values.compareAtTaka.trim() !== '' && compareAt === null) {
    return null;
  }
  return {
    sku: values.sku.trim().toUpperCase(),
    size: values.size.trim() === '' ? null : values.size.trim(),
    color: values.color.trim() === '' ? null : values.color.trim(),
    price,
    // The variant's own compare-at only applies with its own price.
    compareAtPrice: price === null ? null : compareAt,
    stock: Number(values.stock),
    lowStockThreshold: Number(values.lowStockThreshold),
    images: values.images,
  };
};

const validate = (values: VariantFormValues): VariantErrors => {
  const errors: VariantErrors = {};
  const sku = values.sku.trim();
  if (sku.length === 0) {
    errors.sku = 'SKU is required';
  } else if (sku.length > 64) {
    errors.sku = 'SKU must be at most 64 characters';
  }
  if (values.size.trim().length > 20) {
    errors.size = 'Size must be at most 20 characters';
  }
  if (values.color.trim().length > 40) {
    errors.color = 'Color must be at most 40 characters';
  }
  if (values.priceTaka.trim() !== '' && parseTakaToPoisha(values.priceTaka) === null) {
    errors.priceTaka = 'Enter a valid price, e.g. 89.99';
  }

  // Compare-at only makes sense with the variant's own price override.
  const price = values.priceTaka.trim() === '' ? null : parseTakaToPoisha(values.priceTaka);
  const compareAt =
    values.compareAtTaka.trim() === '' ? null : parseTakaToPoisha(values.compareAtTaka);
  if (values.compareAtTaka.trim() !== '' && compareAt === null) {
    errors.compareAtTaka = 'Enter a valid price, e.g. 89.99';
  } else if (compareAt !== null && price === null) {
    errors.compareAtTaka = 'Add a price override first, or clear the compare-at price.';
  } else if (compareAt !== null && price !== null && compareAt <= price) {
    errors.compareAtTaka = 'Compare-at price must be greater than the price.';
  }
  const stock = Number(values.stock);
  if (!Number.isInteger(stock) || stock < 0) {
    errors.stock = 'Stock must be a whole number, 0 or more';
  }
  const threshold = Number(values.lowStockThreshold);
  if (!Number.isInteger(threshold) || threshold < 0) {
    errors.lowStockThreshold = 'Threshold must be a whole number, 0 or more';
  }
  return errors;
};

const mapVariantError = (error: unknown): VariantErrors => {
  if (!(error instanceof ApiError)) {
    return { form: 'Something went wrong. Please try again.' };
  }
  const message = error.message;
  if (message.includes('Stock changed')) {
    return { form: `${message} Reload the page to edit this variant again.` };
  }
  // The size/color conflict is checked first: it must not be reported as a SKU
  // problem, or the admin keeps changing the wrong field.
  if (message.includes('size and color')) {
    return { size: message, color: message };
  }
  if (message.includes('SKU')) {
    return { sku: message };
  }
  if (message.includes('Compare-at') || message.includes('Price must be lower')) {
    return { compareAtTaka: message };
  }
  if (error.code === 'VALIDATION_ERROR' && error.details.length > 0) {
    const mapped = fieldErrorsFromApi(error);
    return { ...mapped, form: 'Please fix the highlighted fields.' };
  }
  return { form: message };
};

const mapBulkError = (error: unknown): BulkErrors => {
  if (!(error instanceof ApiError)) {
    return { form: 'Something went wrong. Please try again.' };
  }
  const message = error.message;
  if (message.includes('SKU')) {
    return { prefix: message };
  }
  if (message.includes('already exist for this color')) {
    return { sizes: message };
  }
  if (message.includes('Compare-at') || message.includes('Price must be lower')) {
    return { compareAt: message };
  }
  if (error.code === 'VALIDATION_ERROR' && error.details.length > 0) {
    const mapped = fieldErrorsFromApi(error);
    return { ...mapped, form: 'Please fix the highlighted fields.' };
  }
  return { form: message };
};

export function VariantManager({
  productId,
  variants,
  productImages,
  reload,
}: VariantManagerProps) {
  const [addValues, setAddValues] = useState<VariantFormValues>(emptyVariant);
  const [addErrors, setAddErrors] = useState<VariantErrors>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<VariantFormValues>(emptyVariant);
  const [editErrors, setEditErrors] = useState<VariantErrors>({});
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminVariant | null>(null);
  const [notice, setNotice] = useState<{ tone: NoticeTone; message: string } | null>(null);

  // Bulk size run: one variant per chosen size, SKUs generated by the server.
  const [bulkPrefix, setBulkPrefix] = useState('');
  const [bulkColor, setBulkColor] = useState('');
  const [bulkPrice, setBulkPrice] = useState('');
  const [bulkCompareAt, setBulkCompareAt] = useState('');
  const [bulkThreshold, setBulkThreshold] = useState('5');
  const [bulkSizes, setBulkSizes] = useState<Array<{ size: string; stock: string }>>([]);
  const [bulkErrors, setBulkErrors] = useState<BulkErrors>({});

  const setAddField = <K extends keyof VariantFormValues>(
    field: K,
    value: VariantFormValues[K],
  ) => {
    setAddValues((previous) => ({ ...previous, [field]: value }));
    setAddErrors((previous) => ({ ...previous, [field]: undefined }));
  };
  const setEditField = <K extends keyof VariantFormValues>(
    field: K,
    value: VariantFormValues[K],
  ) => {
    setEditValues((previous) => ({ ...previous, [field]: value }));
    setEditErrors((previous) => ({ ...previous, [field]: undefined }));
  };

  const handleAdd = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validation = validate(addValues);
    const payload = buildPayload(addValues);
    if (payload === null) {
      setAddErrors({ ...validation, priceTaka: 'Enter a valid price, e.g. 89.99' });
      return;
    }
    setAddErrors(validation);
    if (Object.keys(validation).length > 0) {
      return;
    }

    setBusy(true);
    setNotice(null);
    void (async () => {
      try {
        await adminApi.createVariant(productId, payload);
        await reload();
        setAddValues(emptyVariant);
        setNotice({ tone: 'success', message: `Variant ${payload.sku} created.` });
      } catch (error) {
        setAddErrors(mapVariantError(error));
      } finally {
        setBusy(false);
      }
    })();
  };

  const handleEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingId) {
      return;
    }
    const validation = validate(editValues);
    const payload = buildPayload(editValues);
    if (payload === null) {
      setEditErrors({ ...validation, priceTaka: 'Enter a valid price, e.g. 89.99' });
      return;
    }
    setEditErrors(validation);
    if (Object.keys(validation).length > 0) {
      return;
    }

    // Stock this form was loaded with: the server refuses the save if an order
    // changed it meanwhile, instead of silently overwriting the decrement.
    const original = variants.find((variant) => variant.id === editingId);

    setBusy(true);
    setNotice(null);
    void (async () => {
      try {
        await adminApi.updateVariant(editingId, {
          ...payload,
          ...(original ? { expectedStock: original.stock } : {}),
        });
        await reload();
        setEditingId(null);
        setNotice({ tone: 'success', message: `Variant ${payload.sku} updated.` });
      } catch (error) {
        setEditErrors(mapVariantError(error));
      } finally {
        setBusy(false);
      }
    })();
  };

  const toggleBulkSize = (size: string) => {
    setBulkErrors((previous) => ({ ...previous, sizes: undefined }));
    setBulkSizes((previous) =>
      previous.some((row) => row.size === size)
        ? previous.filter((row) => row.size !== size)
        : [...previous, { size, stock: '0' }],
    );
  };

  const setBulkStock = (size: string, stock: string) => {
    setBulkErrors((previous) => ({ ...previous, sizes: undefined }));
    setBulkSizes((previous) =>
      previous.map((row) => (row.size === size ? { ...row, stock } : row)),
    );
  };

  const handleBulkAdd = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prefix = bulkPrefix.trim();
    const nextErrors: BulkErrors = {};

    if (prefix.length === 0) {
      nextErrors.prefix = 'SKU prefix is required (e.g. PH-PANP-TM24)';
    }
    const price = bulkPrice.trim() === '' ? null : parseTakaToPoisha(bulkPrice);
    if (bulkPrice.trim() !== '' && price === null) {
      nextErrors.price = 'Enter a valid price, e.g. 89.99';
    }
    const compareAt = bulkCompareAt.trim() === '' ? null : parseTakaToPoisha(bulkCompareAt);
    if (bulkCompareAt.trim() !== '' && compareAt === null) {
      nextErrors.compareAt = 'Enter a valid price, e.g. 89.99';
    } else if (compareAt !== null && price === null) {
      nextErrors.compareAt = 'Add a price first, or clear the compare-at price.';
    } else if (compareAt !== null && price !== null && compareAt <= price) {
      nextErrors.compareAt = 'Compare-at price must be greater than the price.';
    }
    if (bulkSizes.length === 0) {
      nextErrors.sizes = 'Choose at least one size';
    }
    const threshold = Number(bulkThreshold);
    if (!Number.isInteger(threshold) || threshold < 0) {
      nextErrors.form = 'Threshold must be a whole number, 0 or more';
    }
    const items = bulkSizes.map((row) => ({ size: row.size, stock: Number(row.stock) }));
    if (items.some((row) => !Number.isInteger(row.stock) || row.stock < 0)) {
      nextErrors.sizes = 'Each stock must be a whole number, 0 or more';
    }

    setBulkErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    const payload: BulkVariantPayload = {
      skuPrefix: prefix,
      color: bulkColor.trim() === '' ? null : bulkColor.trim(),
      price,
      compareAtPrice: price === null ? null : compareAt,
      lowStockThreshold: threshold,
      items,
      images: [],
    };

    setBusy(true);
    setNotice(null);
    void (async () => {
      try {
        const { variants: created } = await adminApi.createVariantsBulk(productId, payload);
        await reload();
        const sizes = created
          .map((variant) => variant.size ?? '')
          .filter((size) => size.length > 0)
          .join(', ');
        setBulkSizes([]);
        setNotice({
          tone: 'success',
          message: `Added ${created.length} variant${created.length === 1 ? '' : 's'}: ${sizes}.`,
        });
      } catch (error) {
        setBulkErrors(mapBulkError(error));
      } finally {
        setBusy(false);
      }
    })();
  };

  const confirmDelete = () => {
    if (!deleteTarget) {
      return;
    }
    setBusy(true);
    setNotice(null);
    void (async () => {
      try {
        await adminApi.deleteVariant(deleteTarget.id);
        await reload();
        setNotice({ tone: 'success', message: `Variant ${deleteTarget.sku} deleted.` });
      } catch (error) {
        setNotice({
          tone: 'error',
          message:
            error instanceof ApiError
              ? error.message
              : 'Could not delete this variant.',
        });
      } finally {
        setBusy(false);
        setDeleteTarget(null);
      }
    })();
  };

  const startEdit = (variant: AdminVariant) => {
    setEditingId(variant.id);
    setEditValues(toFormValues(variant));
    setEditErrors({});
    setNotice(null);
  };

  /** Apparel chips + a free-text field for anything else (38, 500 ml, …). */
  const sizeField = (value: string, onChange: (size: string) => void) => (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-ink">Size</span>
      <div className="flex flex-wrap gap-2">
        {SIZE_CHIPS.map((size) => (
          <button
            key={size}
            type="button"
            aria-pressed={value === size}
            disabled={busy}
            onClick={() => onChange(value === size ? '' : size)}
            className={cn(
              'inline-flex h-9 min-w-11 items-center justify-center rounded-md border px-3 text-sm transition',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              'disabled:cursor-not-allowed disabled:opacity-50',
              value === size
                ? 'border-ink bg-ink text-white'
                : 'border-line bg-surface text-ink hover:border-ink',
            )}
          >
            {size}
          </button>
        ))}
      </div>
      <Input
        label="Other size (optional)"
        disabled={busy}
        value={SIZE_CHIPS.includes(value as (typeof SIZE_CHIPS)[number]) ? '' : value}
        placeholder="e.g. 38, 500 ml"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );

  /** A variant can reuse product gallery images (shown first for that variant). */
  const imagesField = (values: VariantFormValues, setField: typeof setAddField) => (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-ink">Variant images (optional)</legend>
      {productImages.length === 0 ? (
        <p className="text-xs text-muted">
          Add images to the product first — a variant can then show its own first image.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {productImages.map((url, index) => {
            const active = values.images.includes(url);
            const toggle = () =>
              setField(
                'images',
                active ? values.images.filter((item) => item !== url) : [...values.images, url],
              );
            return (
              <button
                key={url}
                type="button"
                aria-pressed={active}
                disabled={busy}
                onClick={toggle}
                className={cn(
                  'inline-flex h-9 items-center rounded-md border px-3 text-sm transition',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  active
                    ? 'border-ink bg-ink text-white'
                    : 'border-line bg-surface text-ink hover:border-ink',
                )}
              >
                Image {index + 1}
              </button>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted">
        Empty = use the product gallery. While this variant is selected, its images replace the
        gallery.
      </p>
    </fieldset>
  );

  const fields = (
    values: VariantFormValues,
    errors: VariantErrors,
    setField: typeof setAddField,
  ) => (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Input
          label="SKU"
          required
          disabled={busy}
          value={values.sku}
          error={errors.sku}
          onChange={(event) => setField('sku', event.target.value)}
        />
        <Input
          label="Color (optional)"
          disabled={busy}
          value={values.color}
          error={errors.color}
          onChange={(event) => setField('color', event.target.value)}
        />
        <Input
          label="Price override ৳ (optional)"
          inputMode="decimal"
          disabled={busy}
          value={values.priceTaka}
          error={errors.priceTaka}
          hint="Empty = use the product base price"
          onChange={(event) => setField('priceTaka', event.target.value)}
        />
        <Input
          label="Compare-at price ৳ (optional)"
          inputMode="decimal"
          disabled={busy}
          value={values.compareAtTaka}
          error={errors.compareAtTaka}
          hint="Only used with a price override; must be higher than that price"
          onChange={(event) => setField('compareAtTaka', event.target.value)}
        />
        <Input
          label="Stock"
          type="number"
          min={0}
          required
          disabled={busy}
          value={values.stock}
          error={errors.stock}
          onChange={(event) => setField('stock', event.target.value)}
        />
        <Input
          label="Low-stock threshold"
          type="number"
          min={0}
          disabled={busy}
          value={values.lowStockThreshold}
          error={errors.lowStockThreshold}
          onChange={(event) => setField('lowStockThreshold', event.target.value)}
        />
      </div>
      {sizeField(values.size, (size) => setField('size', size))}
      {errors.size ? (
        <p role="alert" className="text-xs text-danger">
          {errors.size}
        </p>
      ) : null}
      {imagesField(values, setField)}
    </div>
  );

  return (
    <section
      aria-labelledby="variants-heading"
      className="rounded-2xl border border-line bg-surface p-5"
    >
      <h2 id="variants-heading" className="text-base font-semibold text-ink">
        Variants
      </h2>
      <p className="mt-1 text-xs text-muted">
        One variant per size and color. Every product needs at least one before it can be
        published; SKUs are unique across the whole store.
      </p>

      {notice ? (
        <Notice tone={notice.tone} className="mt-3">
          {notice.message}
        </Notice>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <th scope="col" className="py-2 pr-3">SKU</th>
              <th scope="col" className="py-2 pr-3">Size / color</th>
              <th scope="col" className="py-2 pr-3">Price</th>
              <th scope="col" className="py-2 pr-3">Stock</th>
              <th scope="col" className="py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {variants.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-muted">
                  No variants yet — add a size below (a product cannot be published without one).
                </td>
              </tr>
            ) : (
              variants.map((variant) => (
                <tr key={variant.id} className="border-b border-line/60 last:border-0">
                  <th scope="row" className="py-2 pr-3 font-medium text-ink">
                    {variant.sku}
                  </th>
                  <td className="py-2 pr-3 text-muted">
                    {[variant.size, variant.color].filter(Boolean).join(' / ') || '—'}
                  </td>
                  <td className="py-2 pr-3 text-ink">
                    {variant.price === null ? 'Base price' : <Price poisha={variant.price} />}
                  </td>
                  <td className="py-2 pr-3">
                    <span className="text-ink">{variant.stock}</span>
                    {variant.lowStock ? (
                      <span className="ml-2 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
                        Low stock
                      </span>
                    ) : null}
                    {!variant.inStock ? (
                      <span className="ml-2 rounded-full border border-danger/40 bg-danger/10 px-2 py-0.5 text-[11px] font-medium text-danger">
                        Out of stock
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2">
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => startEdit(variant)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => setDeleteTarget(variant)}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editingId ? (
        <form
          onSubmit={handleEdit}
          noValidate
          className="mt-6 space-y-3 rounded-xl border border-accent/40 bg-tile p-4"
        >
          <h3 className="text-sm font-semibold text-ink">Edit variant</h3>
          {fields(editValues, editErrors, setEditField)}
          {editErrors.form ? (
            <p role="alert" className="text-xs text-danger">
              {editErrors.form}
            </p>
          ) : null}
          <div className="flex gap-3">
            <Button type="submit" loading={busy} disabled={busy}>
              Save variant
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setEditingId(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      <form onSubmit={handleAdd} noValidate className="mt-6 space-y-3">
        <h3 className="text-sm font-semibold text-ink">Add variant</h3>
        {fields(addValues, addErrors, setAddField)}
        {addErrors.form ? (
          <p role="alert" className="text-xs text-danger">
            {addErrors.form}
          </p>
        ) : null}
        <Button type="submit" loading={busy} disabled={busy}>
          Add variant
        </Button>
      </form>

      {/* Several sizes at once — the standard clothing case. */}
      <form
        onSubmit={handleBulkAdd}
        noValidate
        className="mt-6 space-y-3 rounded-xl border border-line bg-tile/60 p-4"
      >
        <div>
          <h3 className="text-sm font-semibold text-ink">Add several sizes at once</h3>
          <p className="mt-1 text-xs text-muted">
            Creates one variant per selected size with a generated SKU (prefix + size), so S/M/L/XL
            take one save instead of four.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Input
            label="SKU prefix"
            required
            disabled={busy}
            value={bulkPrefix}
            error={bulkErrors.prefix}
            placeholder="e.g. PH-PANP-TM24"
            hint="Generated SKU = prefix + size"
            onChange={(event) => setBulkPrefix(event.target.value.toUpperCase())}
          />
          <Input
            label="Color (optional)"
            disabled={busy}
            value={bulkColor}
            onChange={(event) => setBulkColor(event.target.value)}
          />
          <Input
            label="Price override ৳ (optional)"
            inputMode="decimal"
            disabled={busy}
            value={bulkPrice}
            error={bulkErrors.price}
            hint="Empty = use the product base price"
            onChange={(event) => setBulkPrice(event.target.value)}
          />
          <Input
            label="Compare-at price ৳ (optional)"
            inputMode="decimal"
            disabled={busy}
            value={bulkCompareAt}
            error={bulkErrors.compareAt}
            hint="Only used with a price override"
            onChange={(event) => setBulkCompareAt(event.target.value)}
          />
          <Input
            label="Low-stock threshold"
            type="number"
            min={0}
            disabled={busy}
            value={bulkThreshold}
            onChange={(event) => setBulkThreshold(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-ink">Sizes and stock</span>
          <div className="flex flex-wrap gap-2">
            {SIZE_CHIPS.map((size) => {
              const active = bulkSizes.some((row) => row.size === size);
              return (
                <button
                  key={size}
                  type="button"
                  aria-pressed={active}
                  disabled={busy}
                  onClick={() => toggleBulkSize(size)}
                  className={cn(
                    'inline-flex h-9 min-w-11 items-center justify-center rounded-md border px-3 text-sm transition',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    active
                      ? 'border-ink bg-ink text-white'
                      : 'border-line bg-surface text-ink hover:border-ink',
                  )}
                >
                  {size}
                </button>
              );
            })}
          </div>
          {bulkSizes.length > 0 ? (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {bulkSizes.map((row) => (
                <li key={row.size} className="flex items-end gap-2">
                  <span className="w-10 pb-3 text-sm font-semibold text-ink">{row.size}</span>
                  <div className="flex-1">
                    <Input
                      label={`Stock ${row.size}`}
                      type="number"
                      min={0}
                      required
                      disabled={busy}
                      value={row.stock}
                      onChange={(event) => setBulkStock(row.size, event.target.value)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {bulkErrors.sizes ? (
            <p role="alert" className="text-xs text-danger">
              {bulkErrors.sizes}
            </p>
          ) : null}
        </div>

        {bulkErrors.form ? (
          <p role="alert" className="text-xs text-danger">
            {bulkErrors.form}
          </p>
        ) : null}

        <Button type="submit" variant="secondary" loading={busy} disabled={busy}>
          Add sizes
        </Button>
      </form>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete variant?"
        message={deleteTarget ? `Delete variant ${deleteTarget.sku}? This cannot be undone.` : ''}
        confirmLabel="Delete variant"
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}
