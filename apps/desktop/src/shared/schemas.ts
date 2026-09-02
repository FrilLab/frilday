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

const CompletionLimitSchema = z.preprocess((value) => {
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

const OccurrenceLimitSchema = z.preprocess((value) => {
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

const YmdSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, 'Invalid calendar date');

const IsoTimestampSchema = z.string().datetime({ offset: true });

const StartYmdSchema = z.preprocess((value) => {
  if (value === '' || value == null) return null;
  return typeof value === 'string' ? value.trim() : value;
}, YmdSchema.nullable());

// (role: task schema, type: zod schema)
export const TaskSchema = z.object({
  id: z.string().min(1),
  // Persisted text remains backward-compatible with records created before
  // the current editor limits. New and edited routines are validated by the
  // form and task factory before they reach persistence.
  title: z.string().min(1),
  description: z.string().optional().default(''),
  category: CategorySchema,
  daysOfWeek: z.array(DayOfWeekSchema).min(1),
  durationMinutes: z.number().int().min(1).max(720),
  startYmd: StartYmdSchema.optional().default(null),
  completionLimit: CompletionLimitSchema.optional().default(null),
  occurrenceLimit: OccurrenceLimitSchema.optional().default(null),
  isActive: z.boolean(),
  createdAt: IsoTimestampSchema,
});

// (role: task list schema, type: zod schema)
export const TasksSchema = z.array(TaskSchema);

// (role: completion schema, type: zod schema)
export const CompletionSchema = z.object({
  taskId: z.string().min(1),
  date: YmdSchema,
});

// (role: completions schema, type: zod schema)
export const CompletionsSchema = z.array(CompletionSchema);

// (role: time entry schema, type: zod schema)
export const TimeEntrySchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  date: YmdSchema,
  startedAt: IsoTimestampSchema,
  endedAt: IsoTimestampSchema.nullable(),
  pausedAt: IsoTimestampSchema.nullable().optional().default(null),
  activeStartedAt: IsoTimestampSchema.nullable().optional().default(null),
  accumulatedMillis: z.number().int().min(0).optional().default(0),
  minutes: z.number().int().min(0),
});

// (role: time entry list schema, type: zod schema)
export const TimeEntriesSchema = z.array(TimeEntrySchema);

// (role: memo schema, type: zod schema)
export const TaskDailyMemoSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  date: YmdSchema,
  text: z.string(),
  updatedAt: IsoTimestampSchema,
});

// (role: memo list schema, type: zod schema)
export const TaskDailyMemosSchema = z.array(TaskDailyMemoSchema);

// (role: inferred types, type: types)
export type DayOfWeek = z.infer<typeof DayOfWeekSchema>;
export type Category = z.infer<typeof CategorySchema>;
