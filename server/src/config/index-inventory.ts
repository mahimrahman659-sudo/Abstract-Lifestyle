import type { Connection } from 'mongoose';
import { CartModel } from '../models/cart.model.js';
import { CategoryModel } from '../models/category.model.js';
import { NotificationModel } from '../models/notification.model.js';
import { OrderModel } from '../models/order.model.js';
import { ProductModel } from '../models/product.model.js';
import { SiteImageModel } from '../models/site-image.model.js';
import { UserModel } from '../models/user.model.js';
import { VariantModel } from '../models/variant.model.js';

export interface IndexKey {
  [field: string]: string | number;
}

export interface IndexOptionsLike {
  name?: string;
  unique?: boolean;
  sparse?: boolean;
  partialFilterExpression?: Record<string, unknown>;
  expireAfterSeconds?: number;
  weights?: Record<string, number>;
}

export interface ExpectedIndex {
  collection: string;
  name: string;
  key: IndexKey;
  unique: boolean;
  sparse: boolean;
  partialFilterExpression: Record<string, unknown> | null;
  expireAfterSeconds: number | null;
  /** Text fields when this is a text index; key is reported as _fts/_ftsx by MongoDB. */
  textFields: string[];
  /** The payment readiness gate requires this exact name. */
  requireExactName: boolean;
}

export interface ActualIndex {
  name: string;
  key: IndexKey;
  unique: boolean;
  sparse: boolean;
  partialFilterExpression: Record<string, unknown> | null;
  expireAfterSeconds: number | null;
  weights: Record<string, number> | null;
}

export interface IndexComparison {
  ok: boolean;
  expected: ExpectedIndex[];
  present: ExpectedIndex[];
  missing: ExpectedIndex[];
  mismatched: Array<{ expected: ExpectedIndex; actual: ActualIndex; reason: string }>;
  renamed: Array<{ expected: ExpectedIndex; actual: ActualIndex }>;
  extras: Array<{ collection: string; actual: ActualIndex }>;
}

const MODELS = [
  CartModel,
  CategoryModel,
  NotificationModel,
  OrderModel,
  ProductModel,
  SiteImageModel,
  UserModel,
  VariantModel,
] as const;

const defaultIndexName = (key: IndexKey): string =>
  Object.entries(key)
    .map(([field, direction]) => `${field}_${String(direction)}`)
    .join('_');

const normalizeKey = (key: Record<string, unknown>): IndexKey => {
  const normalized: IndexKey = {};
  for (const [field, direction] of Object.entries(key)) {
    normalized[field] = typeof direction === 'number' ? direction : String(direction);
  }
  return normalized;
};

const normalizePartial = (
  value: unknown,
): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const normalizeWeights = (value: unknown): Record<string, number> | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const weights: Record<string, number> = {};
  for (const [field, weight] of Object.entries(value as Record<string, unknown>)) {
    if (typeof weight === 'number') {
      weights[field] = weight;
    }
  }
  return weights;
};

const normalizeIndex = (index: {
  name?: unknown;
  key?: unknown;
  unique?: unknown;
  sparse?: unknown;
  partialFilterExpression?: unknown;
  expireAfterSeconds?: unknown;
  weights?: unknown;
}): ActualIndex => ({
  name: typeof index.name === 'string' ? index.name : '',
  key:
    index.key !== null && typeof index.key === 'object' && !Array.isArray(index.key)
      ? normalizeKey(index.key as Record<string, unknown>)
      : {},
  unique: index.unique === true,
  sparse: index.sparse === true,
  partialFilterExpression: normalizePartial(index.partialFilterExpression),
  expireAfterSeconds:
    typeof index.expireAfterSeconds === 'number' ? index.expireAfterSeconds : null,
  weights: normalizeWeights(index.weights),
});

export const expectedIndexes = (): ExpectedIndex[] => {
  const expected: ExpectedIndex[] = [];
  for (const model of MODELS) {
    const collection = model.collection.name;
    for (const [key, options] of model.schema.indexes()) {
      const normalizedKey = normalizeKey(key as Record<string, unknown>);
      const typedOptions = options as IndexOptionsLike;
      const name = typedOptions.name ?? defaultIndexName(normalizedKey);
      const textFields = Object.entries(normalizedKey)
        .filter(([, direction]) => direction === 'text')
        .map(([field]) => field);
      expected.push({
        collection,
        name,
        key: normalizedKey,
        unique: typedOptions.unique === true,
        sparse: typedOptions.sparse === true,
        partialFilterExpression: normalizePartial(typedOptions.partialFilterExpression),
        expireAfterSeconds:
          typeof typedOptions.expireAfterSeconds === 'number'
            ? typedOptions.expireAfterSeconds
            : null,
        textFields,
        requireExactName: name === 'payment_trxid_unique',
      });
    }
  }
  return expected;
};

const sameKey = (left: IndexKey, right: IndexKey): boolean =>
  JSON.stringify(Object.entries(left)) === JSON.stringify(Object.entries(right));

