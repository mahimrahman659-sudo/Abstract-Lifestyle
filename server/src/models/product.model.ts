import { Schema, model, type Types } from 'mongoose';

export type ProductStatus = 'draft' | 'active' | 'archived';

export interface Product {
  name: string;
  slug: string;
  description: string;
  category: Types.ObjectId;
  basePrice: number;
  /** Optional original (pre-sale) price in poisha; variant overrides product. */
  compareAtPrice?: number | null;
  /**
   * Images are stored as `{ url, publicId }` objects for Cloudinary assets.
   * Legacy documents hold plain strings (`/uploads/...`); always read through
   * `utils/images.ts` helpers which normalize both shapes.
   */
  images: unknown[];
  status: ProductStatus;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<Product>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    description: { type: String, required: true, trim: true },
    category: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    basePrice: { type: Number, required: true, min: 0 },
    // Null = no sale. Must be greater than the effective price (validated in
    // the admin service, including against later price changes).
    compareAtPrice: { type: Number, default: null, min: 0 },
    // Mixed so legacy string URLs and new { url, publicId } assets both load.
    images: { type: [Schema.Types.Mixed], default: [] },
    status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft' },
  },
  { timestamps: true },
);

productSchema.index({ slug: 1 }, { unique: true });
productSchema.index({ status: 1, category: 1 });
productSchema.index({ name: 'text', description: 'text' });

export const ProductModel = model<Product>('Product', productSchema);
