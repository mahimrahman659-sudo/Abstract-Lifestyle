import { Schema, model, type Types } from 'mongoose';

export interface Variant {
  product: Types.ObjectId;
  sku: string;
  size: string | null;
  color: string | null;
  price: number | null;
  stock: number;
  lowStockThreshold: number;
  images: string[];
  createdAt: Date;
  updatedAt: Date;
}

const variantSchema = new Schema<Variant>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    sku: { type: String, required: true, uppercase: true, trim: true },
    size: { type: String, default: null, trim: true },
    color: { type: String, default: null, trim: true },
    price: { type: Number, default: null, min: 0 },
    stock: { type: Number, required: true, min: 0, default: 0 },
    lowStockThreshold: { type: Number, default: 5, min: 0 },
    images: { type: [String], default: [] },
  },
  { timestamps: true },
);

variantSchema.index({ product: 1 });
variantSchema.index({ sku: 1 }, { unique: true });
variantSchema.index({ product: 1, size: 1, color: 1 }, { unique: true });

export const VariantModel = model<Variant>('Variant', variantSchema);
