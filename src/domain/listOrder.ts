export function moveListItem(ids: string[], id: string, target: string, after = false): string[] {
  if (id === target || !ids.includes(id) || !ids.includes(target)) return ids
  const next = ids.filter(value => value !== id)
  next.splice(next.indexOf(target) + Number(after), 0, id)
  return next
}
export function isCompleteOrder(ids: string[], existing: string[]): boolean {
  return ids.length === existing.length && new Set(ids).size === ids.length && ids.every(id => existing.includes(id))
}
