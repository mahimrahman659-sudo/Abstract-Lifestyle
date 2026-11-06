import { z } from 'zod';
import { objectIdSchema } from './common.schema.js';
import { addressSchema } from './user.schema.js';

export const createOrderSchema = z
  .object({
    checkoutId: z.uuid('checkoutId must be a UUID'),
    shippingAddressId: objectIdSchema.optional(),
    shippingAddress: addressSchema.optional(),
    paymentMethod: z.enum(['cod']),
  })
  .refine(
    (data) => (data.shippingAddressId !== undefined) !== (data.shippingAddress !== undefined),
    { message: 'Provide exactly one of shippingAddressId or shippingAddress' },
  );

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const orderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

export const orderParamsSchema = z.object({
  id: objectIdSchema,
});
