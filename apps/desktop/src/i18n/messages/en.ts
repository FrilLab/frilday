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
    running: 'Running',
    time: 'Time',
    completion: 'Completion',
  },

  task: {
    createTask: 'Create task',
    createTaskHelp: 'Choose a schedule rule, duration, and add a task.',
    title: 'Title',
    titlePlaceholder: 'e.g. Exercise',
    description: 'Description',
    descriptionPlaceholder: 'Optional long-lived note about this task',
    startDate: 'Start date',
    startDateHint: 'Leave blank to make it available immediately.',
    memo: 'Memo',
    memoPlaceholder: 'Write today-specific notes for this task',
    autoArchiveAfter: 'Completion limit',
    autoArchiveAfterHint: 'Leave blank for no limit.',
    schedule: 'Schedule',
    days: 'Days',
    plan: 'Plan',
    todaySpent: 'Today',
    todayTasksDescription: 'Only tasks scheduled for today are shown here.',
    manageTasks: 'Manage tasks',
    manageTasksDescription: 'Your tasks list with the current filters.',
    filters: 'Filters',
    filtersDescription: 'Search and filter when tasks grow.',
    search: 'Search',
    searchPlaceholder: 'Search by title...',
    category: 'Category',
    viewOptions: 'View options',
    showArchived: 'Show archived',
    showingArchived: 'Showing archived',
    addScheduleCustom: 'custom (pick days)',
    addScheduleDaily: 'daily (Mon-Sun)',
    addScheduleWeekday: 'weekday (Mon-Fri)',
    addScheduleWeekend: 'weekend (Sat-Sun)',
    pickDays: 'Pick days',
    customCheckableNote:
      'Custom tasks are only checkable on the selected days.',
    validation: {
      titleRequired: 'Title is required.',
      titleTooLong: 'Title is too long (max 80).',
      durationMin: 'Duration must be >= 1 minute.',
      durationTooLarge: 'Duration too large.',
      startDateBeforeCreatedAt:
        'Start date cannot be earlier than created date.',
      pickOneDay: 'Pick at least one day.',
    },
    archive: 'Archive',
    restore: 'Restore',
    delete: 'Delete',
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
    start: 'Start',
    stop: 'Stop',
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
      'Organize what matters today, track completion and time spent, and keep steady routines with repeat schedules and daily memos. Tasks that hit your goal can be auto-archived so your active list stays focused and clean.',
    deleteConfirm: 'Delete "{title}" permanently?\nThis cannot be undone.',
    taskNotScheduledToday: 'This task is not scheduled for today.',
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
        title: 'Timer done notification',
        desc: 'Notify when a running timer completes automatically.',
        hintDenied:
          'Notification permission was denied. Enable notifications in system settings and try again.',
      },
    },
  },
};
