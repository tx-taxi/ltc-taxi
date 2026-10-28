/** Preferences shared by tx.taxi explorers. Local development remains host-only. */
export type SharedPreference = 'txtaxi_language' | 'txtaxi_currency';

export function readSharedPreference(doc: Document, name: SharedPreference): string | null {
  try {
    const prefix = `${name}=`;
    const entry = doc.cookie.split(';').map(part => part.trim()).find(part => part.startsWith(prefix));
    return entry ? decodeURIComponent(entry.slice(prefix.length)) : null;
  } catch {
    return null;
  }
}

export function writeSharedPreference(doc: Document, name: SharedPreference, value: string): void {
  try {
    const { hostname, protocol } = doc.location;
    const sharedDomain = hostname === 'tx.taxi' || hostname.endsWith('.tx.taxi');
    const domain = sharedDomain && protocol === 'https:' ? '; Domain=.tx.taxi' : '';
    const secure = protocol === 'https:' ? '; Secure' : '';
    doc.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=31536000; Path=/; SameSite=Lax${domain}${secure}`;
  } catch { /* Browsing with cookies disabled should still work. */ }
}
