import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export type NotificationType =
  | 'payment_submitted'
  | 'payment_approved'
  | 'payment_rejected'
  | 'payment_refund_pending'
  | 'payment_refunded';

export type NotificationStatus = 'pending' | 'sent' | 'failed';

/**
 * Transactional outbox for customer notifications. Rows are written in the
 * same transaction as the payment transition; delivery runs afterwards and can
 * never reverse a committed payment change.
 */
export interface Notification {
  user: Types.ObjectId;
  order: Types.ObjectId;
  orderNumber: string;
  type: NotificationType;
  channel: 'in_app';
  message: string;
  status: NotificationStatus;
  attempts: number;
  availableAt: Date;
  sentAt: Date | null;
  lastError: string | null;
  /** Owner of the current dispatch lease; prevents concurrent double-processing. */
  lockedAt: Date | null;
  lockId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NotificationDocument = HydratedDocument<Notification>;

const notificationSchema = new Schema<Notification>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    orderNumber: { type: String, required: true },
    type: {
      type: String,
      enum: [
        'payment_submitted',
        'payment_approved',
        'payment_rejected',
        'payment_refund_pending',
        'payment_refunded',
      ],
      required: true,
    },
    channel: { type: String, enum: ['in_app'], default: 'in_app' },
    message: { type: String, required: true },
    status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
    attempts: { type: Number, default: 0, min: 0 },
    availableAt: { type: Date, default: () => new Date() },
    sentAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    lockedAt: { type: Date, default: null },
    lockId: { type: String, default: null },
  },
  { timestamps: true },
);

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ status: 1, availableAt: 1 });

export const NotificationModel = model<Notification>('Notification', notificationSchema);
