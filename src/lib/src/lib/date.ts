export function dateKey(d: Date | string) {
  return new Date(new Date(d).getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
export function addDays(key: string, days: number) {
  const d = new Date(`${key}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function weekStart(key: string) {
  const day = new Date(`${key}T00:00:00Z`).getUTCDay(); return addDays(key, -((day + 6) % 7));
}
export function monthStart(key: string) { return `${key.slice(0, 7)}-01`; }
export function nextMonth(key: string, n = 1) {
  const d = new Date(`${monthStart(key)}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
export function jstDate(key: string, time = '00:00') { return new Date(`${key}T${time}:00+09:00`); }
export function timeKey(d: Date | string) { return new Date(new Date(d).getTime() + 9 * 3600000).toISOString().slice(11, 16); }
export type Recurrence = { kind: 'weekly' | 'monthly'; interval: number; weekdays: number[]; ordinals: number[] };
export function occurrences(start: string, end: string, rule: Recurrence): string[] {
  const result: string[] = [];
  if (end < start || end > addDays(start, 1096)) throw new Error('繰り返し期間は開始日から3年以内で指定してください。');
  for (let key = start; key <= end; key = addDays(key, 1)) {
    const d = new Date(`${key}T00:00:00Z`);
    if (!rule.weekdays.includes(d.getUTCDay())) continue;
    if (rule.kind === 'weekly') {
      const weeks = Math.round((new Date(weekStart(key)).getTime() - new Date(weekStart(start)).getTime()) / 604800000);
      if (weeks % rule.interval === 0) result.push(key);
    } else if (rule.ordinals.includes(Math.ceil(d.getUTCDate() / 7))) result.push(key);
  }
  return result;
}
