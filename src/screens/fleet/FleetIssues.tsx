import { AlertTriangle, Camera, ChevronLeft, ImageOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionButton } from '../../components/ActionButton';
import { Button } from '../../components/Button';
import { buttonClass } from '../../components/buttonClass';
import { Card } from '../../components/Card';
import { Field } from '../../components/Field';
import { LoadError } from '../../components/LoadError';
import { SelectField } from '../../components/SelectField';
import { SkeletonList } from '../../components/Skeleton';
import { TextArea } from '../../components/TextArea';
import { ISSUE_PHOTO_MAX, ISSUE_PHOTO_TYPES, RECEIPT_MAX_BYTES } from '../../data/fleet';
import { canRetryRpc, rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import { formatDate, formatTime, ymdInBucharest } from '../../i18n/format';
import {
  ISSUE_KINDS,
  ISSUE_STATUSES,
  type FleetIssue,
  canReportOn,
  type FleetIssueDetail,
  type FleetVehicle,
  type IssueKind,
  type IssueStatus,
  type IssueUpdate,
} from '../../lib/fleet';
import { useLoad } from '../../lib/useLoad';
import { useFleet } from './fleetContext';
import pill from '../../components/StatusBadge.module.css';
import styles from './fleet.module.css';

const STATUS_TONE: Record<IssueStatus, string> = {
  new: 'amber',
  in_review: 'amber',
  scheduled: 'blue',
  resolved: 'green',
  closed: 'muted',
};

export function IssueStatusPill({ status }: { status: IssueStatus }) {
  const { t } = useI18n();
  return <span className={`${pill.pill} ${pill[STATUS_TONE[status]]}`}>{t(`fleet.issueStatus.${status}`)}</span>;
}

/**
 * The vehicle's issues and incidents (M3): the list, „Raportează o problemă”, and one report with its
 * photos and history; a member with issues.manage changes the status, links a booking, adds a note or
 * photos.
 */
export function VehicleIssues({ vehicle, reporting, onReporting }: { vehicle: FleetVehicle; reporting: boolean; onReporting: (open: boolean) => void }) {
  const { t, lang, plural } = useI18n();
  const { data, mode, actions, allowed } = useFleet();
  const canReport = canReportOn(vehicle, allowed, data.me.member_id);
  const [open, setOpen] = useState<string | null>(null);
  const issues = useMemo(
    () => data.issues.filter((i) => i.vehicle_id === vehicle.id).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [data.issues, vehicle.id],
  );

  if (open) {
    const issue = issues.find((i) => i.id === open);
    if (issue) return <IssueDetailCard issue={issue} onBack={() => setOpen(null)} />;
  }

  return (
    <div className={styles.stack}>
      {reporting && <IssueForm vehicle={vehicle} onDone={() => onReporting(false)} />}
      <Card className={styles.card}>
        <div className={styles.cardHead}>
          <h3 className={styles.cardTitle}>{t('fleet.vtab.notes')}</h3>
          {mode === 'live' && actions && canReport && !reporting && (
            <Button onClick={() => onReporting(true)}>
              <AlertTriangle size={18} aria-hidden="true" /> {t('fleet.vehicle.report')}
            </Button>
          )}
        </div>
        {issues.length === 0 ? (
          <p className={styles.note}>{t('fleet.issues.none')}</p>
        ) : (
          <ul className={styles.plainList}>
            {issues.map((i) => (
              <li key={i.id} className={styles.lineRow}>
                <span className={styles.lineText}>
                  {mode === 'live' ? (
                    <button type="button" className={styles.linkButton} onClick={() => setOpen(i.id)}>
                      {i.title}
                    </button>
                  ) : (
                    <span>{i.title}</span>
                  )}
                  <span className={styles.muted}>
                    {t(`fleet.issue.${i.kind}`)} · {i.reported_by_name ?? t('fleet.member.someone')} · {formatDate(lang, i.happened_on)}
                    {i.photos.length > 0 ? ` · ${plural('unit.photos', i.photos.length)}` : ''}
                  </span>
                </span>
                <IssueStatusPill status={i.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------------------------ the report form

type FormField = 'title' | 'day' | 'photos';

function IssueForm({ vehicle, onDone }: { vehicle: FleetVehicle; onDone: () => void }) {
  const { t, lang } = useI18n();
  const { actions } = useFleet();
  const today = ymdInBucharest(new Date());
  // The report's id is its photo folder: fixed while the form is open, so a retry reuses the uploads.
  const issueId = useMemo(() => crypto.randomUUID(), []);
  const [kind, setKind] = useState<IssueKind>('defect');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [day, setDay] = useState(today);
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Partial<Record<FormField, string>>>({});
  const uploaded = useRef(new Map<File, string>());
  const titleRef = useRef<HTMLInputElement>(null);
  const dayRef = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | null) {
    setErrors((e) => ({ ...e, photos: undefined }));
    const picked = Array.from(list ?? []);
    if (picked.some((f) => !(ISSUE_PHOTO_TYPES as readonly string[]).includes(f.type))) {
      setErrors((e) => ({ ...e, photos: t('fleet.issues.photoType') }));
      return;
    }
    if (picked.some((f) => f.size > RECEIPT_MAX_BYTES)) {
      setErrors((e) => ({ ...e, photos: t('fleet.form.receiptTooBig') }));
      return;
    }
    const next = [...files, ...picked];
    if (next.length > ISSUE_PHOTO_MAX) {
      setErrors((e) => ({ ...e, photos: t('fleet.issues.photoMax', { n: ISSUE_PHOTO_MAX }) }));
      return;
    }
    setFiles(next);
  }

  async function send(requestId: string) {
    const next: Partial<Record<FormField, string>> = {};
    if (title.trim().length < 3) next.title = t('fleet.issues.titleShort');
    if (!day || day > today) next.day = t('fleet.form.dayFuture');
    setErrors((e) => ({ ...next, photos: e.photos }));
    if (next.title) return titleRef.current?.focus();
    if (next.day) return dayRef.current?.focus();
    if (!actions) return;
    const photos: string[] = [];
    for (const f of files) {
      let path = uploaded.current.get(f);
      if (!path) {
        path = await actions.uploadIssuePhoto(vehicle.id, issueId, f);
        uploaded.current.set(f, path);
      }
      photos.push(path);
    }
    await actions.reportIssue(issueId, {
      vehicle_id: vehicle.id,
      kind,
      title: title.trim(),
      description: description.trim() || null,
      happened_on: day,
      booking_id: null,
      photos,
    }, requestId);
    onDone();
  }

  return (
    <Card className={styles.card}>
      <h3 className={styles.cardTitle}>{t('fleet.vehicle.report')}</h3>
      <form className="form-contents" onSubmit={(e) => e.preventDefault()} noValidate>
        <div className={styles.formGrid}>
          <SelectField
            label={t('fleet.issues.kind')}
            value={kind}
            onChange={(e) => setKind(e.target.value as IssueKind)}
            options={ISSUE_KINDS.map((k) => ({ value: k, label: t(`fleet.issue.${k}`) }))}
          />
          <Field ref={dayRef} label={t('fleet.issues.day')} type="date" max={today} value={day} error={errors.day} onChange={(e) => setDay(e.target.value)} />
        </div>
        <Field ref={titleRef} label={t('fleet.issues.title')} value={title} maxLength={120} error={errors.title} onChange={(e) => setTitle(e.target.value)} />
        <TextArea label={t('fleet.issues.description')} value={description} maxLength={2000} rows={3} onChange={(e) => setDescription(e.target.value)} />
        <PhotoPicker id="issue-photos" files={files} error={errors.photos} onAdd={addFiles} onRemove={(f) => setFiles((l) => l.filter((x) => x !== f))} />
        <div className={styles.actions}>
          <ActionButton submit variant="primary" onAction={send} errorMessage={(e) => rpcErrorMessage(lang, e)} canRetry={canRetryRpc}>
            {t('fleet.issues.send')}
          </ActionButton>
          <Button onClick={onDone}>{t('fleet.form.cancel')}</Button>
        </div>
      </form>
    </Card>
  );
}

function PhotoPicker({ id, files, error, onAdd, onRemove }: { id: string; files: File[]; error?: string; onAdd: (l: FileList | null) => void; onRemove: (f: File) => void }) {
  const { t, plural } = useI18n();
  return (
    <div className={styles.receiptField}>
      <span className={styles.receiptLabel} id={`${id}-label`}>
        {t('fleet.issues.photosLabel')}
      </span>
      <div className={styles.receiptPick}>
        <input
          id={id}
          type="file"
          multiple
          accept={ISSUE_PHOTO_TYPES.join(',')}
          className={`visually-hidden ${styles.receiptInput}`}
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-hint`}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            onAdd(e.target.files);
            e.target.value = '';
          }}
        />
        <label htmlFor={id} className={buttonClass('secondary', false)}>
          <Camera size={18} aria-hidden="true" /> {t('fleet.issues.addPhotos')}
        </label>
        <span className={styles.receiptName}>{files.length > 0 ? plural('unit.photos', files.length) : t('fleet.issues.noPhotos')}</span>
      </div>
      {files.length > 0 && (
        <ul className={styles.fileList}>
          {files.map((f, n) => (
            <li key={`${f.name}-${n}`} className={styles.lineRow}>
              <span className={styles.lineText}>{f.name}</span>
              <Button variant="ghost" onClick={() => onRemove(f)} aria-label={t('fleet.issues.removePhoto', { name: f.name })}>
                {t('fleet.issues.remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p id={`${id}-hint`} className={error ? styles.fieldErrorLine : styles.hintLine}>
        {error ?? t('fleet.issues.photosHint', { n: ISSUE_PHOTO_MAX })}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------------------------ one report

function IssueDetailCard({ issue, onBack }: { issue: FleetIssue; onBack: () => void }) {
  const { t, lang } = useI18n();
  const { actions, allowed, data } = useFleet();
  const load = useCallback(() => actions!.issueDetail(issue.id), [actions, issue.id]);
  const { state, reload } = useLoad(load);
  // A change saved here or elsewhere (the list re-read) reads the detail again.
  const stamp = `${issue.status}|${issue.updated_at ?? ''}|${issue.photos.length}`;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    reload();
  }, [stamp, reload]);

  const [saved, setSaved] = useState(false);
  const jobs = data.jobs.filter((j) => j.vehicle_id === issue.vehicle_id);
  const job = issue.booking_id ? data.jobs.find((j) => j.id === issue.booking_id) : undefined;

  return (
    <div className={styles.stack}>
      <div>
        <Button variant="ghost" onClick={onBack}>
          <ChevronLeft size={18} aria-hidden="true" /> {t('fleet.vtab.notes')}
        </Button>
      </div>
      <Card className={styles.card}>
        <div className={styles.cardHead}>
          <h3 className={styles.cardTitle}>{issue.title}</h3>
          <IssueStatusPill status={issue.status} />
        </div>
        <p className={styles.muted}>
          {t(`fleet.issue.${issue.kind}`)} · {formatDate(lang, issue.happened_on)} · {issue.reported_by_name ?? t('fleet.member.someone')}
        </p>
        {issue.description && <p className={styles.timelineWork}>{issue.description}</p>}
        {job && (
          <p className={styles.muted}>
            {t('fleet.issues.linked')}: <span className="mono">{job.ref}</span> · {job.shop_name} · {formatDate(lang, job.date)}
          </p>
        )}
        <IssuePhotos paths={issue.photos} />
      </Card>
      {allowed('issues.manage') && (
        <IssueFollowUp key={`${issue.status}|${issue.booking_id ?? ''}|${issue.photos.length}`} issue={issue} jobs={jobs} onSaved={() => setSaved(true)} />
      )}
      {saved && (
        <p className={styles.hintLine} role="status">
          {t('fleet.issues.saved')}
        </p>
      )}
      <Card className={styles.card}>
        <h3 className={styles.cardTitle}>{t('fleet.issues.history')}</h3>
        {state.status === 'loading' && <SkeletonList />}
        {state.status === 'error' && <LoadError message={t('fleet.issues.historyError')} onRetry={reload} />}
        {state.status === 'ready' && <IssueHistory detail={state.data} />}
      </Card>
    </div>
  );
}

function IssueHistory({ detail }: { detail: FleetIssueDetail }) {
  const { t, lang, plural } = useI18n();
  return (
    <ol className={styles.timeline}>
      {detail.events.map((e) => (
        <li key={e.id} className={styles.timelineItem}>
          <div className={styles.timelineHead}>
            <span className={styles.timelineDate}>{formatDate(lang, new Date(e.at))} {formatTime(lang, new Date(e.at))}</span>
            <span className={styles.muted}>{e.by_name ?? t('fleet.member.someone')}</span>
          </div>
          <p className={styles.timelineTitle}>
            {e.from_status === null
              ? t('fleet.issues.evReported')
              : e.to_status
                ? t('fleet.issues.evStatus', { from: t(`fleet.issueStatus.${e.from_status}`), to: t(`fleet.issueStatus.${e.to_status}`) })
                : t('fleet.issues.evUpdated')}
          </p>
          {e.note && <p className={styles.timelineWork}>{e.note}</p>}
          {(e.photos_added > 0 || e.booking_id) && (
            <p className={styles.muted}>
              {[e.photos_added > 0 ? plural('unit.photos', e.photos_added) : null, e.booking_id ? t('fleet.issues.evLinked') : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

/** The photos, each opened through a link valid for 60 seconds, created on tap. */
function IssuePhotos({ paths }: { paths: string[] }) {
  const { t } = useI18n();
  const { actions } = useFleet();
  const [failed, setFailed] = useState(false);
  if (paths.length === 0 || !actions) return null;
  return (
    <div className={styles.actions}>
      {paths.map((p, n) => (
        <Button
          key={p}
          onClick={() => {
            setFailed(false);
            const win = window.open('', '_blank');
            void actions.fileUrl(p).then(
              (url) => {
                if (win) win.location.href = url;
              },
              () => {
                win?.close();
                setFailed(true);
              },
            );
          }}
        >
          <Camera size={18} aria-hidden="true" /> {t('fleet.issues.viewPhoto', { n: n + 1 })}
        </Button>
      ))}
      {failed && (
        <p className={styles.fieldErrorLine}>
          <ImageOff size={16} aria-hidden="true" /> {t('fleet.issues.photoError')}
        </p>
      )}
    </div>
  );
}

/** Remounted (key) when the report changes, so the fields start from what was saved. */
function IssueFollowUp({ issue, jobs, onSaved }: { issue: FleetIssue; jobs: { id: string; ref: string; shop_name: string; date: string }[]; onSaved: () => void }) {
  const { t, lang } = useI18n();
  const { actions } = useFleet();
  const [status, setStatus] = useState<IssueStatus>(issue.status);
  const [booking, setBooking] = useState(issue.booking_id ?? '');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [photoError, setPhotoError] = useState<string | undefined>();
  const uploaded = useRef(new Map<File, string>());

  function addFiles(list: FileList | null) {
    setPhotoError(undefined);
    const picked = Array.from(list ?? []);
    if (picked.some((f) => !(ISSUE_PHOTO_TYPES as readonly string[]).includes(f.type))) return setPhotoError(t('fleet.issues.photoType'));
    if (picked.some((f) => f.size > RECEIPT_MAX_BYTES)) return setPhotoError(t('fleet.form.receiptTooBig'));
    const next = [...files, ...picked];
    if (issue.photos.length + next.length > ISSUE_PHOTO_MAX) return setPhotoError(t('fleet.issues.photoMax', { n: ISSUE_PHOTO_MAX }));
    setFiles(next);
  }

  async function save(requestId: string) {
    if (!actions) return;
    const add: string[] = [];
    for (const f of files) {
      let path = uploaded.current.get(f);
      if (!path) {
        path = await actions.uploadIssuePhoto(issue.vehicle_id, issue.id, f);
        uploaded.current.set(f, path);
      }
      add.push(path);
    }
    const fields: IssueUpdate = {};
    if (status !== issue.status) fields.status = status;
    if ((booking || null) !== issue.booking_id) fields.booking_id = booking || null;
    if (note.trim()) fields.note = note.trim();
    if (add.length > 0) fields.add_photos = add;
    await actions.updateIssue(issue.id, fields, requestId);
    setNote('');
    setFiles([]);
    uploaded.current.clear();
    onSaved();
  }

  return (
    <Card className={styles.card}>
      <h3 className={styles.cardTitle}>{t('fleet.issues.followUp')}</h3>
      <form className="form-contents" onSubmit={(e) => e.preventDefault()} noValidate>
        <div className={styles.formGrid}>
          <SelectField
            label={t('fleet.issues.status')}
            value={status}
            onChange={(e) => setStatus(e.target.value as IssueStatus)}
            options={ISSUE_STATUSES.map((s) => ({ value: s, label: t(`fleet.issueStatus.${s}`) }))}
          />
          <SelectField
            label={t('fleet.issues.booking')}
            value={booking}
            onChange={(e) => setBooking(e.target.value)}
            options={[
              { value: '', label: t('fleet.issues.noBooking') },
              ...jobs.map((j) => ({ value: j.id, label: `${j.ref} · ${j.shop_name} · ${formatDate(lang, j.date)}` })),
            ]}
          />
        </div>
        <TextArea label={t('fleet.issues.note')} value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} />
        <PhotoPicker id="issue-more-photos" files={files} error={photoError} onAdd={addFiles} onRemove={(f) => setFiles((l) => l.filter((x) => x !== f))} />
        <div className={styles.actions}>
          <ActionButton submit variant="primary" onAction={save} errorMessage={(e) => rpcErrorMessage(lang, e)} canRetry={canRetryRpc}>
            {t('fleet.issues.save')}
          </ActionButton>
        </div>
      </form>
    </Card>
  );
}
