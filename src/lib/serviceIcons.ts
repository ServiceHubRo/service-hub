/**
 * The Lucide icons a catalog service may use (`services.icon`): the ones in
 * docs/service-catalog.json. The admin picks from these for a new service (T16b);
 * src/components/ServiceIcon.tsx maps each to its component (typed against this list).
 */
export const SERVICE_ICON_NAMES = [
  'Activity',
  'Battery',
  'BatteryCharging',
  'CircleDot',
  'ClipboardCheck',
  'Cog',
  'Compass',
  'Disc',
  'Droplet',
  'Eye',
  'Filter',
  'Flame',
  'Fuel',
  'Gauge',
  'Hammer',
  'Key',
  'Layers',
  'LifeBuoy',
  'Lightbulb',
  'MoreHorizontal',
  'Move',
  'Package',
  'Paintbrush',
  'PlugZap',
  'Radio',
  'ScanLine',
  'Settings2',
  'Shield',
  'Snowflake',
  'Sparkles',
  'Sun',
  'Thermometer',
  'Truck',
  'Volume2',
  'Waves',
  'Wind',
  'Wrench',
  'Zap',
] as const;

export type ServiceIconName = (typeof SERVICE_ICON_NAMES)[number];
