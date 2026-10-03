/** The place a map can find a shop by: its coordinates, else its address. */
export interface MapPlace {
  name?: string;
  street: string | null;
  city: string;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Directions to a shop (T28a): Google Maps' universal link, which opens the Maps app on a phone
 * (and offers Waze where it is set as the default) and the website on a computer.
 */
export function directionsUrl(place: MapPlace): string {
  const destination =
    place.latitude !== null && place.longitude !== null
      ? `${place.latitude},${place.longitude}`
      : [place.street, place.city].filter(Boolean).join(', ');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}
