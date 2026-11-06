import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePKCE, openBrowser, green, bold, dim } from './helpers.js';

const CONFIG_URL = new URL('../config.json', import.meta.url);
const TOKEN_URL = new URL('../.spotify-tokens.json', import.meta.url);
const PORT = 8000;

function getTokenPath() {
  return process.env.SPOTIFY_TOKEN_PATH
    ? path.resolve(process.env.SPOTIFY_TOKEN_PATH)
    : fileURLToPath(TOKEN_URL);
}

export const REDIRECT_URI = 'http://[::1]:8000/callback';
export const SCOPES = [
  'user-read-private',
  'user-read-email',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
  'user-library-read',
  'user-library-modify',
  'user-top-read',
].join(' ');

export function getClientId() {
  if (process.env.SPOTIFY_CLIENT_ID) return process.env.SPOTIFY_CLIENT_ID;
  let config;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_URL, 'utf8'));
  } catch {
    throw new Error('config.json nicht gefunden oder ungültiges JSON. Erstelle sie im Projektordner mit {"CLIENT_ID": "..."}');
  }
  if (!config.CLIENT_ID) {
    throw new Error('In config.json fehlt die CLIENT_ID. Hole sie aus dem Spotify Developer Dashboard (https://developer.spotify.com/dashboard) und trage sie dort ein.');
  }
  return config.CLIENT_ID;
}

export function loadTokens() {
  try {
    return JSON.parse(fs.readFileSync(getTokenPath(), 'utf8'));
  } catch {
    return null;
  }
}

export function saveTokens(tokens) {
  fs.writeFileSync(getTokenPath(), JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

async function tokenRequest(body) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...body, client_id: getClientId(), redirect_uri: REDIRECT_URI }),
  });
  if (!res.ok) throw new Error(`Token-Anfrage fehlgeschlagen (${res.status}): ${await res.text()}`);
  return res.json();
}

function waitForCode(expectedState) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://[::1]:${PORT}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (error || !code || state !== expectedState) {
        res.end('<h1>Login fehlgeschlagen</h1><p>Dieses Fenster kannst du schließen. Versuche es im Terminal erneut.</p>');
        cleanup();
        reject(new Error(`Login abgelehnt oder ungültig (${error ?? 'state mismatch'})`));
      } else {
        res.end('<h1>Login erfolgreich!</h1><p>Dieses Fenster kannst du schließen und zum Terminal zurückkehren.</p>');
        cleanup();
        resolve(code);
      }
    });
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Zeitüberschreitung: kein Login innerhalb von 5 Minuten.'));
    }, 300_000);
    const cleanup = () => {
      clearTimeout(timer);
      server.close();
    };
    server.on('error', (err) => {
      cleanup();
      reject(err.code === 'EADDRINUSE'
        ? new Error(`Port ${PORT} ist bereits belegt. Schließe andere Login-Versuche/Terminals und versuche es erneut.`)
        : err);
    });
    server.listen(PORT, '::1');
  });
}

export async function login() {
  const { verifier, challenge } = generatePKCE();
  const state = crypto.randomUUID();
  const url = new URL('https://accounts.spotify.com/authorize');
  url.searchParams.set('client_id', getClientId());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('state', state);

  console.log(bold('\nSpotify-Login'));
  console.log('Es sollte sich gleich ein Browserfenster öffnen. Falls nicht, öffne diese URL manuell:');
  console.log(dim(url.toString()) + '\n');
  openBrowser(url.toString());

  const code = await waitForCode(state);
  const tokens = await tokenRequest({ grant_type: 'authorization_code', code, code_verifier: verifier });
  tokens.expires_at = Date.now() + tokens.expires_in * 1000;
  saveTokens(tokens);
  console.log(green('Login erfolgreich, Zugangsdaten gespeichert.'));
  return tokens;
}

export async function refreshAccessToken(tokens) {
  if (!tokens.refresh_token) {
    throw new Error('Kein Refresh-Token vorhanden. Bitte neu einloggen: node spotify.js login');
  }
  const data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
  return {
    ...tokens,
    access_token: data.access_token,
    expires_at: Date.now() + data.expires_in * 1000,
    refresh_token: data.refresh_token ?? tokens.refresh_token,
  };
}
