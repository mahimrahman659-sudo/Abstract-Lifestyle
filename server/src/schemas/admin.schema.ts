import { z } from 'zod';
import { objectIdSchema } from './common.schema.js';
import { normalizeBdMobile } from '../utils/phone.js';
import { ACTIVITY_EVENT_TYPES } from '../models/activity-event.model.js';

/** Optional ISO-8601 date query param → Date (rejects unparseable values). */
const isoDateParam = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'must be a valid ISO date')
  .transform((value) => new Date(value));

export const adminIdParamsSchema = z.object({ id: objectIdSchema });

export const adminOrderStatusUpdateSchema = z.object({
  status: z.enum(['processing', 'shipped', 'delivered', 'cancelled']),
});

const paymentStatuses = [
  'unpaid',
  'awaiting_payment',
  'pending_verification',
  'paid',
  'rejected',
  'refund_pending',
  'refunded',
  'cancelled',
] as const;

export const adminPaymentReviewSchema = z
  .object({
    /** The exact pending claim the admin reviewed — prevents stale decisions. */
    claimId: objectIdSchema,
    decision: z.enum(['paid', 'rejected']),
    rejectionReason: z.string().trim().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.decision === 'rejected' && (!value.rejectionReason || value.rejectionReason.length < 3)) {
      ctx.addIssue({
        code: 'custom',
        path: ['rejectionReason'],
        message: 'Enter a rejection reason (at least 3 characters)',
      });
    }
  });

export type AdminPaymentReviewInput = z.infer<typeof adminPaymentReviewSchema>;

const refundReferenceSchema = z
  .string()
  .trim()
  .min(4, 'Enter the provider refund transaction reference')
  .max(100, 'Refund reference is too long')
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    'Refund reference may contain letters, digits, dots, underscores and hyphens',
  );

const refundRecipientSchema = z
  .string()
  .trim()
  .min(1, 'Enter the customer refund account')
  .max(20, 'Enter a valid Bangladeshi mobile number.')
  .transform((value) => normalizeBdMobile(value) ?? value)
  .pipe(z.string().regex(/^01[3-9]\d{8}$/, 'Enter a valid Bangladeshi mobile number.'));

export const adminPaymentRefundSchema = z.object({
  refundReference: refundReferenceSchema,
  /** Integer poisha. Must equal the order's paid total. */
  refundAmount: z
    .number()
    .int('Refund amount must be an integer in poisha')
    .positive('Refund amount must be positive'),
  refundRecipient: refundRecipientSchema,
  confirmed: z
    .boolean()
    .refine((value) => value === true, 'Confirm you checked the actual refund record'),
  note: z.string().trim().max(500).optional(),
});

export type AdminPaymentRefundInput = z.infer<typeof adminPaymentRefundSchema>;

export const adminVariantQuerySchema = z.object({
  lowStock: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export const adminProductQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export const adminOrderQuerySchema = z.object({
  search: z.string().trim().max(40).refine(
    (value) => normalizeBdMobile(value) !== null || /^AL-\d{8}-[A-Z2-9]{4}$/i.test(value),
    'Enter a complete order number or Bangladeshi mobile number.',
  ).optional(),
  status: z.enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled']).optional(),
  paymentStatus: z.enum(paymentStatuses).optional(),
  paymentMethod: z.enum(['cod', 'bkash', 'nagad', 'rocket']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export const adminCustomerQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export const adminActivityRecentQuerySchema = z.object({
  type: z.enum(ACTIVITY_EVENT_TYPES).optional(),
  source: z.enum(['client', 'server']).optional(),
  userId: objectIdSchema.optional(),
  from: isoDateParam.optional(),
  to: isoDateParam.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});

export const adminActivityTimelineQuerySchema = z.object({
  from: isoDateParam.optional(),
  to: isoDateParam.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});

export type AdminOrderStatusUpdateInput = z.infer<typeof adminOrderStatusUpdateSchema>;
export type AdminVariantQuery = z.infer<typeof adminVariantQuerySchema>;
export type AdminProductQuery = z.infer<typeof adminProductQuerySchema>;
export type AdminOrderQuery = z.infer<typeof adminOrderQuerySchema>;
export type AdminCustomerQuery = z.infer<typeof adminCustomerQuerySchema>;
export type AdminActivityRecentQuery = z.infer<typeof adminActivityRecentQuerySchema>;
export type AdminActivityTimelineQuery = z.infer<typeof adminActivityTimelineQuerySchema>;
