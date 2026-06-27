import { useContext } from 'react';
import type { Completion, DayOfWeek, Task, TimeEntry } from '../types';
import { LocaleContext } from '../../../i18n/context';
import { TaskListItem } from './TaskListItem';

interface TaskListProps {
  tasks: Task[];
  completions: Completion[];
  timeEntries: TimeEntry[];
  todayYmd: string;
  todayDow: DayOfWeek;

  nowIso: string; // (role: ui clock iso, type: string)
  runningTaskIdToday: string | null; // (role: single running task id, type: string | null)

  getMemoText?: (taskId: string, date: string) => string;

  variant: 'today' | 'manage';
  onToggleToday: (task: Task) => void;
  onArchive: (taskId: string) => void;
  onRestore?: (taskId: string) => void;
  onDelete?: (taskId: string) => void;
  onSaveMemo?: (input: { taskId: string; date: string; text: string }) => void;
  onUpdateTaskMeta?: (input: {
    taskId: string;
    title: string;
    description: string;
    startYmd: string | null;
    autoArchiveAfter: number | null;
  }) => void;

  onStartTimer: (task: Task) => void;
  onStopTimer: (task: Task) => void;

  onError: (msg: string) => void;
}

export function TaskList(props: TaskListProps) {
  const { t } = useContext(LocaleContext);
  const { tasks } = props;

  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 text-sm text-zinc-500">
        {t('task.noTasks')}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {tasks.map((t) => (
        <TaskListItem
          key={t.id}
          task={t}
          memoText={props.getMemoText?.(t.id, props.todayYmd) ?? ''}
          completions={props.completions}
          timeEntries={props.timeEntries}
          todayYmd={props.todayYmd}
          todayDow={props.todayDow}
          nowIso={props.nowIso}
          runningTaskIdToday={props.runningTaskIdToday}
          variant={props.variant}
          onToggleToday={props.onToggleToday}
          onArchive={props.onArchive}
          onRestore={props.onRestore}
          onDelete={props.onDelete}
          onSaveMemo={props.onSaveMemo}
          onUpdateTaskMeta={props.onUpdateTaskMeta}
          onStartTimer={props.onStartTimer}
          onStopTimer={props.onStopTimer}
          onError={props.onError}
        />
      ))}
    </div>
  );
}
