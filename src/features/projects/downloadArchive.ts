export function downloadArchive(bytes: Uint8Array, filename: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/zip' }))
  const link = document.createElement('a')
  try {
    link.href = url; link.download = filename
    document.body.appendChild(link)
    link.click()
  } finally {
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
