'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Input } from '@/components/ui/Input';
import { Notice, type NoticeTone } from '@/components/ui/Notice';
import { Skeleton } from '@/components/ui/Skeleton';
import { adminApi } from '@/lib/api/admin';
import { ApiError } from '@/lib/api/client';
import { catalogApi } from '@/lib/api/catalog';
import type { AdminCategory, CategoryTreeItem } from '@/lib/types';
import { cn } from '@/lib/utils/cn';

interface CategoryFormValues {
  name: string;
  parentId: string;
  sortOrder: string;
  description: string;
}

const emptyForm: CategoryFormValues = { name: '', parentId: '', sortOrder: '0', description: '' };

type TreeState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; items: CategoryTreeItem[] };

export function CategoriesManager() {
  const [tree, setTree] = useState<TreeState>({ status: 'loading' });
  const [values, setValues] = useState<CategoryFormValues>(emptyForm);
  const [errors, setErrors] = useState<Partial<Record<'name' | 'sortOrder', string>>>({});
  const [editing, setEditing] = useState<AdminCategory | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: NoticeTone; message: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminCategory | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      setTree({ status: 'loading' });
      try {
        const response = await catalogApi.getCategories();
        if (!cancelled) {
          setTree({ status: 'success', items: response.items });
        }
      } catch (error) {
        if (!cancelled) {
          setTree({
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

  const setField = (field: keyof CategoryFormValues, value: string) => {
    setValues((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field === 'name' ? 'name' : 'sortOrder']: undefined }));
  };

  const resetForm = () => {
    setValues(emptyForm);
    setEditing(null);
    setErrors({});
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = values.name.trim();
    const sortOrder = Number(values.sortOrder === '' ? '0' : values.sortOrder);
    const nextErrors: typeof errors = {};
    if (name.length === 0) {
      nextErrors.name = 'Name is required';
    } else if (name.length > 60) {
      nextErrors.name = 'Name must be at most 60 characters';
    }
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      nextErrors.sortOrder = 'Sort order must be a whole number, 0 or more';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    const payload = {
      name,
      parent: values.parentId === '' ? null : values.parentId,
      sortOrder,
      description: values.description.trim() === '' ? undefined : values.description.trim(),
    };

    setBusy(true);
    setNotice(null);
    void (async () => {
      try {
        if (editing) {
          await adminApi.updateCategory(editing.id, payload);
          setNotice({ tone: 'success', message: `Category “${name}” updated.` });
        } else {
          await adminApi.createCategory(payload);
          setNotice({ tone: 'success', message: `Category “${name}” created.` });
        }
        resetForm();
        setReloadKey((key) => key + 1);
      } catch (error) {
        setNotice({
          tone: 'error',
          message: error instanceof ApiError ? error.message : 'Could not save the category.',
        });
      } finally {
        setBusy(false);
      }
    })();
  };

  const startEdit = (category: CategoryTreeItem, parentId: string | null) => {
    setEditing({
      id: category.id,
      name: category.name,
      slug: category.slug,
      parent: parentId,
      sortOrder: category.sortOrder,
    });
    setValues({
      name: category.name,
      parentId: parentId ?? '',
      sortOrder: String(category.sortOrder),
      description: category.description ?? '',
    });
    setErrors({});
    setNotice(null);
  };

  const confirmDelete = () => {
    if (!deleteTarget) {
      return;
    }
    setBusy(true);
    setNotice(null);
    void (async () => {
      try {
        await adminApi.deleteCategory(deleteTarget.id);
        setNotice({ tone: 'success', message: `Category “${deleteTarget.name}” deleted.` });
        setReloadKey((key) => key + 1);
      } catch (error) {
        setNotice({
          tone: 'error',
          message: error instanceof ApiError ? error.message : 'Could not delete the category.',
        });
      } finally {
        setBusy(false);
        setDeleteTarget(null);
      }
    })();
  };

  const parentOptions: Array<{ id: string; label: string; disabled: boolean }> = [];
  if (tree.status === 'success') {
    for (const root of tree.items) {
      parentOptions.push({ id: root.id, label: root.name, disabled: editing?.id === root.id });
      for (const child of root.children) {
        parentOptions.push({
          id: child.id,
          label: `     ${child.name}`,
          disabled: true,
        });
      }
    }
  }

  const row = (category: CategoryTreeItem, depth: number, parentId: string | null) => (
    <li key={category.id}>
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2',
          depth > 0 && 'ml-6',
        )}
      >
        <div className="text-sm">
          <span className="font-medium text-ink">{category.name}</span>
          <span className="ml-2 text-xs text-muted">/{category.slug} · sort {category.sortOrder}</span>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => startEdit(category, parentId)}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() =>
              setDeleteTarget({
                id: category.id,
                name: category.name,
                slug: category.slug,
                parent: parentId,
                sortOrder: category.sortOrder,
              })
            }
          >
            Delete
          </Button>
        </div>
      </div>
      {category.children.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {category.children.map((child) => row(child, depth + 1, category.id))}
        </ul>
      ) : null}
    </li>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Categories</h1>

      {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}

      <section aria-labelledby="category-form-heading" className="rounded-2xl border border-line bg-surface p-5">
        <h2 id="category-form-heading" className="text-base font-semibold text-ink">
          {editing ? `Edit “${editing.name}”` : 'New category'}
        </h2>
        <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-4">
          <Input
            label="Name"
            required
            disabled={busy}
            value={values.name}
            error={errors.name}
            onChange={(event) => setField('name', event.target.value)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="category-parent" className="text-sm font-medium text-ink">
                Parent (optional)
              </label>
              <select
                id="category-parent"
                disabled={busy}
                value={values.parentId}
                onChange={(event) => setField('parentId', event.target.value)}
                className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent"
              >
                <option value="">No parent (top level)</option>
                {parentOptions.map((option) => (
                  <option key={option.id} value={option.id} disabled={option.disabled}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted">Two levels max: top-level categories and their children.</p>
            </div>
            <Input
              label="Sort order"
              type="number"
              min={0}
              disabled={busy}
              value={values.sortOrder}
              error={errors.sortOrder}
              onChange={(event) => setField('sortOrder', event.target.value)}
            />
          </div>
          <Input
            label="Description (optional)"
            disabled={busy}
            value={values.description}
            onChange={(event) => setField('description', event.target.value)}
          />
          <div className="flex gap-3">
            <Button type="submit" loading={busy} disabled={busy}>
              {editing ? 'Save changes' : 'Create category'}
            </Button>
            {editing ? (
              <Button variant="secondary" disabled={busy} onClick={resetForm}>
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      </section>

      <section aria-labelledby="category-tree-heading">
        <h2 id="category-tree-heading" className="mb-3 text-base font-semibold text-ink">
          Category tree
        </h2>
        {tree.status === 'loading' ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        ) : tree.status === 'error' ? (
          <ErrorState
            title="Could not load categories"
            description={tree.message}
            onRetry={() => setReloadKey((key) => key + 1)}
          />
        ) : tree.items.length === 0 ? (
          <EmptyState
            title="No categories yet"
            description="Create your first category using the form above."
          />
        ) : (
          <ul className="space-y-2">{tree.items.map((category) => row(category, 0, null))}</ul>
        )}
      </section>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete category?"
        message={
          deleteTarget
            ? deleteTarget.parent === null
              ? `Delete “${deleteTarget.name}”? Categories with subcategories or products cannot be deleted (the server will explain why).`
              : `Delete “${deleteTarget.name}”? Categories with products cannot be deleted (the server will explain why).`
            : ''
        }
        confirmLabel="Delete category"
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
