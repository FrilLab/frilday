export const ja = {
  common: {
    today: '今日',
    manage: '管理',
    schedule: 'スケジュール',
    settings: '設定',
    add: '追加',
    save: '保存',
    edit: '編集',
    memo: 'メモ',
    reset: 'リセット',
    all: 'すべて',
    weekday: '平日',
    weekend: '週末',
    daily: '毎日',
    custom: 'カスタム',
    archived: 'アーカイブ済み',
    running: '実行中',
    time: '時間',
    completion: '達成率',
  },

  task: {
    createTask: 'タスク作成',
    createTaskHelp: '繰り返しルールと時間を設定してタスクを追加します。',
    title: 'タイトル',
    titlePlaceholder: '例: 運動',
    description: '説明',
    descriptionPlaceholder: 'このタスクの固定説明を入力してください (任意)',
    startDate: '開始日',
    startDateHint: '空欄ならすぐに予定対象になります。',
    memo: 'メモ',
    memoPlaceholder: 'このタスクの今日のメモを入力してください',
    autoArchiveAfter: '完了数の上限',
    autoArchiveAfterHint:
      '空欄なら上限なしです。',
    schedule: '予定',
    days: '曜日',
    plan: '計画',
    todaySpent: '今日',
    todayTasksDescription: 'ここには今日予定されているタスクのみ表示されます。',
    manageTasks: 'タスク管理',
    manageTasksDescription: '現在のフィルターが適用されたタスクリストです。',
    filters: 'フィルター',
    filtersDescription: 'タスクが増えたら検索とフィルターを使ってください。',
    search: '検索',
    searchPlaceholder: 'タイトルで検索...',
    category: 'カテゴリ',
    viewOptions: '表示オプション',
    showArchived: 'アーカイブを表示',
    showingArchived: 'アーカイブ表示中',
    addScheduleCustom: 'カスタム (曜日を選択)',
    addScheduleDaily: '毎日 (月-日)',
    addScheduleWeekday: '平日 (月-金)',
    addScheduleWeekend: '週末 (土-日)',
    pickDays: '曜日を選択',
    customCheckableNote: 'カスタムタスクは選択した曜日のみチェックできます。',
    validation: {
      titleRequired: 'タイトルは必須です。',
      titleTooLong: 'タイトルが長すぎます (最大80文字)。',
      durationMin: '時間は1分以上である必要があります。',
      durationTooLarge: '時間が大きすぎます。',
      startDateBeforeCreatedAt:
        '開始日は作成日より前にできません。',
      pickOneDay: '少なくとも1日選択してください。',
    },
    archive: 'アーカイブ',
    restore: '復元',
    delete: '削除',
    todayTasks: '今日のタスク',
    noTasks: 'タスクがありません。',
    noTasksScheduledToday: '今日予定されているタスクはありません。',
    noTasksScheduledManage: '現在のフィルターに一致するタスクはありません。',
    noTasksInSchedule: '予定されているタスクはありません。',
  },

  stats: {
    scheduledToday: '今日の予定',
    done: '完了',
    weeklyStats: '週間統計',
    totalCompletionRate: '全体の達成率',
    weekdayCompletionRate: '平日の達成率',
    weekendCompletionRate: '週末の達成率',
    dailyCompletionRate: '毎日の達成率',
    customCompletionRate: 'カスタムの達成率',
    weekStart: '週の開始日',
    mvpRule:
      'MVPルール: 週内で1回以上チェックがあれば、そのタスクは週の完了として計算されます。',
  },

  time: {
    durationMin: '時間 (分)',
    basedOnTodayPlannedMinutes: '今日の予定時間(分)を基準にしています。',
    start: '開始',
    stop: '停止',
    hourShort: '時間',
    minuteShort: '分',
    day: {
      Mon: '月',
      Tue: '火',
      Wed: '水',
      Thu: '木',
      Fri: '金',
      Sat: '土',
      Sun: '日',
    },
  },

  period: {
    allTime: '全期間',
    thisMonth: '今月',
    thisWeek: '今週',
    basedOnScheduledVsChecked:
      '予定されたタスク日とチェックされたタスク日を基準にしています。',
  },

  empty: {
    notScheduledToday: '(今日は予定なし)',
  },

  note: {
    clickToDismiss: 'クリックで閉じる',
    scheduleDescription:
      '今週のタスクを曜日ごとにひと目で確認できます。\n完了した項目は完了した日付の列に表示され続けます。',
    nextPlan:
      '今日やることを整理し、完了状況と使った時間を記録しましょう。繰り返し予定と日別メモで習慣を整え、目標回数に達したタスクは自動アーカイブで整理できるため、アクティブ一覧をすっきり保てます。',
    deleteConfirm:
      '"{title}" を完全に削除しますか?\nこの操作は元に戻せません。',
    taskNotScheduledToday: 'このタスクは今日の予定ではありません。',
  },

  schedule: {
    prevWeek: '前へ',
    thisWeek: '今週',
    nextWeek: '次へ',
    weekRange: '{start} ~ {end}',
  },

  notify: {
    timerDone: {
      title: 'タイマー完了',
      body: '"{task}" のタイマーが完了しました。',
    },
  },

  settings: {
    language: {
      title: '言語',
      desc: 'アプリの表示言語を選択してください。',
      options: {
        en: 'English',
        ko: '한국어',
        ja: '日本語',
      },
    },
    notifications: {
      timerDone: {
        title: 'タイマー完了通知',
        desc: '実行中のタイマーが自動で終了したら通知します。',
        hintDenied:
          '通知権限が拒否されました。システム設定で通知を許可してから再試行してください。',
      },
    },
  },
};
