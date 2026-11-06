import { Schema, model, type Types } from 'mongoose';

export type ProductStatus = 'draft' | 'active' | 'archived';

export interface Product {
  name: string;
  slug: string;
  description: string;
  category: Types.ObjectId;
  basePrice: number;
  images: string[];
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
    images: { type: [String], default: [] },
    status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft' },
  },
  { timestamps: true },
);

productSchema.index({ slug: 1 }, { unique: true });
productSchema.index({ status: 1, category: 1 });
productSchema.index({ name: 'text', description: 'text' });

export const ProductModel = model<Product>('Product', productSchema);
