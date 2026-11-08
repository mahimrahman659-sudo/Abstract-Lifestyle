'use client';

import { useState, type FormEvent } from 'react';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Notice, type NoticeTone } from '@/components/ui/Notice';
import { Price } from '@/components/ui/Price';
import { adminApi } from '@/lib/api/admin';
import { ApiError } from '@/lib/api/client';
import type { AdminVariant, VariantPayload } from '@/lib/types';
import { parseTakaToPoisha, poishaToTakaInput } from '@/lib/utils/money';
import { fieldErrorsFromApi } from '@/lib/validation/server-errors';

interface VariantManagerProps {
  productId: string;
  variants: AdminVariant[];
  reload: () => Promise<void>;
}

interface VariantFormValues {
  sku: string;
  size: string;
  color: string;
  priceTaka: string;
  stock: string;
  lowStockThreshold: string;
}

type VariantField = keyof VariantFormValues | 'form';
type VariantErrors = Partial<Record<VariantField, string>>;

const emptyVariant: VariantFormValues = {
  sku: '',
  size: '',
  color: '',
  priceTaka: '',
  stock: '0',
  lowStockThreshold: '5',
};

const toFormValues = (variant: AdminVariant): VariantFormValues => ({
  sku: variant.sku,
  size: variant.size ?? '',
  color: variant.color ?? '',
  priceTaka: variant.price === null ? '' : poishaToTakaInput(variant.price),
  stock: String(variant.stock),
  lowStockThreshold: String(variant.lowStockThreshold),
});

const buildPayload = (values: VariantFormValues): VariantPayload | null => {
  const price = values.priceTaka.trim() === '' ? null : parseTakaToPoisha(values.priceTaka);
  if (values.priceTaka.trim() !== '' && price === null) {
    return null;
  }
  return {
    sku: values.sku.trim().toUpperCase(),
    size: values.size.trim() === '' ? null : values.size.trim(),
    color: values.color.trim() === '' ? null : values.color.trim(),
    price,
    stock: Number(values.stock),
    lowStockThreshold: Number(values.lowStockThreshold),
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
  if (error.message === 'SKU already exists' || error.message.includes('SKU or size/color')) {
    return { sku: error.message };
  }
  if (error.message.includes('size and color already exists')) {
    return { size: error.message, color: error.message };
  }
  if (error.code === 'VALIDATION_ERROR' && error.details.length > 0) {
    const mapped = fieldErrorsFromApi(error);
    return { ...mapped, form: 'Please fix the highlighted fields.' };
  }
  return { form: error.message };
};

export function VariantManager({ productId, variants, reload }: VariantManagerProps) {
  const [addValues, setAddValues] = useState<VariantFormValues>(emptyVariant);
  const [addErrors, setAddErrors] = useState<VariantErrors>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<VariantFormValues>(emptyVariant);
  const [editErrors, setEditErrors] = useState<VariantErrors>({});
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminVariant | null>(null);
  const [notice, setNotice] = useState<{ tone: NoticeTone; message: string } | null>(null);

  const setAddField = (field: keyof VariantFormValues, value: string) => {
    setAddValues((previous) => ({ ...previous, [field]: value }));
    setAddErrors((previous) => ({ ...previous, [field]: undefined }));
  };
  const setEditField = (field: keyof VariantFormValues, value: string) => {
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

    setBusy(true);
    setNotice(null);
    void (async () => {
      try {
        await adminApi.updateVariant(editingId, payload);
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

  const fields = (
    values: VariantFormValues,
    errors: VariantErrors,
    setField: (field: keyof VariantFormValues, value: string) => void,
  ) => (
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
        label="Size (optional)"
        disabled={busy}
        value={values.size}
        error={errors.size}
        onChange={(event) => setField('size', event.target.value)}
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
        Every product needs at least one variant. Duplicate SKUs and duplicate size/color combinations
        are rejected by the server.
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
                  No variants yet — add the first one below.
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
