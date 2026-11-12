import { Types } from 'mongoose';
import { AppError } from '../middleware/error-handler.js';
import { COMPARE_AT_RULE_MESSAGE, PRICE_RULE_MESSAGE } from '../utils/pricing.js';
import { CategoryModel } from '../models/category.model.js';
import { ProductModel, type ProductStatus } from '../models/product.model.js';
import { VariantModel } from '../models/variant.model.js';
import { OrderModel } from '../models/order.model.js';
import type {
  CreateCategoryInput,
  UpdateCategoryInput,
} from '../schemas/category.schema.js';
import type { CreateProductInput, UpdateProductInput } from '../schemas/product.schema.js';
import type { CreateVariantInput, UpdateVariantInput } from '../schemas/variant.schema.js';
import type { AdminProductQuery, AdminVariantQuery } from '../schemas/admin.schema.js';
import { slugify } from '../utils/slug.js';
import { normalizeImages, type ImageAsset } from '../utils/images.js';
import { destroyImageAssets } from './upload.service.js';
import { isInStock, isLowStock } from '../utils/stock.js';

export interface CategoryAdminDto {
  id: string;
  name: string;
  slug: string;
  description?: string;
  image?: string;
  parent: string | null;
  sortOrder: number;
}

export interface ProductAdminDto {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  basePrice: number;
  compareAtPrice: number | null;
  images: ImageAsset[];
  status: ProductStatus;
}

export interface VariantAdminDto {
  id: string;
  product: { id: string; name: string; slug: string };
  sku: string;
  size: string | null;
  color: string | null;
  price: number | null;
  compareAtPrice: number | null;
  stock: number;
  lowStockThreshold: number;
  images: string[];
  inStock: boolean;
  lowStock: boolean;
}

export interface AdminListResult<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === 11000;

const toCategoryDto = (category: {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  description?: string;
  image?: string;
  parent: Types.ObjectId | null;
  sortOrder: number;
}): CategoryAdminDto => ({
  id: category._id.toString(),
  name: category.name,
  slug: category.slug,
  description: category.description,
  image: category.image,
  parent: category.parent ? category.parent.toString() : null,
  sortOrder: category.sortOrder,
});

const ensureUniqueSlug = async (slug: string, excludeId?: Types.ObjectId): Promise<void> => {
  const existing = await CategoryModel.findOne({ slug, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })
    .select('_id')
    .exec();
  const existingProduct = await ProductModel.findOne({
    slug,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  })
    .select('_id')
    .exec();
  if (existing || existingProduct) {
    throw new AppError(409, 'CONFLICT', 'Slug already exists');
  }
};

const ensureTwoLevelParent = async (parentId: string, excludeId?: Types.ObjectId): Promise<void> => {
  const parent = await CategoryModel.findById(parentId).exec();
  if (!parent || (excludeId && parent._id.equals(excludeId))) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid parent category');
  }
  if (parent.parent) {
    throw new AppError(409, 'CONFLICT', 'Categories support only two levels');
  }
};

export const createCategory = async (input: CreateCategoryInput): Promise<CategoryAdminDto> => {
  const slug = slugify(input.name);
  await ensureUniqueSlug(slug);
  if (input.parent) {
    await ensureTwoLevelParent(input.parent);
  }

  const category = await CategoryModel.create({
    name: input.name,
    slug,
    description: input.description,
    parent: input.parent ?? null,
    image: input.image,
    sortOrder: input.sortOrder,
  });
  return toCategoryDto(category);
};

export const updateCategory = async (
  categoryId: string,
  input: UpdateCategoryInput,
): Promise<CategoryAdminDto> => {
  const category = await CategoryModel.findById(categoryId).exec();
  if (!category) {
    throw new AppError(404, 'NOT_FOUND', 'Category not found');
  }

  if (input.name !== undefined && input.name !== category.name) {
    const slug = slugify(input.name);
    await ensureUniqueSlug(slug, category._id);
    category.name = input.name;
    category.slug = slug;
  }
  if (input.parent !== undefined) {
    if (input.parent === null) {
      const childCount = await CategoryModel.countDocuments({ parent: category._id }).exec();
      if (childCount > 0) {
        throw new AppError(409, 'CONFLICT', 'Category has subcategories');
      }
      category.parent = null;
    } else {
      await ensureTwoLevelParent(input.parent, category._id);
      category.parent = new Types.ObjectId(input.parent);
    }
  }
  if (input.description !== undefined) category.description = input.description;
  if (input.image !== undefined) category.image = input.image;
  if (input.sortOrder !== undefined) category.sortOrder = input.sortOrder;

  await category.save();
  return toCategoryDto(category);
};

