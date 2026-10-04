import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import styles from './ShopsMap.module.css';

/** One pin: a shop with coordinates. */
export interface MapShop {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** A second line in the pin's bubble (rating, first free place). */
  detail?: string;
}

export interface ShopsMapProps {
  shops: MapShop[];
  /** The bubble's button ("Vezi service-ul"); without it the pins have no bubble. */
  openLabel?: string;
  onOpen?: (id: string) => void;
  /** The map's accessible name. */
  label: string;
  /** A small map that only shows (the shop page): no scroll-zoom, no bubble. */
  compact?: boolean;
}

/** The whole of Romania: the view when no shop has coordinates. */
const FALLBACK: L.LatLngTuple = [45.94, 24.97];
const FALLBACK_ZOOM = 6;
const TILE_URL = import.meta.env.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  import.meta.env.VITE_MAP_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/**
 * The map of shops (T28b), loaded only when shown (Leaflet + the tile server in VITE_MAP_TILE_URL,
 * OpenStreetMap by default). Pins are drawn in the app's colors without image files; their bubble
 * is built from text nodes, never from HTML, so a shop's name cannot inject anything.
 */
export default function ShopsMap({ shops, openLabel, onOpen, label, compact }: ShopsMapProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const openRef = useRef(onOpen);
  useEffect(() => {
    openRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    if (!boxRef.current) return;
    const map = L.map(boxRef.current, {
      center: FALLBACK,
      zoom: FALLBACK_ZOOM,
      scrollWheelZoom: !compact,
      // The small map only shows where the shop is: no zoom buttons, no pins to press.
      zoomControl: !compact,
      attributionControl: true,
    });
    // Leaflet focuses the map on a press (for its arrow keys); a plain focus() would scroll the page
    // under the pointer and lose the tap on a pin, so the focus never scrolls.
    const box = map.getContainer();
    const focus = box.focus.bind(box);
    box.focus = (options?: FocusOptions) => focus({ ...options, preventScroll: true });
    L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [compact]);

  // The pins are drawn again only when they really change (a new array on every render of the
  // parent would close an open bubble).
  const pinsKey = JSON.stringify(shops.map((s) => [s.id, s.name, s.latitude, s.longitude, s.detail ?? '']));
  const shopsRef = useRef(shops);
  useEffect(() => {
    shopsRef.current = shops;
  }, [shops]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    const shops = shopsRef.current;
    layer.clearLayers();
    // A 44 px target around a smaller drawn pin (tap targets ≥ 44 px).
    const icon = L.divIcon({ className: styles.pin, iconSize: [44, 44], iconAnchor: [22, 44], popupAnchor: [0, -40], html: '' });
    const points: L.LatLngTuple[] = [];
    for (const s of shops) {
      const at: L.LatLngTuple = [s.latitude, s.longitude];
      points.push(at);
      const marker = L.marker(at, { icon, title: s.name, alt: s.name, keyboard: !compact, interactive: !compact });
      if (!compact && openLabel) {
        const box = document.createElement('div');
        box.className = styles.bubble ?? '';
        const name = document.createElement('strong');
        name.textContent = s.name;
        box.appendChild(name);
        if (s.detail) {
          const detail = document.createElement('span');
          detail.textContent = s.detail;
          box.appendChild(detail);
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = styles.open ?? '';
        button.textContent = openLabel;
        button.addEventListener('click', () => openRef.current?.(s.id));
        box.appendChild(button);
        marker.bindPopup(box);
      }
      marker.addTo(layer);
    }
    if (points.length === 1) map.setView(points[0]!, 15);
    else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 15 });
  }, [pinsKey, openLabel, compact]);

  return <div ref={boxRef} className={compact ? `${styles.map} ${styles.compact}` : styles.map} role="region" aria-label={label} />;
}
