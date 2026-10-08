import { MapPin } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { ActionButton } from '../../../components/ActionButton';
import { Button } from '../../../components/Button';
import { buttonClass } from '../../../components/buttonClass';
import { Chip } from '../../../components/Chip';
import { Field } from '../../../components/Field';
import { InlinePanel } from '../../../components/InlinePanel';
import { SelectField } from '../../../components/SelectField';
import { fetchMyWaitlist, fetchServiceAreas, joinAreaWaitlist, leaveAreaWaitlist, type WaitlistEntry } from '../../../data/areas';
import { fetchCars } from '../../../data/garage';
import { canRetryRpc, rpcErrorMessage } from '../../../data/rpc';
import { fetchCategories, type SearchCategory } from '../../../data/search';
import { useI18n } from '../../../i18n/context';
import { areaForPoint, isCapital, type ServiceArea } from '../../../lib/areas';
import { useLocation } from '../../../lib/location';
import { sessionStore } from '../../../lib/storage';
import { useLoad } from '../../../lib/useLoad';
import { NEW_CAR_PATH } from '../paths';
import styles from './AreaCard.module.css';

const HIDDEN_KEY = 'sh_area_card_hidden';
const LOCALITY_MAX = 80;

interface AreaData {
  areas: ServiceArea[];
  entry: WaitlistEntry | null;
}

const loadAreaData = async (): Promise<AreaData> => {
  const [areas, entry] = await Promise.all([fetchServiceAreas(), fetchMyWaitlist()]);
  return { areas, entry };
};

/** Only for the waiting card: whether the Garage has a car, and the categories for the details. */
interface WaitingExtras {
  hasCar: boolean;
  categories: SearchCategory[];
}

const loadExtras = async (): Promise<WaitingExtras> => {
  const [cars, categories] = await Promise.all([fetchCars(), fetchCategories()]);
  return { hasCar: cars.length > 0, categories };
};

/** "județul Cluj" / "Cluj County"; Bucharest by its name. */
function useAreaName() {
  const { t, lang } = useI18n();
  return useCallback(
    (a: Pick<ServiceArea, 'code' | 'name_ro' | 'name_en'>) => {
      const name = lang === 'ro' ? a.name_ro : a.name_en;
      return isCapital(a.code) ? name : t('area.county', { name });
    },
    [t, lang],
  );
}

/**
 * Top of Caută (Eduard, 8 Oct). A client whose position falls in a zone where Service-Hub does not
 * work yet sees "În curând și în <zona ta>" and can ask to be told — the zone is found here, from
 * the towns the database lists, so the position itself never leaves the phone. While waiting, the
 * card stays: the follow-up (the car into the Garage for the document reminders), optional details
 * (the county, if we placed them wrong; the town; what they need) and "Nu mai vreau". The day the
 * zone starts they get one email and one push (area_launched), and the card is gone.
 * Nothing while it loads or when it fails: the search matters more.
 */
export function AreaCard() {
  const location = useLocation();
  const { state, setData } = useLoad(loadAreaData);
  const [hidden, setHidden] = useState(() => sessionStore.get(HIDDEN_KEY) === '1');
  if (state.status !== 'ready') return null;

  const { areas, entry } = state.data;
  const byCode = new Map(areas.map((a) => [a.code, a]));
  const setEntry = (next: WaitlistEntry | null) => setData((d) => ({ ...d, entry: next }));

  const waitingFor = entry && !entry.notified_at ? byCode.get(entry.area) : undefined;
  if (entry && waitingFor && !waitingFor.live) {
    return <Waiting data={state.data} entry={entry} area={waitingFor} onEntry={setEntry} />;
  }

  const here = location.coords ? areaForPoint(areas, location.coords) : null;
  if (!here || here.live || hidden) return null;
  return (
    <Offer
      area={here}
      onJoined={setEntry}
      onHide={() => {
        setHidden(true);
        sessionStore.set(HIDDEN_KEY, '1');
      }}
    />
  );
}

function Offer({ area, onJoined, onHide }: { area: ServiceArea; onJoined: (e: WaitlistEntry) => void; onHide: () => void }) {
  const { t, lang } = useI18n();
  const name = useAreaName()(area);
  return (
    <section className={styles.card} aria-labelledby="area-title">
      <div className={styles.head}>
        <MapPin size={18} className={styles.icon} aria-hidden="true" />
        <div className={styles.body}>
          <h2 id="area-title" className={styles.title}>
            {t('area.soon.title', { area: name })}
          </h2>
          <p className={styles.text}>{t('area.soon.text', { area: name })}</p>
        </div>
      </div>
      <div className={styles.actions}>
        <ActionButton
          block={false}
          onAction={async (requestId) => onJoined(await joinAreaWaitlist({ area: area.code, locality: null, categories: [] }, requestId))}
          errorMessage={(e) => rpcErrorMessage(lang, e)}
          canRetry={canRetryRpc}
        >
          {t('area.soon.notify')}
        </ActionButton>
        <Button variant="ghost" onClick={onHide}>
          {t('area.soon.notNow')}
        </Button>
      </div>
    </section>
  );
}

