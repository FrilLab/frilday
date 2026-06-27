import { z } from 'zod';

// (role: day-of-week token schema, type: zod schema)
export const DayOfWeekSchema = z.union([
  z.literal('Mon'),
  z.literal('Tue'),
  z.literal('Wed'),
  z.literal('Thu'),
  z.literal('Fri'),
  z.literal('Sat'),
  z.literal('Sun'),
]);

// (role: category discriminator schema, type: zod schema)
export const CategorySchema = z.union([
  z.literal('weekday'),
  z.literal('weekend'),
  z.literal('daily'),
  z.literal('custom'),
]);

const AutoArchiveAfterSchema = z.preprocess((value) => {
  if (value === '' || value == null) return null;

  const num =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : NaN;

  if (!Number.isInteger(num) || num < 1) return null;
  return num;
}, z.number().int().min(1).nullable());

const RepeatCountSchema = z.preprocess((value) => {
  if (value === '' || value == null) return null;

  const num =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : NaN;

  if (!Number.isInteger(num) || num < 1) return null;
  return num;
}, z.number().int().min(1).nullable());

const StartYmdSchema = z.preprocess((value) => {
  if (value === '' || value == null) return null;
  if (typeof value !== 'string') return null;
  const ymd = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());

// (role: task schema, type: zod schema)
export const TaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional().default(''),
  category: CategorySchema,
  daysOfWeek: z.array(DayOfWeekSchema).min(1),
  durationMinutes: z.number().int().min(1).max(720),
  startYmd: StartYmdSchema.optional().default(null),
  autoArchiveAfter: AutoArchiveAfterSchema.optional().default(null),
  repeatCount: RepeatCountSchema.optional().default(null),
  isActive: z.boolean(),
  createdAt: z.string().min(1),
});

// (role: task list schema, type: zod schema)
export const TasksSchema = z.array(TaskSchema);

// (role: completion schema, type: zod schema)
export const CompletionSchema = z.object({
  taskId: z.string().min(1),
  date: z.string().min(1),
});

// (role: completions schema, type: zod schema)
export const CompletionsSchema = z.array(CompletionSchema);

// (role: time entry schema, type: zod schema)
export const TimeEntrySchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  date: z.string().min(1),
  startedAt: z.string().min(1),
  endedAt: z.string().nullable(),
  minutes: z
    .number()
    .int()
    .min(0)
    .max(24 * 60),
});

// (role: time entry list schema, type: zod schema)
export const TimeEntriesSchema = z.array(TimeEntrySchema);

// (role: memo schema, type: zod schema)
export const TaskDailyMemoSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  date: z.string().min(1),
  text: z.string(),
  updatedAt: z.string().min(1),
});

// (role: memo list schema, type: zod schema)
export const TaskDailyMemosSchema = z.array(TaskDailyMemoSchema);

// (role: inferred types, type: types)
export type DayOfWeek = z.infer<typeof DayOfWeekSchema>;
export type Category = z.infer<typeof CategorySchema>;
