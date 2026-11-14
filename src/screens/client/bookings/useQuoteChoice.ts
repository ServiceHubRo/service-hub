import { useState } from 'react';
import type { Quote } from '../../../lib/clientBookings';
import { initialSelection } from '../../../lib/quoteLines';

/** The answer being given to a quote: which lines are ticked, and whether „Refuz” is being confirmed. */
export interface QuoteChoice {
  selected: ReadonlySet<string>;
  setSelected: (next: (prev: ReadonlySet<string>) => ReadonlySet<string>) => void;
  refusing: boolean;
  setRefusing: (on: boolean) => void;
}

/** Shared by the quote's lines (QuoteLinesChoice) and the answer (QuoteAnswer), wherever they stand. */
export function useQuoteChoice(quote: Quote): QuoteChoice {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => initialSelection(quote.items));
  const [refusing, setRefusing] = useState(false);
  return { selected, setSelected, refusing, setRefusing };
}
