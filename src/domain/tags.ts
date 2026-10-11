export const tagKey = (tag: string) => tag.trim().normalize('NFKC').toLocaleLowerCase('ru')

/** First spelling wins; history precedes the predictable legacy fallback. */
export function tagCatalog(existing: string[], history: string[] = []): string[] {
  return canonicalTags([...history, ...existing.filter((t) => t.trim()).sort((a, b) => a.localeCompare(b, 'ru') || a.localeCompare(b))])
}
export function canonicalTags(values: string[], catalog: string[] = []): string[] {
  const spellings = new Map(catalog.map((tag) => [tagKey(tag), tag.trim()]))
  const seen = new Set<string>()
  return values.flatMap((value) => {
    const key = tagKey(value)
    if (!key || seen.has(key)) return []
    seen.add(key)
    return [spellings.get(key) ?? value.trim()]
  })
}
export function suggestTags(catalog: string[], selected: string[], query: string): string[] {
  const excluded = new Set(selected.map(tagKey))
  return catalog.filter((tag) => !excluded.has(tagKey(tag)) && tagKey(tag).includes(tagKey(query))).slice(0, 5)
}
export function recentTags(history: string[], used: string[]): string[] {
  // Within one save, the last tag in the card is considered most recent.
  return canonicalTags([...used].reverse().concat(history))
}
