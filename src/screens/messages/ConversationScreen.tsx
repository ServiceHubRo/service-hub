import { MessageSquare, SendHorizontal } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { Spinner } from '../../components/Spinner';
import { useAction } from '../../components/useAction';
import { fetchMessages, MESSAGE_PAGE, type ChatMessage } from '../../data/messages';
import { subscribeRows } from '../../data/realtime';
import { canRetryRpc, markThreadRead, rpcErrorMessage, sendMessage, toRpcError } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import { formatTime, ymdInBucharest } from '../../i18n/format';
import { counterpartName, formatDayHeading, isOwnSide, mergeMessages, systemMessageText } from '../../lib/messages';
import { useLoad } from '../../lib/useLoad';
import { useNow } from '../../lib/useNow';
import { shopPath } from '../client/paths';
import { messagesPath } from './paths';
import { ThreadAvatar } from './ThreadAvatar';
import { useThreads } from './threadsContext';
import styles from './messages.module.css';

const MAX_LENGTH = 4000;

interface Page {
  messages: ChatMessage[];
  /** The first read was a full page: there may be older messages. */
  hasOlder: boolean;
}

/** The element that scrolls the screen (the shell's content area, or the page). */
function scrollerOf(el: HTMLElement | null): HTMLElement {
  for (let node = el?.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

function nearBottom(scroller: HTMLElement): boolean {
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 160;
}

/** Enter sends with a keyboard and mouse; on a phone Enter makes a new line and the button sends. */
function enterSends(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
}

/**
 * One conversation (FR §3.7, §4.4, P9, P9b): bubbles with times (mine on the right in amber, the
 * other side's on the left), automatic messages centered with "mesaj automat" in the reader's
 * language, and the box to write in. New messages arrive live (Realtime on this thread's
 * messages); after a dropped connection the newest page is read again, so nothing is missed.
 * Opening the conversation, and every message that arrives while it is on screen, marks it read.
 */
export function ConversationScreen() {
  const { t, lang } = useI18n();
  const { threadId = '' } = useParams();
  const threads = useThreads();
  const { side, patch, refresh: refreshThreads } = threads;
  const thread = threads.state.status === 'ready' ? threads.state.data.threads.find((x) => x.thread_id === threadId) : undefined;
  const now = useNow();

  const load = useCallback(async (): Promise<Page> => {
    const messages = await fetchMessages(threadId);
    return { messages, hasOlder: messages.length === MESSAGE_PAGE };
  }, [threadId]);
  const { state, reload, setData } = useLoad(load);
  const ready = state.status === 'ready';

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const inputId = useId();
  const errorId = useId();

  // ------------------------------------------------------------------ read marker
  const markRead = useCallback(() => {
    if (document.visibilityState !== 'visible') return;
    markThreadRead(threadId).then(
      () => {},
      () => {}, // the badge stays until the next time; nothing to tell the user
    );
    patch(threadId, { unread: 0 });
  }, [threadId, patch]);

  useEffect(() => {
    if (!ready) return;
    markRead();
    const onVisible = () => {
      if (document.visibilityState === 'visible') markRead();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [ready, markRead]);

  // A thread that is not in the list yet (just created) makes the list read again once.
  const listReady = threads.state.status === 'ready';
  const missing = listReady && !thread;
  useEffect(() => {
    if (missing) refreshThreads();
  }, [missing, refreshThreads]);

  // ------------------------------------------------------------------ scrolling
  // 'bottom' after the first read and after a message arrives near the bottom; 'keep' after older
  // messages were put above, so what the reader was looking at stays in place.
  const scrollIntent = useRef<{ kind: 'bottom'; smooth: boolean } | { kind: 'keep'; height: number } | null>({
    kind: 'bottom',
    smooth: false,
  });
  const messages = ready ? state.data.messages : null;
  useLayoutEffect(() => {
    const intent = scrollIntent.current;
    if (!messages || !intent) return;
    scrollIntent.current = null;
    const scroller = scrollerOf(endRef.current);
    if (intent.kind === 'keep') {
      scroller.scrollTop += scroller.scrollHeight - intent.height;
      return;
    }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    endRef.current?.scrollIntoView({ block: 'end', behavior: intent.smooth && !reduce ? 'smooth' : 'auto' });
  }, [messages]);

  const addMessages = useCallback(
    (incoming: ChatMessage[], forceBottom = false) => {
      const scroller = scrollerOf(endRef.current);
      if (forceBottom || nearBottom(scroller)) scrollIntent.current = { kind: 'bottom', smooth: true };
      setData((prev) => ({ ...prev, messages: mergeMessages(prev.messages, incoming) }));
    },
    [setData],
  );

  // ------------------------------------------------------------------ live
  useEffect(() => {
    if (!ready || !threadId) return;
    return subscribeRows<Record<string, unknown>>({
      channel: `messages:${threadId}`,
      table: 'messages',
      filter: `thread_id=eq.${threadId}`,
      onChange: (payload) => {
        if (payload.eventType !== 'INSERT') return;
        const row = payload.new as unknown as ChatMessage;
        if (!row.id || row.thread_id !== threadId) return;
        addMessages([row]);
        markRead();
      },
      // Connected again after a drop: whatever came meanwhile is in the newest page.
      onResync: () => {
        fetchMessages(threadId).then(
          (page) => {
            if (page.length > 0) addMessages(page);
            markRead();
          },
          () => {},
        );
      },
    });
  }, [ready, threadId, addMessages, markRead]);

  // ------------------------------------------------------------------ older messages
  const [olderBusy, setOlderBusy] = useState(false);
  const [olderFailed, setOlderFailed] = useState(false);
  async function loadOlder() {
    if (!messages || messages.length === 0 || olderBusy) return;
    setOlderBusy(true);
    setOlderFailed(false);
    try {
      const older = await fetchMessages(threadId, messages[0]!.created_at);
      scrollIntent.current = { kind: 'keep', height: scrollerOf(endRef.current).scrollHeight };
      setData((prev) => ({ messages: mergeMessages(older, prev.messages), hasOlder: older.length === MESSAGE_PAGE }));
    } catch {
      setOlderFailed(true);
    } finally {
      setOlderBusy(false);
    }
  }

  // ------------------------------------------------------------------ sending
  const clientId = thread?.client_id ?? null;
  const canWrite = !thread || side === 'client' || clientId !== null;
  const { run, busy, error } = useAction(
    async (requestId) => {
      const body = text.trim();
      if (!body) return;
      const message = (await sendMessage(threadId, body, requestId)) as unknown as ChatMessage;
      setText('');
      addMessages([message], true);
      patch(threadId, {
        last_message_at: message.created_at,
        last_kind: 'user',
        last_body: message.body,
        last_event: null,
        last_params: null,
        last_own: true,
        unread: 0,
      });
      inputRef.current?.focus();
    },
    { errorMessage: (e) => rpcErrorMessage(lang, e), canRetry: canRetryRpc },
  );

  // The box grows with the text, up to about six lines.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && enterSends()) {
      e.preventDefault();
      if (text.trim()) void run();
    }
  }

  // ------------------------------------------------------------------ view
  const name = thread ? counterpartName(side, thread, t('msg.deletedAccount')) : '';
  const notFound =
    (state.status === 'error' && ['thread_not_found', 'not_allowed'].includes(toRpcError(state.error).code)) ||
    (ready && listReady && !thread && state.data.messages.length === 0);

  if (notFound) {
    return (
      <div className={styles.page}>
        <BackLink to={messagesPath(side)} label={t('nav.messages')} />
        <EmptyState icon={MessageSquare} title={t('msg.notFound')} />
      </div>
    );
  }

  return (
    <div className={styles.conversation} data-fill-screen>
      <BackLink to={messagesPath(side)} label={t('nav.messages')} />
      <div className={styles.header}>
        {thread && <ThreadAvatar side={side} thread={thread} size={40} />}
        <h1 className={styles.headerName}>
          {thread && side === 'client' ? <Link to={shopPath(thread.shop_id)}>{name}</Link> : name}
        </h1>
      </div>

      {state.status === 'loading' && (
        <div className={styles.center}>
          <Spinner size={24} label={t('common.loading')} />
        </div>
      )}
      {state.status === 'error' && <LoadError message={t('msg.loadConversationError')} onRetry={reload} />}

      {messages && (
        <div role="log" aria-label={t('msg.conversationWith', { name })} className={styles.log}>
          {state.status === 'ready' && state.data.hasOlder && (
            <div className={styles.older}>
              <Button onClick={() => void loadOlder()} disabled={olderBusy} aria-busy={olderBusy}>
                {olderBusy ? t('common.loading') : t('msg.older')}
              </Button>
              {olderFailed && (
                <p className={styles.error} role="alert">
                  {t('msg.olderError')}
                </p>
              )}
            </div>
          )}
          {messages.length === 0 && <p className={styles.noMessages}>{t('msg.noMessages')}</p>}
          <ol className={styles.messages}>
            {messages.map((m, i) => {
              const date = new Date(m.created_at);
              const day = ymdInBucharest(date);
              const prev = messages[i - 1];
              const newDay = !prev || ymdInBucharest(new Date(prev.created_at)) !== day;
              const time = formatTime(lang, date);
              const own = isOwnSide(m, side, clientId);
              return (
                <li key={m.id} className={styles.item}>
                  {newDay && <p className={styles.day}>{formatDayHeading(lang, day, now)}</p>}
                  {m.kind === 'system' ? (
                    <div className={styles.system}>
                      <p>{systemMessageText(lang, side, m.event, m.params)}</p>
                      <span className={styles.systemLabel}>
                        {t('msg.automatic')} · <span className="mono">{time}</span>
                      </span>
                    </div>
                  ) : (
                    <div className={own ? styles.mineWrap : styles.theirsWrap}>
                      <p className={own ? styles.mine : styles.theirs}>
                        <span className="visually-hidden">{own ? t('msg.you') : name}: </span>
                        {m.body}
                      </p>
                      <span className={`mono ${styles.time}`}>{time}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          <div ref={endRef} />
        </div>
      )}

      {messages &&
        (canWrite ? (
          <div className={styles.composerWrap}>
            <form
              className={styles.composer}
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) void run();
              }}
            >
              <label htmlFor={inputId} className="visually-hidden">
                {t('msg.input')}
              </label>
              <textarea
                id={inputId}
                ref={inputRef}
                className={styles.input}
                rows={1}
                value={text}
                maxLength={MAX_LENGTH}
                placeholder={t('msg.placeholder')}
                enterKeyHint="send"
                readOnly={busy}
                aria-describedby={error ? errorId : undefined}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKeyDown}
              />
              <button
                type="submit"
                className={styles.send}
                disabled={busy || !text.trim()}
                aria-busy={busy}
                aria-label={busy ? t('action.sending') : t('msg.send')}
                // Keeps the keyboard open and the cursor in the box.
                onMouseDown={(e) => e.preventDefault()}
              >
                {busy ? <Spinner /> : <SendHorizontal size={20} aria-hidden="true" />}
              </button>
            </form>
            {error && (
              <div id={errorId} className={styles.error} role="alert">
                <span>{error.text}</span>
                {error.retry && (
                  <button type="button" className={styles.retry} onClick={() => void run()}>
                    {t('action.retry')}
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className={styles.closed}>{t('msg.clientDeleted')}</p>
        ))}
    </div>
  );
}
