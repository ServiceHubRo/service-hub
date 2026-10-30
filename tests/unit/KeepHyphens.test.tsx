import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from '../../src/components/Button';
import { KeepHyphens } from '../../src/components/KeepHyphens';

afterEach(cleanup);

describe('KeepHyphens', () => {
  it('keeps each hyphenated word whole and the text unchanged', () => {
    const text = 'Locuri pentru primele service-uri partenere. Service-Hub s-a lansat.';
    const { container } = render(
      <p>
        <KeepHyphens>{text}</KeepHyphens>
      </p>,
    );
    expect(container.textContent).toBe(text);
    expect([...container.querySelectorAll('p > span > span')].map((s) => s.textContent)).toEqual(['service-uri', 'Service-Hub', 's-a']);
    expect(container.querySelectorAll('p > span')).toHaveLength(1);
  });

  it('leaves text without hyphenated words as it is', () => {
    const { container } = render(
      <p>
        <KeepHyphens>{'Preț – 80 lei, 9-18'}</KeepHyphens>
      </p>,
    );
    expect(container.querySelector('span')).toBeNull();
  });

  it('applies to a button label as one piece, with the same accessible name', () => {
    render(<Button>Marchează că s-a terminat</Button>);
    const button = screen.getByRole('button', { name: 'Marchează că s-a terminat' });
    expect(button.children).toHaveLength(1);
    expect(button.querySelector('span span')?.textContent).toBe('s-a');
  });
});
