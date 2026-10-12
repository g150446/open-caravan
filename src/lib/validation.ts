import { z } from 'zod';
export const keySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(x => !isNaN(new Date(`${x}T00:00:00Z`).getTime()) && new Date(`${x}T00:00:00Z`).toISOString().slice(0,10) === x, '日付が不正です');
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const recurrenceSchema = z.object({kind: z.enum(['weekly','monthly']), interval: z.number().int().min(1).max(2), weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7), ordinals: z.array(z.number().int().min(1).max(5)).max(5)}).refine(x => x.kind !== 'monthly' || x.ordinals.length > 0, '第何曜日か選択してください');
export const appointmentSchema = z.object({
  patientId: z.string().nullable(), title: z.string().trim().max(200), date: keySchema,
  startTime: time, endTime: time, staffIds: z.array(z.string()).min(1).max(20),
  memo: z.string().max(30000), recurrence: recurrenceSchema.nullable().optional(), endDate: keySchema.optional(),
  version: z.number().int().positive().optional(), scope: z.enum(['one','future']).default('one')
}).refine(x => x.endTime > x.startTime, '終了時刻は開始時刻より後にしてください').refine(x => x.patientId || x.title, '患者または予定名が必要です').refine(x => !x.recurrence || (x.endDate && x.endDate >= x.date), '繰り返し終了日を指定してください');
export const patientSchema = z.object({number: z.string().trim().min(1).max(40), name: z.string().trim().min(1).max(100), kana: z.string().max(100).default(''), address: z.string().max(500), movacalUrl: z.string().max(1000).refine(x => { if (!x) return true; try { const u = new URL(x); return u.protocol === 'https:' && !u.username && !u.password && (u.hostname === 'movacal.net' || u.hostname.endsWith('.movacal.net')); } catch {return false;} }, 'モバカルのHTTPS URLを入力してください'), handover: z.string().max(30000).default(''), visitFrequency: z.string().trim().max(40).default(''), facilityId: z.string().nullable(), active: z.boolean().default(true), version: z.number().int().positive().optional()});
export const facilitySchema = z.object({name: z.string().trim().min(1).max(200), address: z.string().max(500), version: z.number().int().positive().optional()});
export const staffSchema = z.object({login: z.string().trim().regex(/^[A-Za-z0-9_.-]{3,80}$/), name: z.string().trim().min(1).max(100), kana: z.string().trim().max(100).default(''), profession: z.enum(['医師','看護師','事務','アシスタント','その他']), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), role: z.enum(['ADMIN','STAFF']), active: z.boolean(), password: z.string().max(128).optional(), version: z.number().int().positive().optional()});
