import { loadTokens, saveTokens, login, refreshAccessToken } from './auth.js';

export async function getAccessToken() {
  let tokens = loadTokens();
  if (!tokens) {
    if (process.env.SPOTIFY_NONINTERACTIVE === '1') {
      throw new Error('Kein gespeicherter Spotify-Token. Bitte lokal anmelden und die Token-Datei bereitstellen.');
    }
    tokens = await login();
  }
  if (!tokens.expires_at || Date.now() > tokens.expires_at - 60_000) {
    tokens = await refreshAccessToken(tokens);
    saveTokens(tokens);
  }
  return tokens.access_token;
}

export async function api(method, path, body, _retried = true, _tries = 0) {
  const token = await getAccessToken();
  const url = path.startsWith('http') ? path : `https://api.spotify.com/v1${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 429) {
    if (_tries >= 6) throw new Error(`Spotify API 429: Rate-Limit nach ${_tries} Versuchen aufgegeben.`);
    const waitMs = (Number(res.headers.get('retry-after')) || 1) * 1000 + 200;
    await new Promise((r) => setTimeout(r, Math.min(waitMs, 15_000)));
    return api(method, path, body, _retried, _tries + 1);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);

  if (res.status === 403 && _retried) {
    await new Promise((r) => setTimeout(r, 1500));
    return api(method, path, body, false);
  }
  if (res.status === 401 && _retried && loadTokens()?.refresh_token) {
    const fresh = await refreshAccessToken(loadTokens());
    saveTokens(fresh);
    return api(method, path, body, false);
  }
  if (!res.ok) {
    const msg = data?.error?.message ?? res.statusText;
    const hint = res.status === 403
      ? ' Hinweis: Dein Account muss im Spotify Developer Dashboard unter "User Management" eingetragen sein.'
      : '';
    throw new Error(`Spotify API ${res.status}: ${msg}.${hint}`);
  }
  return data;
}

export async function getAll(path, key = 'items') {
  let items = [];
  let url = path;
  while (url) {
    const data = await api('GET', url);
    items = items.concat(data[key] ?? []);
    url = data.next ? data.next.replace('https://api.spotify.com/v1', '') : null;
  }
  return items;
}