export const deleteCategory = async (categoryId: string): Promise<void> => {
  const category = await CategoryModel.findById(categoryId).exec();
  if (!category) {
    throw new AppError(404, 'NOT_FOUND', 'Category not found');
  }

  const childCount = await CategoryModel.countDocuments({ parent: category._id }).exec();
  if (childCount > 0) {
    throw new AppError(409, 'CONFLICT', 'Category has subcategories');
  }
  const productCount = await ProductModel.countDocuments({ category: category._id }).exec();
  if (productCount > 0) {
    throw new AppError(409, 'CONFLICT', 'Category has products');
  }

  await CategoryModel.deleteOne({ _id: category._id }).exec();
};

const toProductDto = (product: {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  description: string;
  category: Types.ObjectId;
  basePrice: number;
  compareAtPrice?: number | null;
  images: unknown[];
  status: ProductStatus;
}): ProductAdminDto => ({
  id: product._id.toString(),
  name: product.name,
  slug: product.slug,
  description: product.description,
  category: product.category.toString(),
  basePrice: product.basePrice,
  compareAtPrice: product.compareAtPrice ?? null,
  images: normalizeImages(product.images),
  status: product.status,
});

export const createProduct = async (input: CreateProductInput): Promise<ProductAdminDto> => {
  const slug = slugify(input.name);
  await ensureUniqueSlug(slug);

  const category = await CategoryModel.findById(input.category).exec();
  if (!category) {
    throw new AppError(404, 'NOT_FOUND', 'Category not found');
  }

  const product = await ProductModel.create({
    name: input.name,
    slug,
    description: input.description,
    category: category._id,
    basePrice: input.basePrice,
    compareAtPrice: input.compareAtPrice ?? null,
    images: normalizeImages(input.images),
    status: input.status,
  });
  return toProductDto(product);
};

export const updateProduct = async (
  productId: string,
  input: UpdateProductInput,
): Promise<ProductAdminDto> => {
  const product = await ProductModel.findById(productId).exec();
  if (!product) {
    throw new AppError(404, 'NOT_FOUND', 'Product not found');
  }

  if (input.name !== undefined && input.name !== product.name) {
    const slug = slugify(input.name);
    await ensureUniqueSlug(slug, product._id);
    product.name = input.name;
    product.slug = slug;
  }
  if (input.category !== undefined) {
    const category = await CategoryModel.findById(input.category).exec();
    if (!category) {
      throw new AppError(404, 'NOT_FOUND', 'Category not found');
    }
    product.category = category._id;
  }
  if (input.description !== undefined) product.description = input.description;

  // Sale-price guard: the merged pair must stay valid, so raising a price above
  // a stored compare-at price is rejected instead of silently creating a fake
  // discount. Variants without their own price inherit the product compare-at.
  const nextBasePrice = input.basePrice ?? product.basePrice;
  const nextCompareAtPrice =
    input.compareAtPrice !== undefined ? input.compareAtPrice : (product.compareAtPrice ?? null);
  if (nextCompareAtPrice !== null && nextCompareAtPrice <= nextBasePrice) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      input.compareAtPrice !== undefined ? COMPARE_AT_RULE_MESSAGE : PRICE_RULE_MESSAGE,
    );
  }
  if (input.basePrice !== undefined) product.basePrice = input.basePrice;
  if (input.compareAtPrice !== undefined) product.compareAtPrice = input.compareAtPrice;

  // Track image removals so their Cloudinary assets can be deleted after saving.
  const removedAssets: ImageAsset[] = [];
  if (input.images !== undefined) {
    const nextImages = normalizeImages(input.images);
    const nextPublicIds = new Set(
      nextImages.map((asset) => asset.publicId).filter((id): id is string => id !== null),
    );
    for (const asset of normalizeImages(product.images)) {
      if (asset.publicId && !nextPublicIds.has(asset.publicId)) {
        removedAssets.push(asset);
      }
    }
    product.images = nextImages;
  }

  if (input.status !== undefined) product.status = input.status;

  await product.save();

  // Best-effort cleanup: failures are logged by the upload service and never block.
  await destroyImageAssets(removedAssets.map((asset) => asset.publicId));

  return toProductDto(product);
};

