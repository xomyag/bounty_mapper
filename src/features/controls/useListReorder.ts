import { useRef, useState } from 'react'
import type { DragEvent, MouseEvent } from 'react'
import { moveListItem } from '../../domain/listOrder'

export function useListReorder(ids: string[], disabled: boolean, onReorder: (ids: string[]) => void) {
  const dragging = useRef<string | undefined>(undefined)
  const [insertion,setInsertion] = useState<{id:string;after:boolean}>()
  const clear = () => { dragging.current = undefined; setInsertion(undefined) }
  return {
    handle: (id: string) => ({
      draggable: !disabled, disabled,
      onClick: (event: MouseEvent) => { event.preventDefault(); event.stopPropagation() },
      onDragStart: (event: DragEvent) => { if (disabled) { event.preventDefault(); return }; dragging.current=id; event.dataTransfer.effectAllowed='move'; event.dataTransfer.setData('text/plain',id); event.stopPropagation() },
      onDragEnd: clear,
    }),
    row: (id: string) => ({
      'data-insertion': insertion?.id === id ? insertion.after ? 'after' : 'before' : undefined,
      onDragOver: (event: DragEvent<HTMLElement>) => { if (disabled || !dragging.current) return; event.preventDefault(); event.dataTransfer.dropEffect='move'; const bounds=event.currentTarget.getBoundingClientRect();setInsertion({id,after:event.clientY>bounds.top+bounds.height/2}) },
      onDrop: (event: DragEvent<HTMLElement>) => { event.preventDefault(); event.stopPropagation(); const bounds=event.currentTarget.getBoundingClientRect();if (!disabled && dragging.current) { const next=moveListItem(ids,dragging.current,id,event.clientY>bounds.top+bounds.height/2);if(next.some((value,index)=>value!==ids[index]))onReorder(next) };clear() },
    }),
    step: (id: string, direction: -1 | 1) => { const index=ids.indexOf(id);const target=ids[index+direction];if(!disabled&&target)onReorder(moveListItem(ids,id,target,direction===1)) },
  }
}
