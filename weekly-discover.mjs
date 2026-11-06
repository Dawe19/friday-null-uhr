import { api, getAll } from './lib/api.js';
import { pathToFileURL } from 'node:url';

const TARGET_ID = process.env.SPOTIFY_PLAYLIST_ID;
const MARKET = process.env.SPOTIFY_MARKET ?? 'DE';
const LOOKBACK_DAYS = 7;

function cleanName(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function namesFromEnv(name) {
  return new Set(String(process.env[name] ?? '').split(',').map(cleanName).filter(Boolean));
}

const FRENCH_FAVORITES = namesFromEnv('SPOTIFY_FRENCH_FAVORITES');
const US_FAVORITES = namesFromEnv('SPOTIFY_US_FAVORITES');

function releaseDate(album) {
  return album.release_date_precision === 'day' ? (album.release_date ?? '') : '';
}

function isRecent(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const ageDays = (Date.now() - Date.parse(`${date}T23:59:59Z`)) / 86_400_000;
  return ageDays >= -1 && ageDays <= LOOKBACK_DAYS;
}

function artistsOf(item) {
  return item?.artists ?? [];
}

async function fetchTargetUris() {
  if (!TARGET_ID) throw new Error('SPOTIFY_PLAYLIST_ID fehlt in der Container-Umgebung.');
  const items = await getAll(`/playlists/${TARGET_ID}/items?limit=50`);
  return new Set(items.map((entry) => (entry.item ?? entry.track)?.uri).filter(Boolean));
}

async function searchArtists(query) {
  const params = new URLSearchParams({ q: query, type: 'artist', market: MARKET, limit: '10' });
  const response = await api('GET', `/search?${params.toString()}`);
  return response.artists?.items ?? [];
}

async function albumTracks(album) {
  const result = await api('GET', `/albums/${album.id}/tracks?limit=50&market=${MARKET}`);
  return result.items ?? [];
}

function artistBucket(artist) {
  const name = cleanName(artist.name);
  const genres = (artist.genres ?? []).map(cleanName).join(' ');
  if (FRENCH_FAVORITES.has(name) || /french|francais|français|rap franc|french hip hop/.test(genres)) return 'fr';
  if (US_FAVORITES.has(name) || /atlanta rap|southern hip hop|trap|melodic rap|us hip hop/.test(genres)) return 'us';
  return null;
}

export async function runWeeklyDiscovery({ dryRun = false } = {}) {
  const targetUris = await fetchTargetUris();
  const likedItems = await getAll('/me/tracks?limit=50');
  const excluded = new Set(targetUris);
  const likedArtistNames = new Map();
  for (const entry of likedItems) {
    const track = entry.track ?? entry.item;
    if (track?.uri) excluded.add(track.uri);
    for (const artist of artistsOf(track)) {
      const key = cleanName(artist.name);
      likedArtistNames.set(key, (likedArtistNames.get(key) ?? 0) + 1);
    }
  }

  const candidates = new Map();
  const seenAlbums = new Set();
  const addAlbum = async (album, bucket, affinity = 0) => {
    const date = releaseDate(album);
    if (/\b(deluxe|expanded|remaster(?:ed)?|anniversary|reissue|réédition|edition spéciale)\b/i.test(album?.name ?? '')) return;
    if (!album?.id || !isRecent(date) || seenAlbums.has(album.id)) return;
    seenAlbums.add(album.id);
    const tracks = await albumTracks(album).catch(() => []);
    for (const track of tracks) {
      if (!track?.uri?.startsWith('spotify:track:') || excluded.has(track.uri)) continue;
      const trackArtists = artistsOf(track).length ? artistsOf(track) : artistsOf(album);
      const likedWeight = trackArtists.reduce((sum, artist) => sum + (likedArtistNames.get(cleanName(artist.name)) ?? 0), 0);
      const key = track.uri;
      if (!candidates.has(key)) {
        const ageDays = Math.max(0, (Date.now() - Date.parse(`${date}T23:59:59Z`)) / 86_400_000);
        candidates.set(key, {
          uri: key,
          name: track.name,
          artists: trackArtists.map((artist) => artist.name).join(', '),
          album: album.name,
          date,
          bucket,
          score: affinity + likedWeight * 3 + Math.max(0, LOOKBACK_DAYS - ageDays) / LOOKBACK_DAYS,
        });
      }
    }
  };

  // First look for recent albums from artists that already appear in the user's listening history.
  const topArtists = await api('GET', '/me/top/artists?limit=50&time_range=medium_term').catch(() => ({ items: [] }));
  for (const [index, artist] of (topArtists.items ?? []).slice(0, 20).entries()) {
    const bucket = artistBucket(artist);
    if (!bucket) continue;
    const params = new URLSearchParams({ include_groups: 'album,single', limit: '10', market: MARKET });
    const albums = await api('GET', `/artists/${artist.id}/albums?${params.toString()}`).catch(() => ({ items: [] }));
    for (const album of albums.items ?? []) await addAlbum(album, bucket, 10 - index / 2);
  }

  // Add a discovery lane for unfamiliar artists, separated into French and US rap searches.
  const discoveryQueries = [
    ['fr', 'genre:french rap'],
    ['fr', 'genre:francophone rap'],
    ['us', 'genre:hip-hop'],
    ['us', 'genre:trap'],
  ];
  const discoveredArtistIds = new Set();
  for (const [bucket, query] of discoveryQueries) {
    const artists = await searchArtists(query).catch(() => []);
    for (const [index, artist] of artists.entries()) {
      if (!artist?.id || discoveredArtistIds.has(artist.id)) continue;
      discoveredArtistIds.add(artist.id);
      const artistGenreBucket = artistBucket(artist);
      const actualBucket = artistGenreBucket ?? bucket;
      if (bucket === 'us' && artistGenreBucket === 'fr') continue;
      const params = new URLSearchParams({ include_groups: 'album,single', limit: '10', market: MARKET });
      const albums = await api('GET', `/artists/${artist.id}/albums?${params.toString()}`).catch(() => ({ items: [] }));
      const likedWeight = likedArtistNames.get(cleanName(artist.name)) ?? 0;
      for (const album of albums.items ?? []) {
        await addAlbum(album, actualBucket, 1 + likedWeight * 3 + Math.max(0, 5 - index / 2));
      }
    }
  }

  const ordered = [...candidates.values()].sort((a, b) => b.score - a.score || b.date.localeCompare(a.date));
  const selected = ordered;

  console.log(`🇫🇷 / US-Rap | ${selected.length} neue Titel aus den letzten ${LOOKBACK_DAYS} Tagen | Zielplaylist ${TARGET_ID}${dryRun ? ' | Probelauf' : ''}`);
  selected.forEach((track, index) => {
    console.log(`${String(index + 1).padStart(2, '0')}. ${track.date}  ${track.artists} — ${track.name}  [${track.album}]`);
  });
  if (!selected.length) {
    console.log('Keine passenden neuen Titel gefunden; Playlist bleibt unverändert.');
    return;
  }
  if (dryRun) return;

  for (let i = 0; i < selected.length; i += 100) {
    await api('POST', `/playlists/${TARGET_ID}/items`, { uris: selected.slice(i, i + 100).map((track) => track.uri) });
  }
  console.log(`\n${selected.length} Titel wurden ans Ende der Playlist angehängt.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWeeklyDiscovery({ dryRun: process.argv.includes('--dry-run') }).catch((error) => {
    console.error(`Spotify-Wochenlauf fehlgeschlagen: ${error.message}`);
    process.exit(1);
  });
}
