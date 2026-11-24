import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The page header has one action at the most, top right, beside the whole title (Eduard, 24 Nov
 * 2026: Proceduri interne and Centrul de ajutor had two stacked buttons). A second action of the
 * page goes beside the search or the list it belongs to. Checked on the source, so a state the
 * browser audit does not open is covered too.
 */
const ROOT = join(__dirname, '../../src');
const INTERACTIVE = /^(Button|ActionButton|Link|NavLink|a|button|MoreActions|LinkButton)$/;

function files(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) files(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

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
    for (const f of files(ROOT)) {
      const sf = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (n: ts.Node) => {
        if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText() === 'PageHeader') {
          for (const a of n.attributes.properties) {
            if (ts.isJsxAttribute(a) && a.name.getText() === 'actions' && a.initializer && actions(a.initializer) > 1) {
              found.push(`${relative(ROOT, f)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
            }
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(found).toEqual([]);
  });
});
