import { describe, expect, it } from 'vitest';
import { allowedOrigin, corsHeaders, withCors } from '../../supabase/functions/_shared/cors';

// SEC-04 (audit 13 Nov 2026): the Edge Functions answer the browser only for the app's own addresses.
describe('CORS of the Edge Functions', () => {
  it('allows the published site, the Netlify site and its previews, local development and the Android app', () => {
    for (const o of [
      'https://service-hub.ro',
      'https://www.service-hub.ro',
      'https://service-hubapp.netlify.app',
      'https://deploy-preview-136--service-hubapp.netlify.app',
      'https://main--service-hubapp.netlify.app',
      'http://localhost:4173',
      'http://127.0.0.1:5173',
      'https://localhost',
    ]) {
      expect(allowedOrigin(o), o).toBe(o);
    }
  });

  it('refuses every other address, look-alikes included', () => {
    for (const o of [
      'https://evil.example',
      'https://service-hub.ro.evil.example',
      'https://evilservice-hub.ro',
      'https://deploy-preview-1--other.netlify.app',
      'https://service-hubapp.netlify.app.evil.example',
      'http://service-hub.ro',
      'https://localhost:8443',
      'null',
      '',
    ]) {
      expect(allowedOrigin(o), o).toBeNull();
    }
    expect(allowedOrigin(null)).toBeNull();
  });

  it('allows the address in APP_URL', () => {
    expect(allowedOrigin('https://app.example.ro', 'https://app.example.ro/')).toBe('https://app.example.ro');
    expect(allowedOrigin('https://app.example.ro', undefined)).toBeNull();
  });

  it('no answer carries a wildcard origin', () => {
    expect(corsHeaders['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('sets the origin for an allowed address, removes it otherwise, and varies by origin', async () => {
    const res = new Response('{}', { status: 201, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } });
    const ok = withCors(res.clone(), 'https://service-hub.ro');
    expect(ok.status).toBe(201);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('https://service-hub.ro');
    expect(ok.headers.get('Vary')).toBe('Origin');
    expect(ok.headers.get('Content-Type')).toBe('application/json');
    expect(await ok.text()).toBe('{}');
    const refused = withCors(res.clone(), null);
    expect(refused.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const varied = withCors(new Response('', { headers: { Vary: 'Accept-Encoding' } }), null);
    expect(varied.headers.get('Vary')).toBe('Accept-Encoding, Origin');
  });
});
