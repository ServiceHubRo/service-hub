import {
  Bell,
  BookOpen,
  CalendarDays,
  Car,
  ChevronRight,
  CreditCard,
  FileText,
  ShieldCheck,
  Truck,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ActionButton } from '../../components/ActionButton';
import { Button } from '../../components/Button';
import { sendHelpFeedback, type HelpArticle, type HelpIcon } from '../../data/help';
import { canRetryRpc, rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import { parseMarkdown, type Block, type Inline, type ListItem } from '../../lib/markdown';
import styles from './help.module.css';

export const HELP_ICON: Record<HelpIcon, LucideIcon> = {
  book: BookOpen,
  car: Car,
  wrench: Wrench,
  truck: Truck,
  shield: ShieldCheck,
  card: CreditCard,
  calendar: CalendarDays,
  bell: Bell,
  users: Users,
  file: FileText,
};

// ------------------------------------------------------------------------------------ article text

function renderInline(nodes: Inline[]): ReactNode {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={i}>{node.text}</Fragment>;
      case 'strong':
        return <strong key={i}>{renderInline(node.children)}</strong>;
      case 'em':
        return <em key={i}>{renderInline(node.children)}</em>;
      case 'code':
        return (
          <code key={i} className="mono">
            {node.text}
          </code>
        );
      case 'field':
        // `{{…}}` is refused by the database; shown as written if it ever arrives.
        return <Fragment key={i}>{`{{${node.key}}}`}</Fragment>;
      case 'link':
        return (
          <a key={i} href={node.href} target={node.href.startsWith('mailto:') ? undefined : '_blank'} rel="noopener noreferrer">
            {renderInline(node.children)}
          </a>
        );
    }
  });
}

function renderList(items: ListItem[], ordered: boolean): ReactNode {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag>
      {items.map((item, i) => (
        <li key={i}>
          {renderInline(item.content)}
          {item.children.length > 0 && renderList(item.children, false)}
        </li>
      ))}
    </Tag>
  );
}

function renderBlock(block: Block, i: number): ReactNode {
  switch (block.type) {
    case 'heading':
      // The article title is the page's h1; headings inside are h2 and below.
      return block.level <= 2 ? <h2 key={i}>{renderInline(block.content)}</h2> : <h3 key={i}>{renderInline(block.content)}</h3>;
    case 'paragraph':
      return <p key={i}>{renderInline(block.content)}</p>;
    case 'list':
      return <Fragment key={i}>{renderList(block.items, block.ordered)}</Fragment>;
    case 'quote':
      return <blockquote key={i}>{renderInline(block.content)}</blockquote>;
    case 'table':
      return (
        <div key={i} className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                {block.header.map((cell, c) => (
                  <th key={c} scope="col">
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>{renderInline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'rule':
      return <hr key={i} />;
  }
}

/**
 * An article's text: Markdown read by the app's own reader (src/lib/markdown.ts) into React elements,
 * never HTML, so no stored text can become markup or a script.
 */
export function ArticleBody({ body }: { body: string }) {
  const blocks = useMemo(() => parseMarkdown(body), [body]);
  return <div className={styles.body}>{blocks.map(renderBlock)}</div>;
}

// ------------------------------------------------------------------------------------ lists

/** A list of articles as rows: title, an optional line under it, a chevron. */
export function ArticleLinks({ items }: { items: { article: HelpArticle; to: string; meta?: ReactNode; snippet?: string | null }[] }) {
  return (
    <ul className={styles.links}>
      {items.map(({ article, to, meta, snippet }) => (
        <li key={article.id}>
          <Link to={to} className={styles.link}>
            <span className={styles.linkText}>
              <span className={styles.linkTitle}>{article.title}</span>
              {meta && <span className={styles.linkMeta}>{meta}</span>}
              {(snippet ?? article.summary) && <span className={styles.linkSummary}>{snippet ?? article.summary}</span>}
            </span>
            <ChevronRight size={18} className={styles.chevron} aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------------------------ feedback

/**
 * „Ți-a fost util acest articol?” — Da / Nu, saved at once (one vote per account; voting again
 * changes it). The way to the team is under the article.
 */
export function ArticleFeedback({ article, vote }: { article: HelpArticle; vote: boolean | undefined }) {
  const { t, lang } = useI18n();
  const [answer, setAnswer] = useState<boolean | undefined>(vote);
  const [asking, setAsking] = useState(vote === undefined);

  if (!asking && answer !== undefined) {
    return (
      <section className={styles.feedback} aria-labelledby="help-feedback-q">
        <h2 id="help-feedback-q" className={styles.feedbackQuestion}>
          {t('help.feedback.question')}
        </h2>
        <p role="status" className={styles.feedbackDone}>
          {t(answer ? 'help.feedback.recorded' : 'help.feedback.recordedNo')}
        </p>
        <p className={styles.feedbackMine}>
          {t('help.feedback.yourAnswer', { answer: t(answer ? 'help.feedback.yes' : 'help.feedback.no') })}
          <Button variant="ghost" onClick={() => setAsking(true)}>
            {t('help.feedback.change')}
          </Button>
        </p>
      </section>
    );
  }

  return (
    <section className={styles.feedback} aria-labelledby="help-feedback-q">
      <h2 id="help-feedback-q" className={styles.feedbackQuestion}>
        {t('help.feedback.question')}
      </h2>
      <div className={styles.feedbackButtons}>
        {([true, false] as const).map((helpful) => (
          <ActionButton
            key={String(helpful)}
            variant="secondary"
            block={false}
            onAction={async (requestId) => {
              await sendHelpFeedback(article.id, helpful, requestId);
              setAnswer(helpful);
              setAsking(false);
            }}
            errorMessage={(e) => rpcErrorMessage(lang, e)}
            canRetry={canRetryRpc}
          >
            {t(helpful ? 'help.feedback.yes' : 'help.feedback.no')}
          </ActionButton>
        ))}
      </div>
    </section>
  );
}
