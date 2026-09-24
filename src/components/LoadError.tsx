import { CloudOff } from 'lucide-react';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { useI18n } from '../i18n/context';

/** A load that failed: says so and offers "Încearcă din nou" (never looks like an empty list). */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div role="alert">
      <EmptyState
        icon={CloudOff}
        title={message}
        action={
          <Button variant="primary" onClick={onRetry}>
            {t('action.retry')}
          </Button>
        }
      />
    </div>
  );
}
