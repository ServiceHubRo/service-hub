/**
 * A picture a shop saved (its logo, its photos) is shown only when it is a file in this project's
 * public Storage (security audit, T42). The database keeps whatever address the shop's account
 * wrote, and an address elsewhere would let another server see who opens the page; the published
 * site refuses such pictures already (Content-Security-Policy), the phone app has no such header.
 */
export function ownImageUrl(url: string | null | undefined, projectUrl: string | null): string | null {
  if (!url || !projectUrl) return null;
  try {
    const image = new URL(url);
    const project = new URL(projectUrl);
    return image.origin === project.origin && image.pathname.startsWith('/storage/v1/object/public/') ? url : null;
  } catch {
    return null;
  }
}
