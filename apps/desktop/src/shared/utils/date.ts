import type { DayOfWeek } from '../types';

// (role: convert Date -> YYYY-MM-DD (local), type: (Date) => string)
export function toYmd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// (role: get DayOfWeek from local date, type: (Date) => DayOfWeek)
export function dayOfWeek(d: Date): DayOfWeek {
  const idx = d.getDay(); // 0=Sun..6=Sat
  const map: Record<number, DayOfWeek> = {
    0: 'Sun',
    1: 'Mon',
    2: 'Tue',
    3: 'Wed',
    4: 'Thu',
    5: 'Fri',
    6: 'Sat',
  };
  return map[idx];
}

// (role: monday start of week, type: (Date) => Date)
export function startOfWeekMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1) - day; // Monday 기준
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// (role: build 7 YYYY-MM-DD strings from weekStartYmd, type: (string) => string[])
export function buildWeekDates(weekStartYmd: string): string[] {
  const [y, m, d] = weekStartYmd.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const cur = new Date(start);
    cur.setDate(start.getDate() + i);
    dates.push(toYmd(cur));
  }
  return dates;
}

// (role: minutes diff helper, type: (string,string)=>number)
export function diffMinutes(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const ms = Math.max(0, end - start);
  return Math.floor(ms / 60000);
}
