import crypto from 'node:crypto';
import readline from 'node:readline';
import { execSync } from 'node:child_process';

const isTTY = process.stdout.isTTY;
const wrap = (code) => (s) => (isTTY ? `\x1b[${code}m${String(s)}\x1b[0m` : String(s));

export const bold = wrap('1');
export const dim = wrap('2');
export const red = wrap('31');
export const green = wrap('32');
export const yellow = wrap('33');
export const cyan = wrap('36');

export function openBrowser(url) {
  const cmds = {
    darwin: `open "${url}"`,
    win32: `start "" "${url}"`,
    linux: `xdg-open "${url}"`,
  };
  try {
    execSync(cmds[process.platform], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function base64url(buf) {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function generatePKCE() {
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function fmtTrack(track) {
  if (!track) return '– (nicht verfügbar)';
  const artists = (track.artists ?? []).map((a) => a.name).join(', ');
  return `${artists || 'Unbekannter Künstler'} – ${track.name}`;
}

export function fmtDuration(ms) {
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin} min`;
  return `${Math.floor(totalMin / 60)} h ${totalMin % 60} min`;
}

export function truncate(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n);
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function confirm(msg) {
  if (process.argv.includes('--yes')) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${msg} ${yellow('[j/N]')} `, (answer) => {
      rl.close();
      resolve(['j', 'ja', 'y', 'yes'].includes(answer.trim().toLowerCase()));
    });
  });
}
