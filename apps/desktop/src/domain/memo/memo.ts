import type { TaskDailyMemo } from '../../shared/types';

// (role: upsert per-task per-day memo, type: (TaskDailyMemo[], input)=>TaskDailyMemo[])
export function upsertDailyMemo(
  memos: TaskDailyMemo[],
  input: {
    taskId: string;
    date: string;
    text: string;
    updatedAt: string;
  },
): TaskDailyMemo[] {
  const text = input.text.trim();

  // Empty text deletes memo entry for the day.
  if (!text) {
    return memos.filter(
      (m) => !(m.taskId === input.taskId && m.date === input.date),
    );
  }

  const index = memos.findIndex(
    (m) => m.taskId === input.taskId && m.date === input.date,
  );

  const next: TaskDailyMemo = {
    id: `${input.taskId}_${input.date}`,
    taskId: input.taskId,
    date: input.date,
    text,
    updatedAt: input.updatedAt,
  };

  if (index === -1) return [next, ...memos];

  const copied = [...memos];
  copied[index] = next;
  return copied;
}

// (role: read memo text by task/date, type: (TaskDailyMemo[], string, string)=>string)
export function getDailyMemoText(
  memos: TaskDailyMemo[],
  taskId: string,
  date: string,
): string {
  const found = memos.find((m) => m.taskId === taskId && m.date === date);
  return found?.text ?? '';
}
