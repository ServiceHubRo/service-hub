/** Where the five page templates live (test builds only, inside the client's shell). */
export const TEMPLATES_PATH = '/dev/componente/sabloane';

export const TEMPLATE_SLUGS = ['lista', 'grila', 'formular', 'panou', 'citit'] as const;
export type TemplateSlug = (typeof TEMPLATE_SLUGS)[number];
