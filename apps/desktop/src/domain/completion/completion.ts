import type { Completion, Task } from '../../shared/types';

// (role: toggle completion for (taskId, date), type: (Completion[], string, string) => Completion[])
export function toggleCompletion(
  completions: Completion[],
  taskId: string,
  date: string,
): Completion[] {
  const exists = completions.some(
    (c) => c.taskId === taskId && c.date === date,
  );
  if (exists) {
    return completions.filter((c) => !(c.taskId === taskId && c.date === date));
  }
  return [...completions, { taskId, date }];
}

// (role: check if task completed on a date, type: (Completion[], string, string) => boolean)
export function isDoneOn(
  completions: Completion[],
  taskId: string,
  date: string,
): boolean {
  return completions.some((c) => c.taskId === taskId && c.date === date);
}

// (role: get completion count per task across all dates, type: (Completion[], string)=>number)
export function getCompletionCountForTask(
  completions: Completion[],
  taskId: string,
): number {
  return completions.filter((c) => c.taskId === taskId).length;
}

// (role: check auto archive condition, type: (Task, Completion[])=>boolean)
export function shouldAutoArchive(task: Task, completions: Completion[]): boolean {
  if (task.autoArchiveAfter == null) return false;
  return getCompletionCountForTask(completions, task.id) >= task.autoArchiveAfter;
}
