import type { ButtonHTMLAttributes } from 'react'
import type { LucideIcon } from 'lucide-react'

export function IconButton({ icon: Icon, label, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return <button {...props} type="button" className={`icon-button ${props.className ?? ''}`} aria-label={label} title={label}><Icon size={20} aria-hidden="true" /></button>
}
