import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelectField } from '../../src/components/SelectField';

afterEach(cleanup);

const OPTIONS = [
  { value: '2', label: '2 ore' },
  { value: '4', label: '4 ore' },
];

function setup() {
  const onChange = vi.fn();
  render(<SelectField label="Preaviz minim" value="2" onChange={onChange} options={OPTIONS} />);
  const select = screen.getByLabelText('Preaviz minim') as HTMLSelectElement;
  select.focus();
  return { select, onChange };
}

describe('SelectField', () => {
  it('lets go of the focus after a choice made with a finger, so the next tap opens it at once', () => {
    const { select, onChange } = setup();
    fireEvent.pointerDown(select, { pointerType: 'touch' });
    fireEvent.change(select, { target: { value: '4' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(select);
  });

  it('keeps the focus with a mouse or the keyboard', () => {
    const { select, onChange } = setup();
    fireEvent.pointerDown(select, { pointerType: 'mouse' });
    fireEvent.change(select, { target: { value: '4' } });
    expect(document.activeElement).toBe(select);
    // Arrow keys: no pointer at all.
    fireEvent.change(select, { target: { value: '2' } });
    expect(document.activeElement).toBe(select);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
