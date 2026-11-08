/** `Novák & syn Reality s.r.o.` → `novak-syn-reality`. Only a proposal; Josef confirms. */
const DROP = new Set(['s-r-o', 'sro', 'a-s', 'as', 'spol', 'v-o-s'])

export function slugifyCzech(name: string): string {
  let s = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  for (const d of DROP) s = s.replace(new RegExp(`-${d}$`), '')
  s = s.replace(/-s-r-o$|-a-s$/, '')
  return s.slice(0, 63).replace(/-+$/, '')
}
