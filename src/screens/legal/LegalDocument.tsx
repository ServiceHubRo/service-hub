import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { SkeletonList } from '../../components/Skeleton';
import { useI18n } from '../../i18n/context';
import type { MessageKey } from '../../i18n/ro';
import { isLegalField, legalFieldValues, loadLegalDoc, type LegalDocId } from '../../lib/legal';
import { parseMarkdown, type Block, type Inline, type ListItem } from '../../lib/markdown';
import styles from './LegalDocument.module.css';

const FIELD_VALUES = legalFieldValues();

/** A `{{field}}` of the document: the operator's data, or a visible "to be filled in" mark. */
function Field({ name }: { name: string }) {
  const { t } = useI18n();
  const value = isLegalField(name) ? FIELD_VALUES[name] : '';
  if (value) return <>{value}</>;
  const label = isLegalField(name) ? t(`legal.field.${name}` as MessageKey) : name;
  return <mark className={styles.missing}>{t('legal.missing', { field: label })}</mark>;
}

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
        // Long names (`sh_push_banner_hidden`) wrap only after "_" or "-", never mid-word.
        return (
          <code key={i} className={`mono ${styles.code}`}>
            {node.text.split(/(?<=[_-])/).map((part, j) => (
              <Fragment key={j}>
                {j > 0 && <wbr />}
                {part}
              </Fragment>
            ))}
          </code>
        );
      case 'field':
        return <Field key={i} name={node.key} />;
      case 'link':
        return (
          <a key={i} href={node.href} target="_blank" rel="noopener noreferrer">
            {renderInline(node.children)}
          </a>
        );
    }
  });
}

function renderList(items: ListItem[], ordered: boolean): ReactNode {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag className={styles.list}>
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
    case 'heading': {
      // The document title is shown by the screen; headings inside start one level lower.
      if (block.level === 1) return null;
      const Tag = block.level === 2 ? 'h2' : 'h3';
      return <Tag key={i}>{renderInline(block.content)}</Tag>;
    }
    case 'paragraph':
      return <p key={i}>{renderInline(block.content)}</p>;
    case 'list':
      return <Fragment key={i}>{renderList(block.items, block.ordered)}</Fragment>;
    case 'quote':
      return (
        <blockquote key={i} className={styles.quote}>
          {renderInline(block.content)}
        </blockquote>
      );
    case 'table':
      return (
        <div key={i} className={styles.tableWrap}>
          <table className={styles.table}>
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
      return <hr key={i} className={styles.rule} />;
  }
}

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; blocks: Block[] };
type Loaded = { key: string; load: Load };

/** One legal document (docs/legal, in the interface language), readable without an account. */
export function LegalDocument({ id, title }: { id: LegalDocId; title: string }) {
  const { t, lang } = useI18n();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const key = `${id}:${lang}:${attempt}`;
  // Whatever was loaded for another document, language or attempt does not count: show loading.
  const load: Load = loaded?.key === key ? loaded.load : { state: 'loading' };

  useEffect(() => {
    let cancelled = false;
    loadLegalDoc(id, lang)
      .then((text) => {
        if (!cancelled) setLoaded({ key, load: { state: 'ready', blocks: parseMarkdown(text) } });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, load: { state: 'error' } });
      });
    return () => {
      cancelled = true;
    };
  }, [id, lang, key]);

  return (
    <article className={styles.doc}>
      <h1>{title}</h1>
      {load.state === 'loading' && <SkeletonList count={3} />}
      {load.state === 'error' && (
        <Banner
          tone="error"
          action={
            <Button onClick={() => setAttempt((a) => a + 1)}>{t('action.retry')}</Button>
          }
        >
          {t('legal.loadError')}
        </Banner>
      )}
      {load.state === 'ready' && <div className={styles.body}>{load.blocks.map(renderBlock)}</div>}
    </article>
  );
}