export const deleteProduct = async (
  productId: string,
): Promise<{ deleted: boolean; product?: ProductAdminDto }> => {
  const product = await ProductModel.findById(productId).exec();
  if (!product) {
    throw new AppError(404, 'NOT_FOUND', 'Product not found');
  }

  // Prefer archiving over hard delete for products referenced by orders.
  const referencedByOrders = await OrderModel.exists({ 'items.product': product._id }).exec();
  if (referencedByOrders) {
    product.status = 'archived';
    await product.save();
    return { deleted: false, product: toProductDto(product) };
  }

  await VariantModel.deleteMany({ product: product._id }).exec();
  await ProductModel.deleteOne({ _id: product._id }).exec();

  // Hard delete succeeded → best-effort cleanup of the Cloudinary assets.
  await destroyImageAssets(normalizeImages(product.images).map((asset) => asset.publicId));

  return { deleted: true };
};

const toVariantDto = (
  variant: {
    _id: Types.ObjectId;
    product: Types.ObjectId;
    sku: string;
    size: string | null;
    color: string | null;
    price: number | null;
    compareAtPrice?: number | null;
    stock: number;
    lowStockThreshold: number;
    images: string[];
  },
  product: { _id: Types.ObjectId; name: string; slug: string },
): VariantAdminDto => ({
  id: variant._id.toString(),
  product: { id: product._id.toString(), name: product.name, slug: product.slug },
  sku: variant.sku,
  size: variant.size,
  color: variant.color,
  price: variant.price,
  compareAtPrice: variant.compareAtPrice ?? null,
  stock: variant.stock,
  lowStockThreshold: variant.lowStockThreshold,
  images: variant.images,
  inStock: isInStock(variant.stock),
  lowStock: isLowStock(variant.stock, variant.lowStockThreshold),
});

const loadProductOrThrow = async (productId: string) => {
  const product = await ProductModel.findById(productId).exec();
  if (!product) {
    throw new AppError(404, 'NOT_FOUND', 'Product not found');
  }
  return product;
};

const ensureUniqueVariant = async (
  input: { sku: string; size?: string | null; color?: string | null },
  productId: Types.ObjectId,
  excludeId?: Types.ObjectId,
): Promise<void> => {
  const skuOwner = await VariantModel.findOne({
    sku: input.sku,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  })
    .select('_id')
    .exec();
  if (skuOwner) {
    throw new AppError(409, 'CONFLICT', 'SKU already exists');
  }

  const comboOwner = await VariantModel.findOne({
    product: productId,
    size: input.size ?? null,
    color: input.color ?? null,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  })
    .select('_id')
    .exec();
  if (comboOwner) {
    throw new AppError(409, 'CONFLICT', 'A variant with this size and color already exists');
  }
};

export const createVariant = async (
  productId: string,
  input: CreateVariantInput,
): Promise<VariantAdminDto> => {
  const product = await loadProductOrThrow(productId);
  await ensureUniqueVariant(input, product._id);

  // A variant's own compare-at only applies when it also has its own price;
  // variants without a price inherit the product compare-at price.
  const price = input.price ?? null;
  const compareAtPrice = price === null ? null : (input.compareAtPrice ?? null);
  if (price !== null && compareAtPrice !== null && compareAtPrice <= price) {
    throw new AppError(400, 'VALIDATION_ERROR', COMPARE_AT_RULE_MESSAGE);
  }

  try {
    const variant = await VariantModel.create({
      product: product._id,
      sku: input.sku,
      size: input.size ?? null,
      color: input.color ?? null,
      price,
      compareAtPrice,
      stock: input.stock,
      lowStockThreshold: input.lowStockThreshold,
      images: input.images,
    });
    return toVariantDto(variant, product);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError(409, 'CONFLICT', 'SKU or size/color combination already exists');
    }
    throw error;
  }
};

