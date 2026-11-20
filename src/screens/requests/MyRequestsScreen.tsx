import { Inbox, MessageSquare, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { buttonClass } from '../../components/buttonClass';
import { EmptyState } from '../../components/EmptyState';
import { ListDetailLayout } from '../../components/ListDetailLayout';
import { ListRow, ListRows, ListRowsSkeleton } from '../../components/ListRow';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { StatusPill } from '../../components/StatusPill';
import { fetchMyRequests, fetchSupportCategories } from '../../data/supportRequests';
import { useI18n } from '../../i18n/context';
import { toneOf } from '../../lib/statusTone';
import { useListDetail } from '../../lib/useListDetail';
import { useLoad } from '../../lib/useLoad';
import accountStyles from '../account/account.module.css';
import { helpPath, newRequestPath, REQUEST_PARAM, requestsPath } from '../account/paths';
import { categoryName, whenText } from './format';
import { MyRequestDetail } from './MyRequestDetail';
import { RequestStatusPill } from './parts';
import { useAuthorSignals } from './useAuthorSignals';

const load = () => Promise.all([fetchMyRequests(), fetchSupportCategories()]);

/**
 * Cont → Ajutor și contact → Solicitările mele (A3a; page template A since C7, Eduard, 20 Nov 2026:
 * „totul în genul carduri pe stânga cu informații pe dreapta”): one row per request — its title, the
 * category and the day it was sent, its state, a new answer marked — and the chosen one beside the
 * list (in its place on a phone) with the conversation and the answer box. Live (A3c1).
 */
export function MyRequestsScreen({ role }: { role: 'client' | 'shop' }) {
  const { t, lang } = useI18n();
  const { state, reload, setData } = useLoad(load);
  const { pathname } = useLocation();
  const refresh = () => {
    if (state.status === 'ready') load().then(setData, () => {}); // what is on screen stays on a failure
  };
  // One live subscription for the screen: the list and the open request are read again.
  const [signal, setSignal] = useState(0);
  useAuthorSignals(() => {
    refresh();
    setSignal((n) => n + 1);
  });
  const requests = state.status === 'ready' ? state.data[0] : [];
  const { wide, selectedId, open, select } = useListDetail(
    requests.map((r) => r.id),
    REQUEST_PARAM,
  );

  const header = (
    <PageHeader
      back={{ to: helpPath(role), label: t('help.title') }}
      title={t('support.my.title')}
      actions={
        <Link to={newRequestPath(role)} className={buttonClass('primary')} aria-label={t('support.my.add')}>
          <Plus size={18} aria-hidden="true" />
          {t('action.add')}
        </Link>
      }
    />
  );

  let list;
  if (state.status === 'loading') list = <ListRowsSkeleton label={t('common.loading')} />;
  else if (state.status === 'error') list = <LoadError message={t('support.my.loadError')} onRetry={reload} />;
  else if (requests.length === 0) list = <EmptyState icon={Inbox} title={t('support.my.empty')} />;
  else
    list = (
      <ListRows label={t('support.my.title')}>
        {requests.map((r) => (
          <ListRow
            key={r.id}
            icon={<MessageSquare size={20} />}
            title={r.title}
            detail={[categoryName(state.status === 'ready' ? state.data[1] : [], r.category, lang), t('support.my.sentOn', { date: whenText(lang, r.created_at) })].join(' · ')}
            status={
              <>
                <RequestStatusPill status={r.status} />
                {r.unread && <StatusPill tone={toneOf('blue')}>{t('support.my.unread')}</StatusPill>}
              </>
            }
            attention={r.unread}
            selected={wide && r.id === selectedId}
            onSelect={() => select(r.id)}
          />
        ))}
      </ListRows>
    );

  return (
    <div className={accountStyles.page}>
      <ListDetailLayout
        wide={wide}
        open={open}
        backTo={pathname}
        backLabel={t('support.my.title')}
        header={header}
        list={list}
        detail={
          selectedId &&
          state.status === 'ready' && (
            <MyRequestDetail key={selectedId} role={role} requestId={selectedId} categories={state.data[1]} signal={signal} onChanged={refresh} />
          )
        }
      />
    </div>
  );
}

/** An old address of one request (`…/solicitari/<id>`: e-mails, notifications): the list with it chosen. */
export function MyRequestRedirect({ role }: { role: 'client' | 'shop' }) {
  const { requestId = '' } = useParams();
  return <Navigate replace to={`${requestsPath(role)}?${REQUEST_PARAM}=${encodeURIComponent(requestId)}`} />;
}
