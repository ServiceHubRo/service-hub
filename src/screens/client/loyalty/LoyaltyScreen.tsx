import { Award, CircleCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { NAV } from "../../../app/roles";
import { BackLink } from "../../../components/BackLink";
import { buttonClass } from "../../../components/buttonClass";
import { Card } from "../../../components/Card";
import { LoadError } from "../../../components/LoadError";
import { SkeletonList } from "../../../components/Skeleton";
import { fetchMyLoyalty, type MyLoyalty } from "../../../data/rpc";
import { useI18n } from "../../../i18n/context";
import { plural } from "../../../i18n/translate";
import { useLoad } from "../../../lib/useLoad";
import { SEARCH_PATH } from "../paths";
import styles from "./loyalty.module.css";

/** Jobs a level starts at (the database's loyalty_level_for). */
const LEVEL_JOBS = { 1: 2, 2: 5 } as const;
const HOW = [
  "loyalty.how1",
  "loyalty.how2",
  "loyalty.how3",
  "loyalty.how4",
] as const;

/**
 * Cont → Fidelitate (T28c): the client's level, the finished jobs that make it, how many are
 * left to the next one, and how the discounts work. The level is computed in the database.
 */
export function LoyaltyScreen() {
  const { t } = useI18n();
  const { state, reload } = useLoad(fetchMyLoyalty);

  return (
    <div className={styles.page}>
      <BackLink to={NAV.client.account.path} label={t("nav.account")} />
      <div>
        <h1>{t("loyalty.screen")}</h1>
        <p className={styles.sub}>{t("loyalty.intro")}</p>
      </div>
      {state.status === "loading" && <SkeletonList count={2} />}
      {state.status === "error" && (
        <LoadError message={t("loyalty.loadError")} onRetry={reload} />
      )}
      {state.status === "ready" && <Loaded data={state.data} />}
    </div>
  );
}

function Loaded({ data }: { data: MyLoyalty }) {
  const { t, lang } = useI18n();
  const next = data.next_level;
  const goal = next ? LEVEL_JOBS[next] : null;
  return (
    <>
      <Card highlight className={styles.card}>
        <div className={styles.levelRow}>
          <Award
            size={28}
            className={data.level > 0 ? styles.iconOn : styles.iconOff}
            aria-hidden="true"
          />
          <div>
            <p className={styles.level}>
              {data.level > 0
                ? t("loyalty.level", { n: data.level })
                : t("loyalty.level0")}
            </p>
            <p className={styles.sub}>{t("loyalty.jobs", { n: data.jobs })}</p>
          </div>
        </div>
        {next && goal && data.jobs_to_next !== null ? (
          <div>
            <p className={styles.next}>
              {t("loyalty.next", {
                jobs: plural(lang, "unit.jobs", data.jobs_to_next),
                level: next,
              })}
            </p>
            <div
              className={styles.progress}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={goal}
              aria-valuenow={Math.min(data.jobs, goal)}
              aria-valuetext={t("loyalty.next", {
                jobs: plural(lang, "unit.jobs", data.jobs_to_next),
                level: next,
              })}
              aria-label={t("loyalty.progress", { level: next })}
            >
              <span
                style={{
                  width: `${(Math.min(data.jobs, goal) / goal) * 100}%`,
                }}
              />
            </div>
          </div>
        ) : (
          <p className={styles.next}>{t("loyalty.top")}</p>
        )}
      </Card>

      <section className={styles.section} aria-labelledby="loyalty-how">
        <h2 id="loyalty-how" className={styles.h2}>
          {t("loyalty.how")}
        </h2>
        <ul className={styles.how}>
          {HOW.map((key) => (
            <li key={key}>
              <CircleCheck
                size={18}
                className={styles.iconOn}
                aria-hidden="true"
              />
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className={styles.sub}>{t("loyalty.shops", { n: data.shops })}</p>
      <div>
        <Link to={SEARCH_PATH} className={buttonClass("primary")}>
          {t("loyalty.search")}
        </Link>
      </div>
    </>
  );
}
