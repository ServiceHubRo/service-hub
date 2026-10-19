/**
 * Kinds of workshop (Eduard, 19 Oct): "Servicii oferite" starts from one or more of them, each
 * ticking the services such a workshop usually does; the shop then adjusts the list. Ids of the
 * service catalog (docs/service-catalog.json); one the admin turned off is simply not ticked.
 */
export const SERVICE_PRESETS = [
  {
    key: 'general',
    services: [
      'ulei', 'revizie', 'filtru_aer', 'filtru_polen', 'filtru_comb', 'bujii', 'bujii_incand', 'stergatoare',
      'lichid_frana', 'antigel', 'pregatire_iarna',
      'distributie', 'distributie_lant', 'curea_accesorii', 'garnitura_chiuloasa', 'turbina', 'injectoare',
      'pompa_ulei', 'decarbonizare', 'egr', 'dpf', 'simeringuri',
      'ambreiaj', 'volanta', 'ulei_cutie', 'planetare',
      'frane', 'discuri', 'etriere', 'tamburi', 'frana_mana', 'conducte_frana', 'aerisire_frane',
      'suspensie', 'arcuri', 'bascule', 'bieletele', 'rulmenti', 'servodirectie', 'capete_bara', 'flanse',
      'esapament', 'sonda_lambda',
      'radiator', 'pompa_apa', 'termostat', 'ventilator', 'furtunuri',
      'diag', 'stergere_erori', 'baterie',
      'constatare', 'itp', 'verificare_cumparare', 'verificare_drum_lung',
      'becuri',
    ],
  },
  {
    key: 'tires',
    services: ['anvelope', 'vulcanizare', 'hotel', 'jante', 'senzori_tpms', 'roata_rezerva', 'geometrie'],
  },
  {
    key: 'electrical',
    services: [
      'diag', 'stergere_erori', 'electrica', 'baterie', 'alternator', 'electromotor', 'instalatie', 'senzori',
      'calculator', 'imobilizator', 'alarma', 'audio', 'camera_mers', 'incarcare_soft', 'becuri',
    ],
  },
  {
    key: 'ac',
    services: ['clima', 'clima_ig', 'clima_diag', 'compresor_clima', 'radiator_clima', 'incalzire', 'webasto'],
  },
  {
    key: 'body',
    services: ['tinichigerie', 'vopsitorie', 'pdr', 'bara', 'rugina', 'sudura', 'dauna_totala', 'banc_indreptat', 'polish', 'faruri_polish'],
  },
  {
    key: 'detailing',
    services: [
      'spalatorie', 'polish', 'ceramica', 'ppf', 'colantare', 'colantare_part', 'interior', 'ozon', 'motor_spalare',
      'faruri_polish', 'folie_geam',
    ],
  },
  {
    key: 'glass',
    services: ['parbriz', 'reparatie_parbriz', 'geamuri_laterale', 'folie_geam', 'oglinzi', 'faruri_schimb'],
  },
  {
    key: 'itp',
    services: ['itp_efectiv', 'itp', 'reglaj_far', 'test_emisii', 'test_suspensie', 'verificare_cumparare'],
  },
  {
    key: 'lpg',
    services: ['montaj_gpl', 'revizie_gpl', 'verificare_butelie', 'omologare_gpl'],
  },
] as const satisfies readonly { key: string; services: readonly string[] }[];

export type ServicePresetKey = (typeof SERVICE_PRESETS)[number]['key'];
