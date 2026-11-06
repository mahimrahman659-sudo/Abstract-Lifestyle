import bcrypt from 'bcryptjs';
import type { Types } from 'mongoose';
import { connectDB, disconnectDB } from '../config/db.js';
import { env } from '../config/env.js';
import { CategoryModel } from '../models/category.model.js';
import { ProductModel } from '../models/product.model.js';
import { UserModel } from '../models/user.model.js';
import { VariantModel } from '../models/variant.model.js';
import { slugify } from '../utils/slug.js';

interface CategorySeed {
  name: string;
  parentId: Types.ObjectId | null;
  sortOrder?: number;
}

interface ProductSeed {
  name: string;
  description: string;
  categoryId: Types.ObjectId;
  basePrice: number;
}

interface VariantSeed {
  productId: Types.ObjectId;
  sku: string;
  size: string | null;
  color: string | null;
  stock: number;
  lowStockThreshold?: number;
}

const upsertCategory = async (seed: CategorySeed): Promise<Types.ObjectId> => {
  const slug = slugify(seed.name);
  const doc = await CategoryModel.findOneAndUpdate(
    { slug },
    { $set: { name: seed.name, slug, parent: seed.parentId, sortOrder: seed.sortOrder ?? 0 } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).exec();

  if (!doc) {
    throw new Error(`Failed to upsert category: ${seed.name}`);
  }
  return doc._id;
};

const upsertProduct = async (seed: ProductSeed): Promise<Types.ObjectId> => {
  const slug = slugify(seed.name);
  const doc = await ProductModel.findOneAndUpdate(
    { slug },
    {
      $set: {
        name: seed.name,
        slug,
        description: seed.description,
        category: seed.categoryId,
        basePrice: seed.basePrice,
        status: 'active',
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).exec();

  if (!doc) {
    throw new Error(`Failed to upsert product: ${seed.name}`);
  }
  return doc._id;
};

const upsertVariant = async (seed: VariantSeed): Promise<void> => {
  await VariantModel.findOneAndUpdate(
    { sku: seed.sku },
    {
      $set: {
        product: seed.productId,
        sku: seed.sku,
        size: seed.size,
        color: seed.color,
        price: null,
        stock: seed.stock,
        lowStockThreshold: seed.lowStockThreshold ?? 5,
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).exec();
};

const seed = async (): Promise<void> => {
  // `--admin-only` seeds the admin user + category trees and skips the demo
  // products/variants (use this for production databases).
  const adminOnly = process.argv.includes('--admin-only');
  await connectDB();

  // 1. Admin user (credentials from env — see .env.example)
  const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 10);
  await UserModel.findOneAndUpdate(
    { email: env.ADMIN_EMAIL },
    { $set: { email: env.ADMIN_EMAIL, passwordHash, name: 'Store Admin', role: 'admin' } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).exec();

  // 2. Category trees: Clothing (T-shirts, Hoodies) and Lifestyle (Accessories, Bags)
  const clothingId = await upsertCategory({ name: 'Clothing', parentId: null, sortOrder: 1 });
  const lifestyleId = await upsertCategory({ name: 'Lifestyle', parentId: null, sortOrder: 2 });

  const tshirtsId = await upsertCategory({ name: 'T-shirts', parentId: clothingId });
  const hoodiesId = await upsertCategory({ name: 'Hoodies', parentId: clothingId });
  const accessoriesId = await upsertCategory({ name: 'Accessories', parentId: lifestyleId });
  const bagsId = await upsertCategory({ name: 'Bags', parentId: lifestyleId });

  if (!adminOnly) {
    // 3. Sample products (prices in poisha: 100 poisha = 1 BDT)
  const teeId = await upsertProduct({
    name: 'Everyday Heavyweight T-Shirt',
    description: 'Thick 240gsm cotton tee with a relaxed fit. A daily staple.',
    categoryId: tshirtsId,
    basePrice: 89000,
  });

  const hoodieId = await upsertProduct({
    name: 'Oversized Fleece Hoodie',
    description: 'Heavyweight brushed-back fleece hoodie with a boxy oversized cut.',
    categoryId: hoodiesId,
    basePrice: 189000,
  });

  const toteId = await upsertProduct({
    name: 'Canvas Tote Bag',
    description: 'Sturdy 12oz canvas tote with an inner pocket. Fits a 15" laptop.',
    categoryId: bagsId,
    basePrice: 119000,
  });

  const bottleId = await upsertProduct({
    name: 'Insulated Steel Bottle 750ml',
    description: 'Double-wall insulated bottle. Keeps drinks cold 24h, hot 12h.',
    categoryId: accessoriesId,
    basePrice: 79000,
  });

  // 4. Variants (clothing: size/color; lifestyle: one "default" variant)
  await upsertVariant({ productId: teeId, sku: 'AL-TS-BLK-M', size: 'M', color: 'Black', stock: 25 });
  await upsertVariant({ productId: teeId, sku: 'AL-TS-BLK-L', size: 'L', color: 'Black', stock: 20 });
  await upsertVariant({ productId: teeId, sku: 'AL-TS-WHT-M', size: 'M', color: 'White', stock: 18 });
  await upsertVariant({ productId: teeId, sku: 'AL-TS-WHT-L', size: 'L', color: 'White', stock: 15 });

  await upsertVariant({ productId: hoodieId, sku: 'AL-HD-BLK-M', size: 'M', color: 'Black', stock: 12 });
  await upsertVariant({ productId: hoodieId, sku: 'AL-HD-BLK-L', size: 'L', color: 'Black', stock: 10 });
  await upsertVariant({
    productId: hoodieId,
    sku: 'AL-HD-CHR-XL',
    size: 'XL',
    color: 'Charcoal',
    stock: 3,
    lowStockThreshold: 5,
  });

  await upsertVariant({ productId: toteId, sku: 'AL-BAG-01', size: null, color: null, stock: 40 });
  await upsertVariant({ productId: bottleId, sku: 'AL-BTL-01', size: null, color: null, stock: 35 });
  }

  // 5. Summary
  const [users, categories, products, variants] = await Promise.all([
    UserModel.countDocuments(),
    CategoryModel.countDocuments(),
    ProductModel.countDocuments(),
    VariantModel.countDocuments(),
  ]);

  console.log(adminOnly ? 'Seed complete (admin + categories only):' : 'Seed complete:');
  console.log(`  users: ${users}`);
  console.log(`  categories: ${categories}`);
  if (!adminOnly) {
    console.log(`  products: ${products}`);
    console.log(`  variants: ${variants}`);
  }

  await disconnectDB();
};

seed().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
