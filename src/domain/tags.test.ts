import { describe, expect, it } from 'vitest'
import { canonicalTags, recentTags, suggestTags, tagCatalog } from './tags'

describe('Shared project tags', () => {
  it('trims and reuses canonical spelling without case duplicates', () => {
    expect(canonicalTags([' ловушка ', 'ЛОВУШКА', ' Новый ', 'новый'], ['Ловушка'])).toEqual(['Ловушка', 'Новый'])
  })
  it('uses history first, with a stable sorted fallback for legacy/imported projects', () => {
    const existing = ['Север', 'Ключ', 'Тайна', 'ключ']
    expect(tagCatalog(existing)).toEqual(tagCatalog([...existing].reverse()))
    expect(tagCatalog(existing, ['Тайна', 'Ключ']).slice(0, 2)).toEqual(['Тайна', 'Ключ'])
  })
  it('suggests at most five recent substring matches, excluding selected tags', () => {
    const catalog = ['Ловушка', 'Тайна', 'Башня', 'Шахта', 'Ключ', 'Север', 'Юг']
    expect(suggestTags(catalog, [], '')).toEqual(catalog.slice(0, 5))
    expect(suggestTags(catalog, [' ловУШКА '], 'Ш')).toEqual(['Башня', 'Шахта'])
    expect(recentTags(['Ловушка', 'Ключ'], ['Тайна', 'Ловушка'])).toEqual(['Ловушка', 'Тайна', 'Ключ'])
  })
})
