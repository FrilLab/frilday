import { useContext } from 'react';
import { LocaleContext } from '../../i18n/context';

export function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string; // (role: error message, type: string)
  onDismiss: () => void; // (role: dismiss handler, type: ()=>void)
}) {
  const { t } = useContext(LocaleContext);

  return (
    <button
      type="button"
      onClick={onDismiss}
      className="mt-4 w-full rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left text-sm text-amber-200 hover:bg-amber-500/15"
      title={t('note.clickToDismiss')}>
      {message}
    </button>
  );
}
