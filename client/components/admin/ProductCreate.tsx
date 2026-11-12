'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProductForm, type ProductFormNotice } from '@/components/admin/ProductForm';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { adminApi } from '@/lib/api/admin';
import { ApiError } from '@/lib/api/client';
import { catalogApi } from '@/lib/api/catalog';
import type { CategoryTreeItem, CreateProductPayload } from '@/lib/types';

type CategoriesState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; items: CategoryTreeItem[] };

export function ProductCreate() {
  const router = useRouter();
  const [categories, setCategories] = useState<CategoriesState>({ status: 'loading' });
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<ProductFormNotice | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      setCategories({ status: 'loading' });
      try {
        const response = await catalogApi.getCategories();
        if (!cancelled) {
          setCategories({ status: 'success', items: response.items });
        }
      } catch (error) {
        if (!cancelled) {
          setCategories({
            status: 'error',
            message: error instanceof ApiError ? error.message : 'Could not load categories.',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const handleCreate = (payload: CreateProductPayload) => {
    setSubmitting(true);
    setNotice(null);
    void (async () => {
      try {
        const { product } = await adminApi.createProduct(payload);
        router.push(`/admin/products/${product.id}?created=1`);
      } catch (error) {
        setNotice({
          tone: 'error',
          message:
            error instanceof ApiError ? error.message : 'Could not create the product.',
        });
        setSubmitting(false);
      }
    })();
  };

  if (categories.status === 'loading') {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  if (categories.status === 'error') {
    return (
      <ErrorState
        title="Could not load categories"
        description={categories.message}
        onRetry={() => setReloadKey((key) => key + 1)}
      />
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">New product</h1>
      <p className="text-sm text-muted">
        Create the product first — you can add variants right after saving.
      </p>
      <section className="rounded-2xl border border-line bg-surface p-5">
        <ProductForm
          initialValues={{
            name: '',
            description: '',
            categoryId: '',
            takaPrice: '',
            compareAtTaka: '',
            status: 'draft',
            images: [],
          }}
          categories={categories.items}
          submitting={submitting}
          submitLabel="Create product"
          notice={notice}
          onSubmit={handleCreate}
        />
      </section>
    </div>
  );
}
