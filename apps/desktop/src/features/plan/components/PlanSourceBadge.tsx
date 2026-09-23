import { CalendarDays } from 'lucide-react';
import { useContext } from 'react';
import type { PlanSource } from '../../../shared/types';
import { LocaleContext } from '../../../i18n/context';

export function PlanSourceBadge(props: {
  source?: PlanSource;
  unavailable?: boolean;
}) {
  const { t } = useContext(LocaleContext);
  if (props.source?.kind !== 'externalCalendar') return null;

  const label = props.unavailable
    ? t('plan.source.googleCalendarUnavailable')
    : t('plan.source.googleCalendar');

  return (
    <span
      title={label}
      aria-label={label}
      className={[
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        props.unavailable
          ? 'border-amber-300/20 bg-amber-300/5 text-amber-200/80'
          : 'border-sky-300/20 bg-sky-300/5 text-sky-200/80',
      ].join(' ')}>
      <CalendarDays size={12} aria-hidden="true" />
      {label}
    </span>
  );
}
