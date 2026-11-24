import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The page header has one action at the most, top right, beside the whole title (Eduard, 24 Nov
 * 2026: Proceduri interne and Centrul de ajutor had two stacked buttons). A second action of the
 * page goes beside the search or the list it belongs to. Checked on the source, so a state the
 * browser audit does not open is covered too.
 */
const SOURCES = import.meta.glob<string>('../../src/**/*.tsx', { query: '?raw', import: 'default', eager: true });
const INTERACTIVE = /^(Button|ActionButton|Link|NavLink|a|button|MoreActions|LinkButton)$/;

/** How many actions the expression can show at once (the branches of a condition are not added up). */
function actions(n: ts.Node): number {
  if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
    const tag = ts.isJsxElement(n) ? n.openingElement.tagName.getText() : n.tagName.getText();
    if (INTERACTIVE.test(tag)) return 1;
  }
  if (ts.isConditionalExpression(n)) return Math.max(actions(n.whenTrue), actions(n.whenFalse));
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return actions(n.right);
  let total = 0;
  ts.forEachChild(n, (c) => {
    total += actions(c);
  });
  return total;
}

describe('page header actions', () => {
  it('no PageHeader shows more than one action', () => {
    const found: string[] = [];
    for (const [f, src] of Object.entries(SOURCES)) {
      const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (n: ts.Node) => {
        if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText() === 'PageHeader') {
          for (const a of n.attributes.properties) {
            if (ts.isJsxAttribute(a) && a.name.getText() === 'actions' && a.initializer && actions(a.initializer) > 1) {
              found.push(`${f}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
            }
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100);
    expect(found).toEqual([]);
  });
});
