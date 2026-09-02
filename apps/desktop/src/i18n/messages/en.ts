export const en = {
  common: {
    today: 'Today',
    manage: 'Manage',
    schedule: 'Schedule',
    settings: 'Settings',
    add: 'Add',
    save: 'Save',
    edit: 'Edit',
    memo: 'Memo',
    reset: 'Reset',
    all: 'All',
    weekday: 'Weekday',
    weekend: 'Weekend',
    daily: 'Daily',
    custom: 'Custom',
    archived: 'Archived',
    active: 'Active',
    running: 'Running',
    time: 'Time',
    completion: 'Completion',
  },

  task: {
    createTask: 'Create routine',
    createTaskHelp: 'Define a reusable recurring intention and its defaults.',
    title: 'Title',
    titlePlaceholder: 'e.g. Exercise',
    description: 'Description',
    descriptionPlaceholder: 'Optional long-lived note about this routine',
    startDate: 'Start date',
    startDateHint: 'Leave blank to make it available immediately.',
    memo: 'Memo',
    memoPlaceholder: 'Write today-specific notes for this task',
    autoArchiveAfter: 'Auto-archive after completions',
    autoArchiveAfterHint: 'Optional. Archive after this many completion marks.',
    repeatCount: 'Occurrence limit',
    repeatCountHint: 'Optional lifetime cap on scheduled occurrences.',
    unlimited: 'None',
    defaultDuration: 'Default planned duration (min)',
    recurrence: 'Recurrence',
    schedule: 'Recurrence',
    days: 'Days',
    plan: 'Plan',
    planned: 'Planned',
    actualTracked: 'Tracked',
    todaySpent: 'Today',
    todayTasksDescription: 'Only tasks scheduled for today are shown here.',
    todayTasksDuringExecution:
      'The current session stays in focus while today’s plan remains available below.',
    plansToday: 'plans',
    manageTasks: 'Manage routines',
    manageTasksDescription:
      'Maintain recurring defaults. Changes apply to future planning; history stays unchanged.',
    filters: 'Filters',
    filtersDescription: 'Scan recurring defaults by name or recurrence.',
    search: 'Search',
    searchPlaceholder: 'Search by routine name...',
    category: 'Recurrence',
    viewOptions: 'View options',
    showArchived: 'Show archived',
    showingArchived: 'Showing archived',
    addScheduleCustom: 'custom (pick days)',
    addScheduleDaily: 'daily (Mon-Sun)',
    addScheduleWeekday: 'weekday (Mon-Fri)',
    addScheduleWeekend: 'weekend (Sat-Sun)',
    pickDays: 'Pick days',
    customCheckableNote:
      'Custom routines are only scheduled on the selected days.',
    validation: {
      titleRequired: 'Title is required.',
      titleTooLong: 'Title is too long (max 80).',
      durationMin: 'Duration must be >= 1 minute.',
      durationTooLarge: 'Duration too large.',
      durationInvalid:
        'Default planned duration must be a whole number from 1 to 720 minutes.',
      positiveLimit: 'Limit must be a positive whole number.',
      invalidDate: 'Enter a valid calendar date.',
      startDateBeforeCreatedAt:
        'Start date cannot be earlier than created date.',
      pickOneDay: 'Pick at least one day.',
    },
    archive: 'Archive',
    restore: 'Restore',
    delete: 'Delete',
    markComplete: 'Mark "{task}" complete',
    markIncomplete: 'Mark "{task}" incomplete',
    toggleMemoForTask: 'Toggle memo for "{task}"',
    todayTasks: "Today's tasks",
    noTasks: 'No tasks.',
    noTasksScheduledToday: 'No tasks scheduled for today.',
    noTasksScheduledManage: 'No tasks match the current filters.',
    noTasksInSchedule: 'No tasks scheduled.',
  },

  stats: {
    scheduledToday: 'Scheduled today',
    done: 'Done',
    weeklyStats: 'Weekly stats',
    totalCompletionRate: 'Total completion rate',
    weekdayCompletionRate: 'Weekday completion rate',
    weekendCompletionRate: 'Weekend completion rate',
    dailyCompletionRate: 'Daily completion rate',
    customCompletionRate: 'Custom completion rate',
    weekStart: 'Week start',
    mvpRule:
      'MVP rule: A task counts as completed for the week if it has at least one check within the week.',
  },

  time: {
    durationMin: 'Duration (min)',
    basedOnTodayPlannedMinutes: "Based on today's planned minutes.",
    plannedVsActual: 'Tracked / planned',
    trackedToday: 'Actual time tracked today',
    start: 'Start',
    stop: 'Stop',
    pause: 'Pause',
    resume: 'Resume',
    finish: 'Finish',
    targetReached: 'Planned target reached.',
    overtimeTracking: 'Overtime is still tracking.',
    startTimerForTask: 'Start timer for "{task}"',
    resumeTimerForTask: 'Resume timer for "{task}"',
    pauseTimerForTask: 'Pause timer for "{task}"',
    finishTimerForTask: 'Finish timer for "{task}"',
    hourShort: 'h',
    minuteShort: 'm',
    day: {
      Mon: 'Mon',
      Tue: 'Tue',
      Wed: 'Wed',
      Thu: 'Thu',
      Fri: 'Fri',
      Sat: 'Sat',
      Sun: 'Sun',
    },
  },

  timer: {
    execution: 'Active session',
    ready: 'Ready',
    running: 'Running',
    paused: 'Paused',
    finished: 'Finished',
    planned: 'Planned',
    actual: 'Actual',
    remaining: 'Remaining',
    overBy: 'Over by',
    overtime: 'Overtime',
    targetReached: 'Planned target reached',
    overtimeHint: 'Keep tracking if the work continues, or finish to save actual time.',
    progressLabel: 'Planned time progress',
    progressPercent: '{percent}% of planned time',
    actualTrackedHint: 'Actual time is calculated from session timestamps.',
    finishedHint: 'Actual time is committed. Continue from today’s plan when you are ready.',
    start: 'Start timer',
    pause: 'Pause',
    resume: 'Resume',
    finish: 'Finish',
    backToPlan: 'Back to plan',
    switchConfirm:
      'Switch from "{current}" to "{next}"? The current session will be stopped and the new plan will start.',
    pausedSwitchBlocked:
      'Resume or finish "{current}" before starting another session.',
  },

  today: {
    executionHint: 'Start the next plan when you are ready.',
    activeExecutionHint:
      'Stay with the current plan. Its actual time is updating now.',
  },

  period: {
    allTime: 'All time',
    thisMonth: 'This month',
    thisWeek: 'This week',
    basedOnScheduledVsChecked:
      'Based on scheduled task-days vs checked task-days.',
  },

  empty: {
    notScheduledToday: '(not scheduled today)',
  },

  note: {
    clickToDismiss: 'Click to dismiss',
    scheduleDescription:
      'See this week\'s tasks at a glance by weekday.\nCompleted items stay visible on the exact date they were finished.',
    nextPlan:
      'Define recurring routines, turn them into executable plans, and compare planned time with actual time. Archived routines stay in history while leaving future planning.',
    deleteConfirm: 'Delete "{title}" permanently?\nThis cannot be undone.',
    finishConfirm: 'Finish tracking "{title}"?\nTracked time will be kept.',
    taskNotScheduledToday: 'This task is not scheduled for today.',
  },

  keyboard: {
    title: 'Keyboard shortcuts',
    start: 'Start or resume the first available task',
    pause: 'Pause the running timer',
    finish: 'Finish the running timer',
    today: 'Return to Today and focus the timer',
    hint: 'Shortcuts are disabled while typing in a text field.',
  },

  schedule: {
    prevWeek: 'Prev',
    thisWeek: 'This Week',
    nextWeek: 'Next',
    weekRange: '{start} ~ {end}',
  },

  notify: {
    timerDone: {
      title: 'Timer completed',
      body: '"{task}" is finished.',
    },
    targetReached: {
      title: 'Planned target reached',
      body: '"{task}" reached its planned time. Overtime is still tracking.',
    },
  },

  settings: {
    language: {
      title: 'Language',
      desc: 'Choose the display language for the app.',
      options: {
        en: 'English',
        ko: 'Korean',
        ja: 'Japanese',
      },
    },
    notifications: {
      timerDone: {
        title: 'Target reached notification',
        desc: 'Notify when a running timer reaches its planned duration.',
        hintDenied:
          'Notification permission was denied. Enable notifications in system settings and try again.',
      },
    },
  },
};
