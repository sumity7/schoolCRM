import { Schema, type Types } from 'mongoose';
import { defineTenantModel } from '../../core/tenancy/registry';

export type NoticeAudience = 'everyone' | 'staff' | 'parents' | 'sections';

export interface INotice {
  title: string;
  body: string;
  audience: NoticeAudience;
  /** for audience 'sections': parents of students in these sections + staff teaching them */
  sectionIds: Types.ObjectId[];
  emailParents: boolean;
  status: 'published' | 'withdrawn';
  createdByName: string;
  publishedAt: Date;
  withdrawnAt?: Date | null;
}
export const NoticeModel = defineTenantModel<INotice>(
  'Notice',
  {
    title: { type: String, required: true, trim: true, maxlength: 150 },
    body: { type: String, required: true, maxlength: 5000 },
    audience: { type: String, enum: ['everyone', 'staff', 'parents', 'sections'], required: true },
    sectionIds: { type: ['ObjectId'], default: [] },
    emailParents: { type: Boolean, default: false },
    status: { type: String, enum: ['published', 'withdrawn'], required: true, default: 'published' },
    createdByName: { type: String, required: true, maxlength: 120 },
    publishedAt: { type: Date, required: true },
    withdrawnAt: { type: Date, default: null },
  },
  (s) => {
    s.index({ schoolId: 1, status: 1, publishedAt: -1 });
    s.index({ schoolId: 1, sectionIds: 1, publishedAt: -1 });
  },
);

export interface INoticeRead { noticeId: Types.ObjectId; membershipId: Types.ObjectId; readAt: Date }
export const NoticeReadModel = defineTenantModel<INoticeRead>(
  'NoticeRead',
  { noticeId: { type: 'ObjectId', required: true }, membershipId: { type: 'ObjectId', required: true }, readAt: { type: Date, required: true } },
  (s) => s.index({ schoolId: 1, noticeId: 1, membershipId: 1 }, { unique: true }),
);

/** One row per (notice, email address): makes the email job idempotent across retries and dedups siblings' parents. */
export interface INoticeDelivery { noticeId: Types.ObjectId; channel: 'email'; destination: string; status: 'sent_dev' | 'sent' | 'disabled' | 'failed'; error?: string | null }
export const NoticeDeliveryModel = defineTenantModel<INoticeDelivery>(
  'NoticeDelivery',
  {
    noticeId: { type: 'ObjectId', required: true },
    channel: { type: String, enum: ['email'], required: true },
    destination: { type: String, required: true, lowercase: true },
    status: { type: String, enum: ['sent_dev', 'sent', 'disabled', 'failed'], required: true },
    error: { type: String, default: null },
  },
  (s) => s.index({ schoolId: 1, noticeId: 1, channel: 1, destination: 1 }, { unique: true }),
);

void Schema;
