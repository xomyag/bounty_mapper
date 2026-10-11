import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import type { Plugin } from 'vite'

export function offlinePlugin(): Plugin {
  let root = ''; let output = ''; let base = '/'
  return {
    name: 'bounty-mapper-offline', apply: 'build',
    configResolved(config) { root = config.root; output = resolve(root, config.build.outDir); base = config.base },
    async closeBundle() {
      const entries = await readdir(output, { recursive: true, withFileTypes: true })
      const paths = entries.filter((entry) => entry.isFile()).map((entry) => relative(output, join(entry.parentPath, entry.name)).replaceAll('\\', '/')).filter((path) => path !== 'sw.js').sort()
      const source = await readFile(join(root, 'src/offline/worker.js'), 'utf8')
      const digest = createHash('sha256').update(source)
      for (const path of paths) digest.update(path).update(await readFile(join(output, path)))
      const manifest = { version: digest.digest('hex').slice(0, 20), urls: paths.map((path) => `${base}${path}`) }
      await writeFile(join(output, 'sw.js'), source.replace("'__BM_PRECACHE__'", JSON.stringify(JSON.stringify(manifest))))
    },
  }
}
