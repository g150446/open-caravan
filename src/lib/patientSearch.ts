// 患者検索用に表記ゆれをそろえる: 全角/半角、カタカナ/ひらがな、空白、大文字小文字。
export function normalizeSearch(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[\s　]+/g, '')
    .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

export function matchesPatient(p: {name: string; kana?: string; number: string}, query: string): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  return [p.name, p.kana ?? '', p.number].some(x => normalizeSearch(x).includes(q));
}
