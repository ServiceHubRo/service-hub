import { describe, expect, it } from 'vitest';
import { ownImageUrl } from '../../src/lib/ownImage';

const PROJECT = 'https://abc.supabase.co';

describe('ownImageUrl', () => {
  it('keeps a picture from this project\'s public Storage', () => {
    const url = `${PROJECT}/storage/v1/object/public/logos/7f0c/logo.png?v=2`;
    expect(ownImageUrl(url, PROJECT)).toBe(url);
  });

  it('drops a picture anywhere else', () => {
    expect(ownImageUrl('https://evil.example/storage/v1/object/public/logos/7f0c/logo.png', PROJECT)).toBeNull();
    expect(ownImageUrl('https://abc.supabase.co.evil.example/storage/v1/object/public/x.png', PROJECT)).toBeNull();
    expect(ownImageUrl(`${PROJECT}/rest/v1/profiles`, PROJECT)).toBeNull();
    expect(ownImageUrl('javascript:alert(1)', PROJECT)).toBeNull();
    expect(ownImageUrl('not a url', PROJECT)).toBeNull();
  });

  it('shows nothing without a picture or a project', () => {
    expect(ownImageUrl(null, PROJECT)).toBeNull();
    expect(ownImageUrl(`${PROJECT}/storage/v1/object/public/a.png`, null)).toBeNull();
  });
});
