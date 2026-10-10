/** What the client picked or typed on step 4; kept by the flow, so going back a step loses nothing. */
export interface CarDraft {
  carId: string | null;
  /** "Altă mașină": the typed car instead of one from the garage. */
  manual: boolean;
  make: string;
  model: string;
  year: string;
  plate: string;
  /** "Salvează mașina în garaj", ticked by default (P6). */
  save: boolean;
  note: string;
  /** "Arată service-ului ce s-a făcut la mașină la alte service-uri" (T27): off unless ticked (consent). */
}

export const EMPTY_CAR_DRAFT: CarDraft = { carId: null, manual: false, make: '', model: '', year: '', plate: '', save: true, note: '' };
