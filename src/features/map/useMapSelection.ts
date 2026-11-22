import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent, RefObject } from 'react'
import type Konva from 'konva'
import type { Camera, Point, Bounds } from '../../domain/viewport'
import { screenToWorld } from '../../domain/viewport'
import { emptySelection, selectionBounds } from '../../domain/selection'
import type { ObjectSelection } from '../../domain/selection'
import type { Region } from '../../domain/region'
import type { MarkerPlacement } from '../../domain/marker'
import type { RegionSession } from '../../application/regionSession'

export const OBJECT_DRAG_DISTANCE = 5
interface Hit { kind: 'region' | 'marker'; id: string }
interface MovePreview { mapId: string; selection: ObjectSelection; offset: Point; regions: Region[]; markers: MarkerPlacement[] }
interface Gesture { pointerId: number; mapId: string; start: Point; camera: Camera; pan: boolean; hit?: Hit; shift: boolean; started: boolean; blocked?: boolean; previous: ObjectSelection; selection: ObjectSelection; offset: Point; regions: Region[]; markers: MarkerPlacement[] }

export function useMapSelection({ host, stage, camera, session, enabled, setCamera }: { host: RefObject<HTMLDivElement | null>; stage: RefObject<Konva.Stage | null>; camera: Camera; session: RegionSession; enabled: boolean; setCamera: (update: (current: Camera) => Camera) => void }) {
  const gesture = useRef<Gesture | undefined>(undefined)
  const space = useRef(false)
  const [preview, setPreview] = useState<MovePreview>()
  const [marquee, setMarquee] = useState<Bounds>()
  const live = useRef({ camera, enabled, setCamera })
  useLayoutEffect(() => { live.current = { camera, enabled, setCamera } },[camera,enabled,setCamera])
  const release = (id: number) => { if (host.current?.hasPointerCapture(id)) host.current.releasePointerCapture(id) }
  const cancel = () => {
    const active = gesture.current
    if (!active) return false
    gesture.current = undefined; release(active.pointerId)
    setPreview(undefined); setMarquee(undefined)
    if (active.pan) live.current.setCamera(() => active.camera)
    if (session.getSnapshot().mapId === active.mapId) session.setSelection(active.previous)
    return true
  }
  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target !== host.current && target !== document.body) return
      if (event.code === 'Space') { space.current = true; event.preventDefault() }
      if (event.key === 'Escape' && gesture.current) {
        const active = gesture.current; gesture.current = undefined
        if (host.current?.hasPointerCapture(active.pointerId)) host.current.releasePointerCapture(active.pointerId)
        setPreview(undefined); setMarquee(undefined); session.setSelection(active.previous)
        if (active.pan) live.current.setCamera(() => active.camera)
        event.preventDefault(); event.stopPropagation()
      }
    }
    const keyUp = (event: KeyboardEvent) => { if (event.code === 'Space') space.current = false }
    const blur = () => {
      space.current = false
      const active = gesture.current; gesture.current = undefined
      if (active && host.current?.hasPointerCapture(active.pointerId)) host.current.releasePointerCapture(active.pointerId)
      setPreview(undefined); setMarquee(undefined)
    }
    const unsubscribe = session.subscribe(() => {
      const state = session.getSnapshot(); const active = gesture.current
      if (active && (state.mapId !== active.mapId || state.mode !== 'prepare' && !active.pan || state.draft || state.markerTool || state.vertexMode || state.imageAlignment)) {
        // Explicit pan is also available inside the other tools.
        if (active.pan && state.mapId === active.mapId) return
        gesture.current = undefined
        if (host.current?.hasPointerCapture(active.pointerId)) host.current.releasePointerCapture(active.pointerId)
        setPreview(undefined); setMarquee(undefined)
      }
    })
    window.addEventListener('keydown',keyDown,true); window.addEventListener('keyup',keyUp,true); window.addEventListener('blur',blur)
    return () => { unsubscribe(); window.removeEventListener('keydown',keyDown,true); window.removeEventListener('keyup',keyUp,true); window.removeEventListener('blur',blur) }
  },[host,session])
  const screenPoint = (event: PointerEvent) => { const box = host.current!.getBoundingClientRect(); return { x:event.clientX-box.left, y:event.clientY-box.top } }
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (gesture.current || !event.isPrimary || !(event.target instanceof HTMLCanvasElement) || event.button !== 0 && event.button !== 1) return
    const state = session.getSnapshot()
    const pan = event.button === 1 || space.current && event.button === 0
    if (!pan && (!live.current.enabled || !session.canUseSelection())) return
    const start = screenPoint(event)
    const node = stage.current?.getIntersection(start)
    const markerId = node?.findAncestor('.map-marker',true)?.getAttr('markerId') as string | undefined
    const regionId = node?.findAncestor('.map-region',true)?.getAttr('regionId') as string | undefined
    if (!pan && markerId === state.markerDraft?.marker.id && state.markerDraft?.isNew) return
    const hit: Hit | undefined = markerId ? {kind:'marker',id:markerId} : regionId ? {kind:'region',id:regionId} : undefined
    if (!pan && !hit && state.markerDraft?.isNew) return
    gesture.current = { pointerId:event.pointerId, mapId:state.mapId!, start, camera:{...live.current.camera}, pan:pan || event.pointerType === 'touch' && !hit, hit, shift:event.shiftKey, started:false, previous:state.selection, selection:emptySelection(), offset:{x:0,y:0}, regions:state.regions, markers:state.markers }
    event.preventDefault(); event.stopPropagation(); host.current?.focus({preventScroll:true}); host.current?.setPointerCapture(event.pointerId)
  }
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = gesture.current
    if (!active || active.pointerId !== event.pointerId) return
    event.preventDefault(); event.stopPropagation()
    if (active.blocked) return
    const point = screenPoint(event)
    const delta = {x:point.x-active.start.x,y:point.y-active.start.y}
    if (!active.started && Math.hypot(delta.x,delta.y) < OBJECT_DRAG_DISTANCE) return
    if (active.pan) {
      active.started = true
      live.current.setCamera((current) => ({...current,x:active.camera.x+delta.x,y:active.camera.y+delta.y}))
      return
    }
    if (!live.current.enabled || !session.canUseSelection()) { cancel(); return }
    if (!active.started && active.hit) {
      if (active.hit.kind === 'marker' && active.markers.find((m) => m.id === active.hit!.id)?.locked) { active.blocked=true; return }
      if (!session.prepareObjectMove()) { cancel(); return }
      const key = active.hit.kind === 'region' ? 'regionIds' : 'markerIds'
      active.selection = active.previous[key].includes(active.hit.id) ? active.previous : active.shift ? { ...active.previous, [key]:[...active.previous[key],active.hit.id] } : { ...emptySelection(), [key]:[active.hit.id] }
      session.setSelection(active.selection)
    }
    active.started = true
    if (active.hit) {
      active.offset = {x:delta.x/active.camera.scale,y:delta.y/active.camera.scale}
      setPreview({ mapId:active.mapId, selection:active.selection, offset:active.offset, regions:active.regions, markers:active.markers })
    } else setMarquee(selectionBounds(screenToWorld(active.start,active.camera),screenToWorld(point,active.camera)))
  }
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const active = gesture.current
    if (!active || active.pointerId !== event.pointerId) return
    // Use the release position even if the browser coalesced the final move.
    pointerMove(event)
    if (gesture.current !== active) return
    gesture.current = undefined; release(active.pointerId); event.preventDefault(); event.stopPropagation()
    setMarquee(undefined)
    if (active.blocked) return
    if (active.pan) { if (!active.started && !active.hit) session.clearSelection(); return }
    if (active.started) {
      if (active.hit) void session.moveObjects(active.selection,active.offset).finally(() => setPreview(undefined))
      else session.boxSelect(selectionBounds(screenToWorld(active.start,active.camera),screenToWorld(screenPoint(event),active.camera)),active.shift)
    } else if (active.hit) {
      if (active.shift && !session.getSnapshot().markerDraft?.isNew) session.toggleSelection(active.hit.kind,active.hit.id)
      else if (active.shift) return
      else {
        const key = active.hit.kind === 'region' ? 'regionIds' : 'markerIds'
        if (!active.previous[key].includes(active.hit.id)) session.clearSelection()
        if (active.hit.kind === 'region') session.openCard(active.hit.id); else session.openMarkerCard(active.hit.id)
      }
    } else session.clearSelection()
  }
  return { preview, marquee, cancel, pointerDown, pointerMove, pointerUp, pointerCancel: () => { cancel() } }
}
