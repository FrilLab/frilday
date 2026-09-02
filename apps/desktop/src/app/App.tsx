import { useContext, useMemo } from 'react';

import { HeaderTabs } from './layout/HeaderTabs';
import { ErrorBanner } from './layout/ErrorBanner';

import { TodayPage } from './pages/TodayPage';
import { ManagePage } from './pages/ManagePage';
import { SchedulePage } from './pages/SchedulePage';

import { useAppModel } from './hooks/useAppModel';
import { useTargetReachedTick } from '../features/task/hooks/useTargetReachedTick';

import type { Task } from '../shared/types';

import { ToastHost } from './ui/ToastHost';
import { initNotifier } from './bootstrap/initNotifier';
import { startOfWeekMonday, toYmd } from '../shared/utils/date';
import { LocaleContext } from '../i18n/context';
import { SettingsPage } from './pages/SettingsPage';
import { useTimerKeyboardShortcuts } from '../features/task/hooks/useTimerKeyboardShortcuts';

// Toast
// NOTE: Initializing outside App prevents re-init on every render.
initNotifier();

export default function App() {
  // (role: app-wide target feedback tick, type: () => void)
  useTargetReachedTick();

  const m = useAppModel();
  const { t } = useContext(LocaleContext);

  useTimerKeyboardShortcuts({
    tab: m.tab,
    setTab: m.setTab,
    todayTasks: m.todayTasks,
    taskDayStates: m.taskDayStates,
    runningTaskId: m.runningTaskId,
    onStartTimer: m.handleStartTimer,
    onPauseTimer: m.handleStopTimer,
    onFinishTimer: m.handleFinishTimer,
    t,
  });

  // (role: schedule view week start (Monday), type: string (YYYY-MM-DD))
  const scheduleWeekStartYmd = useMemo(() => {
    return toYmd(startOfWeekMonday(m.today));
  }, [m.today]);

  if (!m.hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-sm text-zinc-400">
        Loading data...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <ToastHost durationMs={2000} />

      <div className="mx-auto w-full px-4 py-6 sm:px-6 sm:py-8 lg:px-8 h-full">
        <div className="mx-auto w-full max-w-full lg:max-w-5xl xl:max-w-7xl 2xl:max-w-screen-2xl">
          <header className="mb-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0 w-full flex justify-between ">
                <h1 className="text-2xl font-semibold tracking-tight">
                  FrilDay
                </h1>
              </div>

              <div className="md:pt-1">
                <HeaderTabs tab={m.tab} onChange={m.setTab} />
              </div>
            </div>

            {m.errorMsg && (
              <div className="mt-4">
                <ErrorBanner message={m.errorMsg} onDismiss={m.clearError} />
              </div>
            )}
          </header>

          <main className="min-w-0">
            {m.tab === 'today' && (
              <TodayPage
                todayYmd={m.todayYmd}
                todayDow={m.todayDow}
                todayTasks={m.todayTasks}
                todayStats={m.todayStats}
                todayTimeTotals={m.todayTimeTotals}
                taskDayStates={m.taskDayStates}
                completions={m.completions}
                timeEntries={m.timeEntries}
                nowIso={m.nowIso}
                runningTaskId={m.runningTaskId}
                openTimerTaskId={m.openTimerTaskId}
                activeTimerTask={m.activeTimerTask}
                activeTimerPlannedMinutes={m.activeTimerPlannedMinutes}
                activeTimerPhase={m.activeTimerPhase}
                getMemoText={m.getMemoText}
                onSaveMemo={m.handleSaveDailyMemo}
                onToggleToday={(task: Task) =>
                  m.toggleToday({ taskId: task.id, today: m.today })
                }
                onSetPlanDuration={m.setPlanDurationOverride}
                onSkipPlan={m.skipPlan}
                onRestorePlan={m.restorePlan}
                onArchive={m.archiveTask}
                onError={m.setError}
                onStartTimer={m.handleStartTimer}
                onStopTimer={m.handleStopTimer}
                onPauseTimer={m.handlePauseTimer}
                onResumeTimer={m.handleResumeTimer}
                onFinishTimer={m.handleFinishTimer}
                targetReachedTaskIds={m.targetReachedTaskIds}
                onBackToPlan={m.handleBackToPlan}
              />
            )}

            {m.tab === 'manage' && (
              <ManagePage
                tasks={m.manageTasks}
                completions={m.completions}
                todayYmd={m.todayYmd}
                todayDow={m.todayDow}
                manageQuery={m.manageQuery}
                setManageQuery={m.setManageQuery}
                manageCategory={m.manageCategory}
                setManageCategory={m.setManageCategory}
                showArchived={m.showArchived}
                setShowArchived={m.setShowArchived}
                onReset={m.handleResetManage}
                onCreate={m.handleCreate}
                onUpdateTaskMeta={m.handleUpdateTaskMeta}
                onToggleToday={(task: Task) =>
                  m.toggleToday({ taskId: task.id, today: m.today })
                }
                onArchive={m.archiveTask}
                onRestore={m.handleRestore}
                onError={m.setError}
                timeEntries={m.timeEntries}
                nowIso={m.nowIso}
                runningTaskId={m.runningTaskId}
                openTimerTaskId={m.openTimerTaskId}
                taskDayStates={m.taskDayStates}
                onStartTimer={m.handleStartTimer}
                onStopTimer={m.handleStopTimer}
                onFinishTimer={m.handleFinishTimer}
              />
            )}

            {m.tab === 'schedule' && (
              <SchedulePage
                tasks={m.tasks}
                completions={m.completions}
                plans={m.plans}
                getMemoText={m.getMemoText}
                weekStartYmd={scheduleWeekStartYmd}
                onOpenTask={() => m.setTab('manage')}
              />
            )}

            {m.tab === 'settings' && <SettingsPage />}
          </main>

          <footer className="mt-10 border-t border-zinc-800 pt-4 text-xs leading-relaxed text-zinc-500">
            {t('note.nextPlan')}
          </footer>
        </div>
      </div>
    </div>
  );
}
