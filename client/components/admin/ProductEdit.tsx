'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { ProductForm, type ProductFormNotice } from '@/components/admin/ProductForm';
import { VariantManager } from '@/components/admin/VariantManager';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Notice } from '@/components/ui/Notice';
import { Skeleton } from '@/components/ui/Skeleton';
import { adminApi } from '@/lib/api/admin';
import { ApiError } from '@/lib/api/client';
import { catalogApi } from '@/lib/api/catalog';
import type {
  AdminProductDetail,
  CategoryTreeItem,
  CreateProductPayload,
} from '@/lib/types';
import { poishaToTakaInput } from '@/lib/utils/money';

type DetailState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: AdminProductDetail };

type Dialog = 'archive' | 'delete' | null;

export function ProductEdit({ productId }: { productId: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<DetailState>({ status: 'loading' });
  const [categories, setCategories] = useState<CategoryTreeItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<ProductFormNotice | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    // Deferred into an async task (react-hooks/set-state-in-effect).
    void (async () => {
      await Promise.resolve();
      setCreated(new URLSearchParams(window.location.search).get('created') === '1');
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      setDetail((previous) => (previous.status === 'success' ? previous : { status: 'loading' }));
      try {
        const data = await adminApi.getProduct(productId);
        if (!cancelled) {
          setDetail({ status: 'success', data });
        }
      } catch (error) {
        if (!cancelled) {
          setDetail({
            status: 'error',
            message: error instanceof ApiError ? error.message : 'Could not load this product.',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    catalogApi
      .getCategories()
      .then((response) => {
        if (!cancelled) {
          setCategories(response.items);
        }
      })
      .catch(() => {
        // The form still works with an empty category list.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = useCallback(async () => {
    const data = await adminApi.getProduct(productId);
    setDetail({ status: 'success', data });
  }, [productId]);

  const handleSave = (payload: CreateProductPayload) => {
    setSubmitting(true);
    setNotice(null);
    void (async () => {
      try {
        await adminApi.updateProduct(productId, payload);
        await reload();
        setNotice({ tone: 'success', message: 'Product saved.' });
      } catch (error) {
        setNotice({
          tone: 'error',
          message: error instanceof ApiError ? error.message : 'Could not save the product.',
        });
      } finally {
        setSubmitting(false);
      }
    })();
  };

  const handleArchive = () => {
    setBusy(true);
    setNotice(null);
    void (async () => {
      try {
        await adminApi.updateProduct(productId, { status: 'archived' });
        await reload();
        setNotice({
          tone: 'info',
          message: 'Product archived — it no longer appears on the storefront.',
        });
      } catch (error) {
        setNotice({
          tone: 'error',
          message: error instanceof ApiError ? error.message : 'Could not archive the product.',
        });
      } finally {
        setBusy(false);
        setDialog(null);
      }
    })();
  };

  const handleDelete = () => {
    setBusy(true);
    setNotice(null);
    void (async () => {
      try {
        const result = await adminApi.deleteProduct(productId);
        if (result?.archived) {
          await reload();
          setNotice({
            tone: 'info',
            message:
              'This product is referenced by existing orders, so it was archived instead of deleted. It no longer appears on the storefront.',
          });
        } else {
          // 204 No Content = hard delete succeeded (no response body to read).
          router.push('/admin/products');
        }
      } catch (error) {
        setNotice({
          tone: 'error',
          message: error instanceof ApiError ? error.message : 'Could not delete the product.',
        });
      } finally {
        setBusy(false);
        setDialog(null);
      }
    })();
  };

  if (detail.status === 'loading') {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-96 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (detail.status === 'error') {
    return (
      <ErrorState
        title="Could not load this product"
        description={detail.message}
        onRetry={() => setReloadKey((key) => key + 1)}
      />
    );
  }

  const { product, variants } = detail.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{product.name}</h1>
        <p className="text-xs text-muted">
          /{product.slug} · status: {product.status}
        </p>
      </div>

      {created ? (
        <Notice tone="success">
          Product created. Add at least one variant below before publishing it (status “active”).
        </Notice>
      ) : null}

      <section aria-labelledby="product-details-heading" className="rounded-2xl border border-line bg-surface p-5">
        <h2 id="product-details-heading" className="mb-4 text-base font-semibold text-ink">
          Product details
        </h2>
        <ProductForm
          key={`${product.id}-${product.status}`}
          initialValues={{
            name: product.name,
            description: product.description,
            categoryId: product.category,
            takaPrice: poishaToTakaInput(product.basePrice),
            status: product.status,
            images: product.images,
          }}
          categories={categories}
          submitting={submitting}
          submitLabel="Save changes"
          notice={notice}
          onSubmit={handleSave}
          extraActions={
            <>
              <Button
                variant="secondary"
                disabled={submitting || busy || product.status === 'archived'}
                onClick={() => setDialog('archive')}
              >
                Archive
              </Button>
              <Button
                variant="danger"
                disabled={submitting || busy}
                onClick={() => setDialog('delete')}
              >
                Delete
              </Button>
            </>
          }
        />
      </section>

      <VariantManager productId={product.id} variants={variants} reload={reload} />

      <ConfirmDialog
        open={dialog === 'archive'}
        title="Archive product?"
        message="The product will be hidden from the storefront. You can re-activate it later by setting its status back to active."
        confirmLabel="Archive product"
        busy={busy}
        onConfirm={handleArchive}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        title="Delete product?"
        message="This cannot be undone. Products referenced by orders are archived instead of deleted (the server decides)."
        confirmLabel="Delete product"
        busy={busy}
        onConfirm={handleDelete}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