function Waiting({
  data,
  entry,
  area,
  onEntry,
}: {
  data: AreaData;
  entry: WaitlistEntry;
  area: ServiceArea;
  onEntry: (e: WaitlistEntry | null) => void;
}) {
  const { t } = useI18n();
  const areaName = useAreaName();
  const name = areaName(area);
  const [panel, setPanel] = useState<'details' | 'leave' | null>(null);
  const [saved, setSaved] = useState(false);
  const { state: extras } = useLoad(loadExtras);
  // The Garage line once we know whether there is a car (nothing extra if that read fails).
  const hasCar = extras.status === 'ready' ? extras.data.hasCar : null;
  const categories = extras.status === 'ready' ? extras.data.categories : [];

  return (
    <section className={styles.card} aria-labelledby="area-title">
      <div className={styles.head}>
        <MapPin size={18} className={styles.icon} aria-hidden="true" />
        <div className={styles.body}>
          <h2 id="area-title" className={styles.title}>
            {t('area.waiting.title', { area: name })}
          </h2>
          <p className={styles.text}>{t('area.waiting.text')}</p>
          {hasCar !== null && <p className={styles.text}>{t(hasCar ? 'area.waiting.garageHas' : 'area.waiting.garage')}</p>}
          {saved && (
            <p className={styles.saved} role="status">
              {t('area.details.saved')}
            </p>
          )}
        </div>
      </div>

      {panel === null && (
        <div className={styles.actions}>
          {hasCar === false && (
            <Link to={NEW_CAR_PATH} className={buttonClass('primary')}>
              {t('area.waiting.addCar')}
            </Link>
          )}
          <Button
            onClick={() => {
              setSaved(false);
              setPanel('details');
            }}
          >
            {t('area.details.open')}
          </Button>
          <Button variant="ghost" onClick={() => setPanel('leave')}>
            {t('area.leave')}
          </Button>
        </div>
      )}

      {panel === 'details' && (
        <Details
          areas={data.areas}
          categories={categories}
          entry={entry}
          onCancel={() => setPanel(null)}
          onSaved={(next) => {
            setPanel(null);
            setSaved(true);
            onEntry(next);
          }}
        />
      )}

      {panel === 'leave' && <Leave name={name} onCancel={() => setPanel(null)} onLeft={() => onEntry(null)} />}
    </section>
  );
}

function Details({
  areas,
  categories: allCategories,
  entry,
  onCancel,
  onSaved,
}: {
  areas: ServiceArea[];
  categories: SearchCategory[];
  entry: WaitlistEntry;
  onCancel: () => void;
  onSaved: (e: WaitlistEntry) => void;
}) {
  const { t, lang } = useI18n();
  const [area, setArea] = useState(entry.area);
  const [locality, setLocality] = useState(entry.locality ?? '');
  const [categories, setCategories] = useState<string[]>(entry.categories);
  // Only the zones still to come (and the one chosen), by name as shown.
  const options = areas
    .filter((a) => !a.live || a.code === entry.area)
    .map((a) => ({ value: a.code, label: lang === 'ro' ? a.name_ro : a.name_en }))
    .sort((x, y) => x.label.localeCompare(y.label, lang));

  return (
    <InlinePanel title={t('area.details.title')}>
      <SelectField label={t('area.details.area')} options={options} value={area} onChange={(e) => setArea(e.target.value)} />
      <Field
        label={t('area.details.locality')}
        placeholder={t('area.details.localityPlaceholder')}
        value={locality}
        maxLength={LOCALITY_MAX}
        autoComplete="address-level2"
        onChange={(e) => setLocality(e.target.value)}
      />
      <div className={styles.group} role="group" aria-labelledby="area-categories">
        <p id="area-categories" className={styles.groupTitle}>
          {t('area.details.categories')}
        </p>
        <div className={styles.chips}>
          {allCategories.map((c) => {
            const on = categories.includes(c.key);
            return (
              <Chip
                key={c.key}
                selected={on}
                onClick={() => setCategories((prev) => (on ? prev.filter((x) => x !== c.key) : [...prev, c.key]))}
              >
                {lang === 'ro' ? c.name_ro : c.name_en}
              </Chip>
            );
          })}
        </div>
      </div>
      <div className={styles.actions}>
        <ActionButton
          block={false}
          onAction={async (requestId) =>
            onSaved(await joinAreaWaitlist({ area, locality: locality.trim() || null, categories }, requestId))
          }
          errorMessage={(e) => rpcErrorMessage(lang, e)}
          canRetry={canRetryRpc}
        >
          {t('area.details.save')}
        </ActionButton>
        <Button variant="ghost" onClick={onCancel}>
          {t('area.details.cancel')}
        </Button>
      </div>
    </InlinePanel>
  );
}

function Leave({ name, onCancel, onLeft }: { name: string; onCancel: () => void; onLeft: () => void }) {
  const { t, lang } = useI18n();
  return (
    <InlinePanel title={t('area.leave.title')}>
      <p className={styles.text}>{t('area.leave.body', { area: name })}</p>
      <div className={styles.actions}>
        <ActionButton
          block={false}
          variant="danger"
          onAction={async (requestId) => {
            await leaveAreaWaitlist(requestId);
            onLeft();
          }}
          errorMessage={(e) => rpcErrorMessage(lang, e)}
          canRetry={canRetryRpc}
        >
          {t('area.leave.yes')}
        </ActionButton>
        <Button variant="ghost" onClick={onCancel}>
          {t('area.leave.no')}
        </Button>
      </div>
    </InlinePanel>
  );
}
