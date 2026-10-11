import { documentText } from '../../domain/richText'
import type { RichDocument } from '../../domain/richText'

// Fixtures for formats 1–7 must contain the actual shipped text fields,
// rather than a new JSON document with only its manifest version changed.
export function legacyTestMetadata(root: Record<string, unknown>) {
  const project = root.project as Record<string, unknown>
  const context = project.context as RichDocument
  project.contextMd = context.content.map((node) => `${node.type === 'heading' ? '#'.repeat(Number(node.attrs?.level ?? 1)) + ' ' : ''}${documentText({ type: 'doc', content: [node] })}`).join('\n')
  delete project.context; project.schemaVersion = 1
  for (const map of root.maps as Record<string, unknown>[]) { map.notesMd = documentText(map.description as RichDocument); delete map.description }
}
