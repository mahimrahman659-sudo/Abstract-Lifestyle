import type { PipelineStage, Types } from 'mongoose';
import { AppError } from '../middleware/error-handler.js';
import { CategoryModel } from '../models/category.model.js';
import { ProductModel } from '../models/product.model.js';
import { VariantModel } from '../models/variant.model.js';
import type { ProductListQuery } from '../schemas/product.schema.js';
import { firstImageUrl, imageUrls } from '../utils/images.js';
import { isInStock, isLowStock } from '../utils/stock.js';

export interface ProductCardCategory {
  id: string;
  name: string;
  slug: string;
}

export interface ProductCard {
  id: string;
  name: string;
  slug: string;
  category: ProductCardCategory | null;
  image: string | null;
  priceFrom: number;
  priceTo: number;
  sizes: string[];
  colors: string[];
  inStock: boolean;
}

export interface ProductListResult {
  items: ProductCard[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PublicVariant {
  id: string;
  sku: string;
  size: string | null;
  color: string | null;
  price: number;
  stock: number;
  inStock: boolean;
  lowStock: boolean;
  images: string[];
}

export interface ProductDetail {
  product: {
    id: string;
    name: string;
    slug: string;
    description: string;
    category: ProductCardCategory | null;
    basePrice: number;
    images: string[];
  };
  variants: PublicVariant[];
  sizeGuideKey: 'clothing' | null;
}

interface ProductAggregateRow {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  basePrice: number;
  images: unknown[];
  categoryDoc: { _id: Types.ObjectId; name: string; slug: string } | null;
  priceFrom: number | null;
  priceTo: number | null;
  sizes: string[];
  colors: string[];
  totalStock: number;
}

const resolveCategoryIds = async (slug: string): Promise<Types.ObjectId[] | null> => {
  const category = await CategoryModel.findOne({ slug }).exec();
  if (!category) {
    return null;
  }

  const children = await CategoryModel.find({ parent: category._id }).select('_id').exec();
  return [category._id, ...children.map((child) => child._id)];
};

const toCategoryCard = (
  doc: { _id: Types.ObjectId; name: string; slug: string } | null,
): ProductCardCategory | null =>
  doc ? { id: doc._id.toString(), name: doc.name, slug: doc.slug } : null;

export const listProducts = async (query: ProductListQuery): Promise<ProductListResult> => {
  const match: Record<string, unknown> = { status: 'active' };

  if (query.category !== undefined) {
    const categoryIds = await resolveCategoryIds(query.category);
    if (!categoryIds) {
      return { items: [], page: query.page, limit: query.limit, total: 0, totalPages: 0 };
    }
    match.category = { $in: categoryIds };
  }

  if (query.search !== undefined) {
    // $text search — no user text is ever interpolated into a regex.
    match.$text = { $search: query.search };
  }

  const priceMatch: PipelineStage.Match[] = [];
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    const priceConditions: Record<string, unknown>[] = [];
    if (query.maxPrice !== undefined) {
      priceConditions.push({ $lte: ['$priceFrom', query.maxPrice] });
    }
    if (query.minPrice !== undefined) {
      priceConditions.push({ $gte: ['$priceTo', query.minPrice] });
    }
    priceMatch.push({ $match: { $expr: { $and: priceConditions } } });
  }

  const sizeMatch: PipelineStage.Match[] =
    query.sizes !== undefined
      ? [
          {
            $match: {
              $expr: { $gt: [{ $size: { $setIntersection: ['$sizes', query.sizes] } }, 0] },
            },
          },
        ]
      : [];

  const colorMatch: PipelineStage.Match[] =
    query.colors !== undefined
      ? [
          {
            $match: {
              $expr: { $gt: [{ $size: { $setIntersection: ['$colors', query.colors] } }, 0] },
            },
          },
        ]
      : [];

  const useRelevanceScore = query.sort === 'relevance' && query.search !== undefined;
  const scoreStage: PipelineStage[] = useRelevanceScore
    ? [{ $addFields: { score: { $meta: 'textScore' } } }]
    : [];

  const sortStage: Record<string, 1 | -1> =
    query.sort === 'price_asc'
      ? { priceFrom: 1, _id: 1 }
      : query.sort === 'price_desc'
        ? { priceTo: -1, _id: 1 }
        : useRelevanceScore
          ? { score: -1, _id: 1 }
          : { createdAt: -1, _id: -1 };

  const skip = (query.page - 1) * query.limit;

  const pipeline = [
    { $match: match },
    {
      $lookup: {
        from: 'variants',
        localField: '_id',
        foreignField: 'product',
        as: 'variantDocs',
      },
    },
    {
      $addFields: {
        effectivePrices: {
          $map: {
            input: '$variantDocs',
            as: 'variant',
            in: { $ifNull: ['$$variant.price', '$basePrice'] },
          },
        },
        sizes: { $setDifference: [{ $setUnion: ['$variantDocs.size', []] }, [null]] },
        colors: { $setDifference: [{ $setUnion: ['$variantDocs.color', []] }, [null]] },
        totalStock: { $sum: '$variantDocs.stock' },
      },
    },
    {
      $addFields: {
        priceFrom: { $ifNull: [{ $min: '$effectivePrices' }, '$basePrice'] },
        priceTo: { $ifNull: [{ $max: '$effectivePrices' }, '$basePrice'] },
      },
    },
    ...priceMatch,
    ...sizeMatch,
    ...colorMatch,
    ...scoreStage,
    {
      $lookup: {
        from: 'categories',
        localField: 'category',
        foreignField: '_id',
        as: 'categoryDocs',
      },
    },
    {
      $facet: {
        items: [
          { $sort: sortStage },
          { $skip: skip },
          { $limit: query.limit },
          {
            $project: {
              name: 1,
              slug: 1,
              basePrice: 1,
              images: 1,
              priceFrom: 1,
              priceTo: 1,
              sizes: 1,
              colors: 1,
              totalStock: 1,
              categoryDoc: { $arrayElemAt: ['$categoryDocs', 0] },
            },
          },
        ],
        total: [{ $count: 'count' }],
      },
    },
  ];

  const result = await ProductModel.aggregate<{
    items: ProductAggregateRow[];
    total: Array<{ count: number }>;
  }>(pipeline as PipelineStage[]).exec();

  const facet = result[0];
  const rows = facet?.items ?? [];
  const total = facet?.total[0]?.count ?? 0;

  return {
    items: rows.map((row) => ({
      id: row._id.toString(),
      name: row.name,
      slug: row.slug,
      category: toCategoryCard(row.categoryDoc),
      image: firstImageUrl(row.images),
      priceFrom: row.priceFrom ?? row.basePrice,
      priceTo: row.priceTo ?? row.basePrice,
      sizes: row.sizes,
      colors: row.colors,
      inStock: isInStock(row.totalStock),
    })),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  };
};

const resolveSizeGuideKey = async (
  categoryId: Types.ObjectId | null,
): Promise<'clothing' | null> => {
  if (!categoryId) {
    return null;
  }

  const leaf = await CategoryModel.findById(categoryId).exec();
  if (!leaf) {
    return null;
  }
  if (leaf.slug === 'clothing') {
    return 'clothing';
  }
  if (leaf.parent) {
    const parent = await CategoryModel.findById(leaf.parent).exec();
    return parent?.slug === 'clothing' ? 'clothing' : null;
  }
  return null;
};

export const getProductBySlug = async (slug: string): Promise<ProductDetail> => {
  const product = await ProductModel.findOne({ slug, status: 'active' }).exec();
  if (!product) {
    throw new AppError(404, 'NOT_FOUND', 'Product not found');
  }

  const [variants, category, sizeGuideKey] = await Promise.all([
    VariantModel.find({ product: product._id }).sort({ size: 1, color: 1 }).exec(),
    CategoryModel.findById(product.category).exec(),
    resolveSizeGuideKey(product.category),
  ]);

  return {
    product: {
      id: product._id.toString(),
      name: product.name,
      slug: product.slug,
      description: product.description,
      category: category
        ? { id: category._id.toString(), name: category.name, slug: category.slug }
        : null,
      basePrice: product.basePrice,
      images: imageUrls(product.images),
    },
    variants: variants.map((variant) => ({
      id: variant._id.toString(),
      sku: variant.sku,
      size: variant.size,
      color: variant.color,
      price: variant.price ?? product.basePrice,
      stock: variant.stock,
      inStock: isInStock(variant.stock),
      lowStock: isLowStock(variant.stock, variant.lowStockThreshold),
      images: variant.images,
    })),
    sizeGuideKey,
  };
};



