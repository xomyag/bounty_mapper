import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export function TooltipTags({ tags }: { tags: string[] }) {
  if (!tags.length) return null
  return <div className="tooltip-tags">{tags.slice(0, 5).map((tag) => <span key={tag} title={tag}>{tag}</span>)}{tags.length > 5 && <span>ещё {tags.length - 5}</span>}</div>
}
export function ObjectTooltip({ position, size, children }: { position: { x: number; y: number }; size: { width: number; height: number }; children: ReactNode }) {
  const element = useRef<HTMLElement>(null)
  const [bounds, setBounds] = useState({ width: 304, height: 164 })
  useLayoutEffect(() => {
    const update = () => { if (element.current) setBounds({ width: element.current.offsetWidth, height: element.current.offsetHeight }) }
    update(); const observer = new ResizeObserver(update); if (element.current) observer.observe(element.current)
    return () => observer.disconnect()
  }, [])
  return <aside ref={element} className="region-hover" role="tooltip" style={{ left: Math.max(8, Math.min(position.x, size.width - bounds.width - 8)), top: Math.max(8, Math.min(position.y, size.height - bounds.height - 8)), maxHeight: Math.max(1, Math.min(280, size.height - 16)) }}>{children}</aside>
}
