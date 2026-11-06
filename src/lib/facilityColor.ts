// 予定表で施設ごとの枠を見分けるための色。施設に色が登録されていなければ、施設IDから毎回同じ色を選ぶ。
export const facilityPalette = ['#079763', '#1f6feb', '#d9822b', '#8e44ad', '#d6336c', '#0e9aa7', '#7f8c2d', '#b5651d'];

export function defaultFacilityColor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return facilityPalette[h % facilityPalette.length];
}

export function facilityColor(f: {id: string; color?: string}): string {
  return f.color && /^#[0-9a-fA-F]{6}$/.test(f.color) ? f.color : defaultFacilityColor(f.id);
}

// 新しい施設に、まだ使われていないパレット色を順に割り当てる。
export function nextFacilityColor(existing: {id: string; color?: string}[]): string {
  const used = new Set(existing.map(f => facilityColor(f).toLowerCase()));
  return facilityPalette.find(c => !used.has(c.toLowerCase())) ?? facilityPalette[existing.length % facilityPalette.length];
}