const samePartial = (
  left: Record<string, unknown> | null,
  right: Record<string, unknown> | null,
): boolean => {
  const stable = (value: unknown): string => {
    if (value === null || value === undefined) {
      return 'null';
    }
    if (Array.isArray(value)) {
      return `[${value.map(stable).join(',')}]`;
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
        .join(',')}}`;
    }
    return JSON.stringify(value);
  };
  return stable(left) === stable(right);
};

const sameTextWeights = (
  fields: string[],
  weights: Record<string, number> | null,
): boolean => {
  if (!weights) {
    return false;
  }
  const expectedFields = [...fields].sort();
  const actualFields = Object.keys(weights).sort();
  return (
    expectedFields.length === actualFields.length &&
    expectedFields.every((field, index) => field === actualFields[index] && weights[field] === 1)
  );
};

const matchesSignature = (expected: ExpectedIndex, actual: ActualIndex): boolean =>
  (expected.textFields.length > 0
    ? sameTextWeights(expected.textFields, actual.weights)
    : sameKey(expected.key, actual.key)) &&
  expected.unique === actual.unique &&
  expected.sparse === actual.sparse &&
  samePartial(expected.partialFilterExpression, actual.partialFilterExpression) &&
  expected.expireAfterSeconds === actual.expireAfterSeconds;

const compareCollection = (
  expected: ExpectedIndex[],
  actual: ActualIndex[],
  collection: string,
  result: IndexComparison,
): void => {
  const matchedActual = new Set<ActualIndex>();
  for (const item of expected) {
    const byName = actual.find((candidate) => candidate.name === item.name);
    if (byName) {
      matchedActual.add(byName);
      if (!matchesSignature(item, byName)) {
        const reasons: string[] = [];
        if (item.textFields.length > 0) {
          if (!sameTextWeights(item.textFields, byName.weights)) reasons.push('weights');
        } else if (!sameKey(item.key, byName.key)) {
          reasons.push('key');
        }
        if (item.unique !== byName.unique) reasons.push('unique');
        if (item.sparse !== byName.sparse) reasons.push('sparse');
        if (!samePartial(item.partialFilterExpression, byName.partialFilterExpression)) {
          reasons.push('partialFilterExpression');
        }
        if (item.expireAfterSeconds !== byName.expireAfterSeconds) {
          reasons.push('expireAfterSeconds');
        }
        result.mismatched.push({
          expected: item,
          actual: byName,
          reason: reasons.join(', ') || 'options',
        });
      } else {
        result.present.push(item);
      }
      continue;
    }

    const bySignature = actual.find((candidate) => matchesSignature(item, candidate));
    if (bySignature) {
      matchedActual.add(bySignature);
      if (item.requireExactName) {
        result.mismatched.push({
          expected: item,
          actual: bySignature,
          reason: `name must be "${item.name}"`,
        });
      } else {
        result.renamed.push({ expected: item, actual: bySignature });
        result.present.push(item);
      }
      continue;
    }
    result.missing.push(item);
  }

  for (const candidate of actual) {
    if (candidate.name === '_id_' || matchedActual.has(candidate)) {
      continue;
    }
    result.extras.push({ collection, actual: candidate });
  }
};

export const compareIndexInventory = (
  expected: ExpectedIndex[],
  actualByCollection: Record<string, ActualIndex[]>,
): IndexComparison => {
  const result: IndexComparison = {
    ok: true,
    expected,
    present: [],
    missing: [],
    mismatched: [],
    renamed: [],
    extras: [],
  };
  const collections = new Set([
    ...expected.map((item) => item.collection),
    ...Object.keys(actualByCollection),
  ]);
  for (const collection of collections) {
    compareCollection(
      expected.filter((item) => item.collection === collection),
      actualByCollection[collection] ?? [],
      collection,
      result,
    );
  }
  result.ok = result.missing.length === 0 && result.mismatched.length === 0;
  return result;
};

export const readIndexInventory = async (
  db: NonNullable<Connection['db']>,
): Promise<IndexComparison> => {
  const expected = expectedIndexes();
  const collections = Array.from(new Set(expected.map((item) => item.collection)));
  const actualByCollection: Record<string, ActualIndex[]> = {};
  for (const collection of collections) {
    const indexes = (await db.collection(collection).indexes()) as unknown as Array<{
      name?: unknown;
      key?: unknown;
      unique?: unknown;
      sparse?: unknown;
      partialFilterExpression?: unknown;
      expireAfterSeconds?: unknown;
      weights?: unknown;
    }>;
    actualByCollection[collection] = indexes.map(normalizeIndex);
  }
  return compareIndexInventory(expected, actualByCollection);
};

export const formatIndexInventory = (comparison: IndexComparison): string => {
  const lines: string[] = [];
  lines.push(
    `Index inventory: ${comparison.present.length}/${comparison.expected.length} present; ` +
      `${comparison.missing.length} missing; ${comparison.mismatched.length} mismatched; ` +
      `${comparison.renamed.length} renamed; ${comparison.extras.length} extra.`,
  );
  for (const item of comparison.present) {
    lines.push(`OK        ${item.collection}.${item.name}`);
  }
  for (const item of comparison.missing) {
    lines.push(`MISSING   ${item.collection}.${item.name}`);
  }
  for (const item of comparison.mismatched) {
    lines.push(
      `MISMATCH  ${item.expected.collection}.${item.expected.name} (${item.reason}; actual ${item.actual.name})`,
    );
  }
  for (const item of comparison.renamed) {
    lines.push(
      `RENAMED   ${item.expected.collection}.${item.expected.name} -> ${item.actual.name}`,
    );
  }
  for (const item of comparison.extras) {
    lines.push(`EXTRA     ${item.collection}.${item.actual.name}`);
  }
  return lines.join('\n');
};
