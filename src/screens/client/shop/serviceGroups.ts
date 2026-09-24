import type { ShopPageService } from '../../../data/search';
import type { Lang } from '../../../i18n/translate';

export interface ServiceGroup {
  key: string;
  name: string;
  items: ShopPageService[];
}

/** A shop's services under their category names, in catalog order (shop page and booking step 1). */
export function groupServices(services: readonly ShopPageService[], lang: Lang): ServiceGroup[] {
  const groups: ServiceGroup[] = [];
  for (const s of services) {
    const last = groups.at(-1);
    if (last && last.key === s.category_key) last.items.push(s);
    else groups.push({ key: s.category_key, name: lang === 'ro' ? s.category_ro : s.category_en, items: [s] });
  }
  return groups;
}

export function serviceName(service: { name_ro: string; name_en: string }, lang: Lang): string {
  return lang === 'ro' ? service.name_ro : service.name_en;
}
