import { z } from 'zod';
import { env } from '../config/env.js';
import { BD_MOBILE_ERROR, normalizeBdMobile } from '../utils/phone.js';
import { isValidTrxId, normalizeTrxId } from '../utils/payment.js';
import { objectIdSchema } from './common.schema.js';
import { addressSchema } from './user.schema.js';

export const createOrderSchema = z
  .object({
    checkoutId: z.uuid('checkoutId must be a UUID'),
    shippingAddressId: objectIdSchema.optional(),
    shippingAddress: addressSchema.optional(),
    paymentMethod: z.enum(['cod', 'bkash', 'nagad', 'rocket']),
  })
  .refine(
    (data) => (data.shippingAddressId !== undefined) !== (data.shippingAddress !== undefined),
    { message: 'Provide exactly one of shippingAddressId or shippingAddress' },
  );

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

const senderNumberSchema = z
  .string()
  .trim()
  .min(1, BD_MOBILE_ERROR)
  .max(20, BD_MOBILE_ERROR)
  .transform((value) => normalizeBdMobile(value) ?? value)
  .pipe(z.string().regex(/^01[3-9]\d{8}$/, BD_MOBILE_ERROR));

const trxIdSchema = z
  .string()
  .trim()
  .min(4, 'Enter the transaction ID from your payment confirmation message')
  .max(80, 'Transaction ID is too long')
  .transform(normalizeTrxId)
  .refine(
    (value) => isValidTrxId(value, env.MFS_TRX_ID_MIN_LENGTH, env.MFS_TRX_ID_MAX_LENGTH),
    `Enter a valid transaction ID (${env.MFS_TRX_ID_MIN_LENGTH}–${env.MFS_TRX_ID_MAX_LENGTH} letters or digits).`,
  );

/** Customer-submitted manual payment proof against their own order. */
export const manualPaymentSubmissionSchema = z.object({
  senderNumber: senderNumberSchema,
  trxId: trxIdSchema,
});

export type ManualPaymentSubmissionInput = z.infer<typeof manualPaymentSubmissionSchema>;

export const orderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

export const orderParamsSchema = z.object({
  id: objectIdSchema,
});
