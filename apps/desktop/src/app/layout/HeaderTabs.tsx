import { useContext } from 'react';
import { LocaleContext } from '../../i18n/context';
import {
  CalendarCheck,
  CalendarCog,
  CalendarDays,
  Settings,
} from 'lucide-react';
import clsx from 'clsx';

export type Tab = 'today' | 'manage' | 'schedule' | 'settings';

export function HeaderTabs({
  tab,
  onChange,
}: {
  tab: Tab; // (role: selected tab, type: Tab)
  onChange: (tab: Tab) => void; // (role: tab change handler, type: (Tab)=>void)
}) {
  const { t } = useContext(LocaleContext);
  const baseBtn =
    'rounded-full px-4 py-1.5 text-sm transition whitespace-nowrap';

  return (
    <div className="flex w-full justify-start md:w-auto md:justify-end">
      <div className="flex w-full items-center justify-between gap-1 rounded-full border border-zinc-800 bg-zinc-900/40 p-1 md:w-auto">
        <button
          type="button"
          onClick={() => onChange('today')}
          aria-current={tab === 'today' ? 'page' : undefined}
          className={clsx(
            baseBtn,
            'flex items-center justify-center gap-2',
            'flex-1 md:flex-none',
            tab === 'today'
              ? 'bg-zinc-100 text-zinc-900'
              : 'text-zinc-200 hover:bg-zinc-900/70',
          )}>
          <CalendarCheck size={16} />
          <span className="[@media(max-width:480px)]:hidden">
            {t('common.today')}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onChange('manage')}
          aria-current={tab === 'manage' ? 'page' : undefined}
          className={clsx(
            baseBtn,
            'flex items-center justify-center gap-2',
            'flex-1 md:flex-none',
            tab === 'manage'
              ? 'bg-zinc-100 text-zinc-900'
              : 'text-zinc-200 hover:bg-zinc-900/70',
          )}>
          <CalendarCog size={16} />
          <span className="[@media(max-width:480px)]:hidden">
            {t('common.manage')}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onChange('schedule')}
          aria-current={tab === 'schedule' ? 'page' : undefined}
          className={clsx(
            baseBtn,
            'flex items-center justify-center gap-2',
            'flex-1 md:flex-none',
            tab === 'schedule'
              ? 'bg-zinc-100 text-zinc-900'
              : 'text-zinc-200 hover:bg-zinc-900/70',
          )}>
          <CalendarDays className="shrink-0" size={16} />
          <span className="[@media(max-width:480px)]:hidden">
            {t('common.schedule')}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onChange('settings')}
          aria-current={tab === 'settings' ? 'page' : undefined}
          className={clsx(
            baseBtn,
            'flex items-center justify-center gap-2',
            'flex-1 md:flex-none',
            tab === 'settings'
              ? 'bg-zinc-100 text-zinc-900'
              : 'text-zinc-200 hover:bg-zinc-900/70',
          )}>
          <Settings size={16} />
          <span className="[@media(max-width:480px)]:hidden">
            {t('common.settings')}
          </span>
        </button>
      </div>
    </div>
  );
}
