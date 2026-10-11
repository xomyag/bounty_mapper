import type { Map, Project } from '../domain/project'
import { PROJECT_SCHEMA_VERSION, validateProject } from '../domain/project'
import { validateRichDocument } from '../domain/richText'
import type { RichDocument, RichNode } from '../domain/richText'
import { markdownToDocument } from './migrateRegionText'

// The shipped textarea explicitly accepted Markdown. Preserve soft line breaks
// too; HTML nodes are already converted to literal text by the existing parser.
export function legacyContextDocument(text: string): RichDocument {
  const document = markdownToDocument(text)
  const plain = document.content.every((node) => node.type === 'paragraph' && (node.content ?? []).every((child) => child.type === 'text' && !child.marks?.length))
  if (plain) {
    const content = text.replace(/\r\n/g, '\n').split('\n').flatMap((line, index) => [...(index ? [{ type: 'hardBreak' }] : []), ...(line ? [{ type: 'text', text: line }] : [])])
    const result: RichDocument = { type: 'doc', content: [{ type: 'paragraph', ...(content.length ? { content } : {}) }] }
    validateRichDocument(result); return result
  }
  const walk = (node: RichNode, code = false): RichNode[] => {
    if (node.type === 'text' && !code && node.text?.includes('\n')) return node.text.split('\n').flatMap((part, index) => [...(index ? [{ type: 'hardBreak' }] : []), ...(part ? [{ ...node, text: part }] : [])])
    return [{ ...node, ...(node.content ? { content: node.content.flatMap((child) => walk(child, code || node.type === 'codeBlock')) } : {}) }]
  }
  const migrated: RichDocument = { type: 'doc', content: document.content.flatMap((node) => walk(node)) }
  validateRichDocument(migrated); return migrated
}
export function migrateProjectContext(value: Record<string, unknown>): Project {
  const { contextMd, ...rest } = value
  if (value.schemaVersion !== 1 && value.schemaVersion !== PROJECT_SCHEMA_VERSION) throw new Error('Версия проекта не поддерживается.')
  if (value.schemaVersion === 1 && typeof contextMd !== 'string') throw new Error('Повреждённый контекст приключения.')
  const project = { ...rest, schemaVersion: PROJECT_SCHEMA_VERSION, context: value.schemaVersion === 1 ? legacyContextDocument(contextMd as string) : value.context } as Project
  validateProject(project); return project
}
export function migrateMapDescription(value: Record<string, unknown>): Map {
  const { notesMd, ...rest } = value
  if (!Object.hasOwn(rest, 'description') && typeof notesMd !== 'string') throw new Error('Повреждённое описание карты.')
  const description = Object.hasOwn(rest, 'description') ? rest.description : legacyContextDocument(notesMd as string)
  validateRichDocument(description)
  return { ...rest, description } as Map
}
