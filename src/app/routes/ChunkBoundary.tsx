import { Component, Suspense, type ReactNode } from 'react';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { useI18n } from '../../i18n/context';
import { LoadingScreen } from '../LoadingScreen';
import styles from '../SessionErrorScreen.module.css';

function ChunkError() {
  const { t } = useI18n();
  return (
    <div className={styles.screen}>
      <div className={styles.box}>
        <Banner tone="error">{t('chunk.loadError')}</Banner>
        <Button variant="primary" block onClick={() => window.location.reload()}>
          {t('chunk.reload')}
        </Button>
      </div>
    </div>
  );
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <ChunkError /> : this.props.children;
  }
}

/** A part of the app loaded on demand: the loading screen meanwhile, a way out if it cannot load. */
export function ChunkBoundary({ children }: { children: ReactNode }) {
  return (
    <Boundary>
      <Suspense fallback={<LoadingScreen />}>{children}</Suspense>
    </Boundary>
  );
}
