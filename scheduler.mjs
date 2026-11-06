import { runWeeklyDiscovery } from './weekly-discover.mjs';

const TIME_ZONE = process.env.SPOTIFY_TIMEZONE ?? 'Europe/Berlin';
const RUN_DAY = 5; // Friday, where Sunday is 0.
const RUN_HOUR = 3;
const RUN_MINUTE = 0;

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const weekdayIndex = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function localParts(date) {
  const parts = Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: weekdayIndex[parts.weekday],
  };
}

function offsetAt(instant) {
  const parts = localParts(instant);
  const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return representedAsUtc - instant.getTime();
}

function localTimeToUtc(year, month, day, hour, minute) {
  const representedAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let instant = representedAsUtc;
  for (let attempt = 0; attempt < 4; attempt++) {
    instant = representedAsUtc - offsetAt(new Date(instant));
  }
  return new Date(instant);
}

function nextRun(from = new Date()) {
  const now = localParts(from);
  let daysUntilRun = (RUN_DAY - now.weekday + 7) % 7;
  const runTimeHasPassed = now.hour > RUN_HOUR ||
    (now.hour === RUN_HOUR && (now.minute > RUN_MINUTE || (now.minute === RUN_MINUTE && now.second > 0)));
  if (daysUntilRun === 0 && runTimeHasPassed) daysUntilRun = 7;

  const targetDate = new Date(Date.UTC(now.year, now.month - 1, now.day + daysUntilRun));
  return localTimeToUtc(targetDate.getUTCFullYear(), targetDate.getUTCMonth() + 1, targetDate.getUTCDate(), RUN_HOUR, RUN_MINUTE);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  console.log(`Spotify-Freitagssuche aktiv (${TIME_ZONE}, Freitag ${String(RUN_HOUR).padStart(2, '0')}:${String(RUN_MINUTE).padStart(2, '0')}).`);
  while (true) {
    const scheduledFor = nextRun();
    console.log(`Nächster Lauf: ${scheduledFor.toISOString()} (${TIME_ZONE}).`);
    await wait(Math.max(0, scheduledFor.getTime() - Date.now()));
    console.log('Starte Suche nach neuen französischen und US-Rap-Titeln.');
    try {
      await runWeeklyDiscovery();
    } catch (error) {
      console.error(`Spotify-Wochenlauf fehlgeschlagen: ${error.message}`);
    }
  }
}

main().catch((error) => {
  console.error(`Scheduler fehlgeschlagen: ${error.message}`);
  process.exit(1);
});
