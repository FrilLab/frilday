import type { Plan, PlanSource, PlanStatus } from '../../shared/types';

export const localPlanSource: PlanSource = {
  kind: 'local',
  providerId: null,
  calendarId: null,
  eventId: null,
  occurrenceId: null,
  availability: 'present',
};

/** Keep this byte-based prefix in lockstep with frilday-core's Plan id rule. */
export function routinePlanId(routineId: string, date: string): string {
  const byteLength = new TextEncoder().encode(routineId).length;
  return `routine-plan:${byteLength}:${routineId}:${date}`;
}

export function createRoutinePlan(input: {
  routineId: string;
  date: string;
  baselineDurationMinutes: number;
  durationOverrideMinutes?: number | null;
  status?: PlanStatus;
  movedToYmd?: string | null;
}): Plan {
  return {
    id: routinePlanId(input.routineId, input.date),
    routineId: input.routineId,
    date: input.date,
    baselineDurationMinutes: input.baselineDurationMinutes,
    durationOverrideMinutes: input.durationOverrideMinutes ?? null,
    status: input.status ?? 'planned',
    movedToYmd: input.movedToYmd ?? null,
    source: localPlanSource,
  };
}
