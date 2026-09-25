import { Component, type ReactNode } from 'react';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { useI18n } from '../i18n/context';
import styles from './SessionErrorScreen.module.css';

/** What a broken screen shows instead of going blank: what happened and a way out. */
export function CrashNotice({ kind, fullScreen = false }: { kind: 'chunk' | 'crash'; fullScreen?: boolean }) {
  const { t } = useI18n();
  return (
    <div className={fullScreen ? styles.screen : styles.inline}>
      <div className={styles.box}>
        <Banner tone="error">{t(kind === 'chunk' ? 'chunk.loadError' : fullScreen ? 'crash.textPage' : 'crash.text')}</Banner>
        <Button variant="primary" block onClick={() => window.location.reload()}>
          {t('chunk.reload')}
        </Button>
      </div>
    </div>
  );
}

interface Props {
  /** The screen's address: going to another screen tries again. */
  resetKey: string;
  fullScreen?: boolean;
  children: ReactNode;
}

/**
 * Catches an error while a screen draws, so the rest of the app (the menu) keeps working and the
 * person sees a message instead of an empty page. The error itself reaches Sentry through the
 * React root's onCaughtError (src/main.tsx).
 */
export class ScreenErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(prev: Props) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    return this.state.failed ? <CrashNotice kind="crash" fullScreen={this.props.fullScreen} /> : this.props.children;
  }
}