export const updateVariant = async (
  variantId: string,
  input: UpdateVariantInput,
): Promise<VariantAdminDto> => {
  const variant = await VariantModel.findById(variantId).exec();
  if (!variant) {
    throw new AppError(404, 'NOT_FOUND', 'Variant not found');
  }
  const product = await loadProductOrThrow(variant.product.toString());

  const merged = {
    sku: input.sku ?? variant.sku,
    size: input.size !== undefined ? input.size : variant.size,
    color: input.color !== undefined ? input.color : variant.color,
  };
  await ensureUniqueVariant(merged, variant.product, variant._id);

  // Stock edits use $set with validated, non-negative integers (never $inc here).
  const setFields: Record<string, unknown> = {};
  if (input.sku !== undefined) setFields.sku = input.sku;
  if (input.size !== undefined) setFields.size = input.size;
  if (input.color !== undefined) setFields.color = input.color;
  if (input.stock !== undefined) setFields.stock = input.stock;
  if (input.lowStockThreshold !== undefined) setFields.lowStockThreshold = input.lowStockThreshold;
  if (input.images !== undefined) setFields.images = input.images;

  const nextPrice = input.price !== undefined ? input.price : variant.price;
  let nextCompareAtPrice =
    input.compareAtPrice !== undefined
      ? input.compareAtPrice
      : (variant.compareAtPrice ?? null);

  if (nextPrice === null) {
    // No own price → the product compare-at applies; the variant's own value
    // is unused, so it is cleared rather than left as hidden stale data.
    nextCompareAtPrice = null;
  } else if (nextCompareAtPrice !== null && nextCompareAtPrice <= nextPrice) {
    // Raising the price above the stored compare-at is rejected (stale-value guard).
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      input.compareAtPrice !== undefined ? COMPARE_AT_RULE_MESSAGE : PRICE_RULE_MESSAGE,
    );
  }
  if (input.price !== undefined) setFields.price = input.price;
  if (input.compareAtPrice !== undefined || input.price !== undefined) {
    setFields.compareAtPrice = nextCompareAtPrice;
  }

  const updated = await VariantModel.findOneAndUpdate(
    { _id: variant._id },
    { $set: setFields },
    { returnDocument: 'after' },
  ).exec();
  if (!updated) {
    throw new AppError(404, 'NOT_FOUND', 'Variant not found');
  }
  return toVariantDto(updated, product);
};

export const deleteVariant = async (variantId: string): Promise<void> => {
  const variant = await VariantModel.findById(variantId).exec();
  if (!variant) {
    throw new AppError(404, 'NOT_FOUND', 'Variant not found');
  }

  const siblingCount = await VariantModel.countDocuments({ product: variant.product }).exec();
  if (siblingCount <= 1) {
    throw new AppError(409, 'CONFLICT', 'Product must keep at least one variant');
  }

  await VariantModel.deleteOne({ _id: variant._id }).exec();
};

export const listVariants = async (
  query: AdminVariantQuery,
): Promise<AdminListResult<VariantAdminDto>> => {
  const filter: Record<string, unknown> = {};
  if (query.lowStock === 'true') {
    filter.$expr = {
      $and: [{ $lte: ['$stock', '$lowStockThreshold'] }, { $gt: ['$stock', 0] }],
    };
  }

  const [variants, total] = await Promise.all([
    VariantModel.find(filter)
      .sort({ stock: 1, sku: 1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .exec(),
    VariantModel.countDocuments(filter).exec(),
  ]);

  const products = await ProductModel.find({
    _id: { $in: variants.map((variant) => variant.product) },
  }).exec();
  const productById = new Map(products.map((product) => [product._id.toString(), product]));

  return {
    items: variants.map((variant) =>
      toVariantDto(
        variant,
        productById.get(variant.product.toString()) ?? {
          _id: variant.product,
          name: 'Unknown',
          slug: 'unknown',
        },
      ),
    ),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  };
};

/** Admin product list: every status, optional status filter + text search. */
export const listProducts = async (
  query: AdminProductQuery,
): Promise<AdminListResult<ProductAdminDto>> => {
  const filter: Record<string, unknown> = {};
  if (query.status) {
    filter.status = query.status;
  }
  if (query.search) {
    filter.$text = { $search: query.search };
  }

  const [products, total] = await Promise.all([
    ProductModel.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .exec(),
    ProductModel.countDocuments(filter).exec(),
  ]);

  return {
    items: products.map(toProductDto),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  };
};

/** Admin product detail: any status, with its variants (for editing). */
export const getProductAdmin = async (
  productId: string,
): Promise<{ product: ProductAdminDto; variants: VariantAdminDto[] }> => {
  const product = await loadProductOrThrow(productId);
  const variants = await VariantModel.find({ product: product._id })
    .sort({ size: 1, color: 1, sku: 1 })
    .exec();

  return {
    product: toProductDto(product),
    variants: variants.map((variant) => toVariantDto(variant, product)),
  };
};


