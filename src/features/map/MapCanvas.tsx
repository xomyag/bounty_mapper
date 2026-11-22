import { localize, message, t } from '../../i18n'
import { useEffect, useRef, useState } from 'react'
import { Image as CanvasImage, Circle, Group, Layer, Line, Stage, Text, Path, Rect } from 'react-konva'
import type Konva from 'konva'
import type { MapImage } from '../../application/mapImageRepository'
import type { Camera, Point } from '../../domain/viewport'
import { centerOn, fitBounds, screenToWorld, zoomAt } from '../../domain/viewport'
import { labelAnchor, projectOnEdge } from '../../domain/region'
import type { Region } from '../../domain/region'
import { ObjectTooltip, TooltipTags } from './ObjectTooltip'
import type { RegionSession, RegionState } from '../../application/regionSession'
import { cachedBitmap, prepareBitmap } from './bitmapCache'
import type { ViewportMemory } from '../../application/viewportMemory'
import { markerTypes, statusBadge, statusLabel } from '../../domain/marker'
import { markerIcons, markerScreenScale, markerInk } from './markerIcons'
import { MapContextMenu } from './MapContextMenu'
import { useMapSelection } from './useMapSelection'
import { selectionSize } from '../../domain/selection'

interface Props { image: MapImage; fitVersion: number; zoomCommand?: { version: number; factor: number }; regionDragAllowed: boolean; regions: RegionState; session: RegionSession; editable: boolean; viewports: ViewportMemory }
const flat = (points: Point[]) => points.flatMap((p) => [p.x, p.y])
const fill = (region: Region) => `${region.color}${Math.round(region.fillOpacity * 255).toString(16).padStart(2, '0')}`

export function MapCanvas({ image, fitVersion, zoomCommand, regionDragAllowed, regions, session, editable: editingAllowed, viewports }: Props) {
  const playing = regions.mode === 'play'
  const readOnly = playing || !session.canEditProject()
  const editable = editingAllowed && session.isPreparation()
  const alignment = regions.imageAlignment
  const alignmentDrag = useRef<{ pointer: Point; origin: Point } | undefined>(undefined)
  const host = useRef<HTMLDivElement>(null)
  const stage = useRef<Konva.Stage>(null)
  const doubleClickTarget = useRef<{ kind: 'draft' | 'region'; index: number; regionId?: string } | undefined>(undefined)
  const draggedMarker = useRef<string | undefined>(undefined)
  const blockStagePan = useRef(false)
  const suppressClick = useRef(false)
  const consumedZoom = useRef(zoomCommand?.version)
  const [markerHover, setMarkerHover] = useState<{ id: string; x: number; y: number }>()
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [cameraState, setCameraState] = useState<{ key: string; mapId?: string; camera: Camera; focus?: RegionState['viewFocus'] }>()
  const [bitmap, setBitmap] = useState<{ assetId: string; image: HTMLImageElement }>()
  const [decodeError, setDecodeError] = useState('')
  const [pointer, setPointer] = useState<Point>()
  const [preview, setPreview] = useState<Region>()
  const [menu, setMenu] = useState<{ x: number; y: number; point: Point; markerId?: string }>()
  const [hover, setHover] = useState<{ id: string; x: number; y: number }>()
  const hoverRegion = !markerHover && !regions.markerTool && !regions.draft && !regions.vertexMode && !preview && hover ? regions.regions.find((r) => r.id === hover.id) : undefined
  const hoverMarker = !regions.markerTool && !regions.draft && !regions.vertexMode && markerHover ? regions.markers.find((m) => m.id === markerHover.id) : undefined
  const hoverEntity = !alignment && hoverMarker ? regions.entities.find((e) => e.id === hoverMarker.entityId) : undefined
  const asset = image.background?.asset
  const savedPlacement = image.background?.placement
  const placement = savedPlacement && alignment ? { ...savedPlacement, x: alignment.x, y: alignment.y } : savedPlacement
  const mapId = image.map?.id
  const visibleBitmap = cachedBitmap(asset?.id) ?? (bitmap?.assetId === asset?.id ? bitmap?.image : undefined)
  // Resizing the viewport (including temporary status banners) must not change
  // the camera. Replacing/removing the background, including a write retry,
  // preserves the map camera. Fit only a new map or an explicit Show all action.
  const cameraKey = `${image.map?.id}:${fitVersion}`
  const bounds = placement ?? image.map?.coordinateBounds
  const fitted = bounds && size.width > 0 && size.height > 0 ? fitBounds(bounds, size) : { x: 0, y: 0, scale: 1 }
  if (size.width > 0 && size.height > 0) {
    if (cameraState?.key !== cameraKey) {
      const restored = mapId && cameraState?.mapId !== mapId ? viewports.get(mapId) ?? fitted : fitted
      const next = regions.mapId === mapId && regions.viewFocus && cameraState?.focus !== regions.viewFocus ? centerOn(restored, regions.viewFocus.point, size) : restored
      setCameraState({ key: cameraKey, mapId, camera: next, focus: regions.viewFocus })
    }
    // Consume each explicit card-link navigation once, before painting. Later
    // saves, drags, resizing and closing the card must not repeat the focus.
    else if (cameraState.focus !== regions.viewFocus) setCameraState({ ...cameraState, focus: regions.viewFocus, camera: regions.viewFocus ? centerOn(cameraState.camera, regions.viewFocus.point, size) : cameraState.camera })
  }
  const camera = cameraState?.key === cameraKey ? cameraState.camera : fitted
  if (mapId && size.width > 0 && size.height > 0 && cameraState?.key === cameraKey) viewports.set(mapId, camera)
  const setCamera = (change: (current: Camera) => Camera) => {
    setCameraState((current) => ({ key: cameraKey, mapId, camera: change(current?.key === cameraKey ? current.camera : fitted), focus: current?.key === cameraKey ? current.focus : regions.viewFocus }))
  }
  const interaction = useMapSelection({ host, stage, camera, session, enabled: regionDragAllowed, setCamera })
  const movePreview = interaction.preview?.mapId === mapId ? interaction.preview : undefined

  useEffect(() => {
    const node = host.current!
    const measure = () => {
      const rect = node.getBoundingClientRect()
      setSize({ width: Math.max(0, rect.width), height: Math.max(0, rect.height) })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!asset) return
    let active = true
    prepareBitmap(asset).then((decoded) => {
      if (active) { setBitmap({ assetId: asset.id, image: decoded }); setDecodeError('') }
    }).catch((error: unknown) => {
      if (active) setDecodeError(error instanceof Error ? error.message : message("ui.could.not.display.the.image"))
    })
    return () => { active = false }
  }, [asset])
  const pan = (x: number, y: number) => setCamera((current) => ({ ...current, x: current.x + x, y: current.y + y }))
  const worldPointer = () => {
    const point = stage.current?.getPointerPosition()
    return point ? screenToWorld(point, camera) : undefined
  }
  const beginAlignmentDrag = () => {
    const point = worldPointer()
    if (alignment && !alignment.pan && point && !session.detailsSaving()) alignmentDrag.current = { pointer: point, origin: { x: alignment.x, y: alignment.y } }
  }
  const moveAlignmentDrag = () => {
    const drag = alignmentDrag.current; const point = worldPointer()
    if (drag && point && alignment && !alignment.pan) session.moveImageAlignment({ x: drag.origin.x + point.x - drag.pointer.x, y: drag.origin.y + point.y - drag.pointer.y })
  }
  const savePreview = (region: Region) => {
    setPreview(region)
    void session.change(region).finally(() => setPreview(undefined))
  }
  const focus = () => host.current?.focus({ preventScroll: true })
  const stopClick = () => { suppressClick.current = true; requestAnimationFrame(() => { suppressClick.current = false }) }
  useEffect(() => {
    if (!zoomCommand || consumedZoom.current === zoomCommand.version) return
    consumedZoom.current = zoomCommand.version
    interaction.cancel()
    setCamera((current) => zoomAt(current, { x: size.width / 2, y: size.height / 2 }, current.scale * zoomCommand.factor))
  })
  useEffect(() => {
    let previous = session.getSnapshot().mode
    return session.subscribe(() => {
      const mode = session.getSnapshot().mode
      if (mode === 'play' && previous !== mode) {
        stage.current?.find((node: Konva.Node) => node.isDragging()).forEach((node) => node.stopDrag())
        setMenu(undefined); setPreview(undefined); setPointer(undefined); draggedMarker.current = undefined; doubleClickTarget.current = undefined; blockStagePan.current = false
      }
      previous = mode
    })
  }, [session])
  return (
    <div ref={host} data-map-canvas data-map-id={mapId} className={`canvas-host${regions.draft || regions.markerTool ? ' drawing' : ''}${!playing && !alignment && !regions.draft && !regions.markerTool && !regions.vertexMode ? ' selecting' : ''}`} tabIndex={0} role="region" aria-label={t("ui.adventure.map")} aria-describedby="map-controls-hint"
      onPointerDownCapture={interaction.pointerDown} onPointerMoveCapture={interaction.pointerMove} onPointerUpCapture={interaction.pointerUp} onPointerCancel={interaction.pointerCancel} onLostPointerCapture={interaction.pointerCancel}
      onContextMenu={(event) => {
        event.preventDefault()
        if (alignment || readOnly || session.busy() || session.detailsSaving() || regions.draft || regions.markerTool) return
        const rect = host.current!.getBoundingClientRect()
        const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top }
        const markerId = stage.current?.getIntersection(screen)?.findAncestor('.map-marker', true)?.getAttr('markerId') as string | undefined
        if (markerId && !regions.markers.some((m) => m.id === markerId)) return
        if (!markerId && !editable) return
        setMenu({ x: Math.min(screen.x, Math.max(0, size.width - 196)), y: Math.min(screen.y, Math.max(0, size.height - 90)), point: screenToWorld(screen, camera), markerId })
        focus()
      }}
      onMouseDownCapture={(event) => {
        // Remember the first click's target before a background click creates a new handle.
        // This keeps double-click completion distinct from double-click handle deletion.
        const rect = host.current!.getBoundingClientRect()
        const hit = stage.current?.getIntersection({ x: event.clientX - rect.left, y: event.clientY - rect.top })
        blockStagePan.current = !!hit?.findAncestor('.map-marker', true)
        if (event.button !== 0 || event.detail !== 1) return
        doubleClickTarget.current = hit?.name() === 'draft-vertex' ? { kind: 'draft', index: hit.getAttr('vertexIndex') as number } :
          hit?.name() === 'region-vertex' ? { kind: 'region', index: hit.getAttr('vertexIndex') as number, regionId: hit.getAttr('regionId') as string } : undefined
      }}
      onTouchStartCapture={(event) => {
        const touch = event.touches[0]
        if (!touch) return
        const rect = host.current!.getBoundingClientRect()
        blockStagePan.current = !!stage.current?.getIntersection({ x: touch.clientX - rect.left, y: touch.clientY - rect.top })?.findAncestor('.map-marker', true)
      }}
      onDoubleClick={(event) => {
        if (!editable || alignment) return
        event.preventDefault()
        const target = doubleClickTarget.current
        doubleClickTarget.current = undefined
        if (regions.draft) {
          if (target?.kind === 'draft') session.removeDraftVertex(target.index)
          else void session.finish()
        } else if (target?.kind === 'region' && regions.vertexMode && target.regionId === regions.selectedId) void session.removeVertex(target.index)
      }}
      onKeyDown={(event) => {
        if (event.target !== host.current) return
        if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-'].includes(event.key)) interaction.cancel()
        if (alignment && !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-'].includes(event.key)) { if (event.key === 'Escape') session.afterDetails(async () => {}); event.preventDefault(); return }
        if (event.key === 'Escape') { setMenu(undefined); if (regions.draft) session.cancel(); else if (regions.markerTool) session.cancelMarkerTool(); else if (selectionSize(regions.selection)) session.clearSelection(); else if (regions.cardId || regions.markerCardId) session.closeCard(); else session.select() }
        else if (event.key === 'Enter' && regions.draft && editable) void session.finish()
        else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && playing) { if (event.shiftKey) void session.redoStatus(); else void session.undoStatus() }
        else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y' && playing) void session.redoStatus()
        else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && editable) { if (event.shiftKey) void session.redo(); else void session.undo() }
        else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y' && editable) void session.redo()
        else if (event.key === 'Delete' && selectionSize(regions.selection)) { event.preventDefault(); return }
        else if (event.key === 'Delete' && editable && regions.selectedMarkerId) void session.removeMarker()
        else if (event.key === 'Delete' && editable && regions.selectedId) { if (regions.vertexMode) void session.removeVertex(); else void session.remove() }
        else if (event.key === 'ArrowLeft') pan(40, 0)
        else if (event.key === 'ArrowRight') pan(-40, 0)
        else if (event.key === 'ArrowUp') pan(0, 40)
        else if (event.key === 'ArrowDown') pan(0, -40)
        else if (['+', '=', '-'].includes(event.key)) setCamera((current) => zoomAt(current, { x: size.width / 2, y: size.height / 2 }, current.scale * (event.key === '-' ? 1 / 1.2 : 1.2)))
        else return
        event.preventDefault()
      }}>
      {size.width > 0 && size.height > 0 && (
        <Stage ref={stage} width={size.width} height={size.height} x={camera.x} y={camera.y} scaleX={camera.scale} scaleY={camera.scale} draggable={alignment ? alignment.pan && !session.detailsSaving() : playing && !preview}
          onMouseDown={(event) => { focus(); setMenu(undefined); if (event.evt.button === 0) beginAlignmentDrag() }}
          onMouseMove={() => { moveAlignmentDrag(); if (regions.draft) setPointer(worldPointer()) }}
          onMouseUp={() => { alignmentDrag.current = undefined }} onMouseLeave={() => { alignmentDrag.current = undefined }}
          onTouchStart={beginAlignmentDrag} onTouchMove={moveAlignmentDrag} onTouchEnd={() => { alignmentDrag.current = undefined }}
          onClick={(event) => {
            if (event.evt.button !== 0 || alignment) return
            if (regions.markerTool && editable) { const point = worldPointer(); if (point) session.placeMarker(point) }
            else if (regions.draft && editable) { const point = worldPointer(); if (point && event.evt.detail !== 2) session.addPoint(point) }
            else if (event.target === stage.current) session.select()
          }}
          onTap={() => { if (!alignment && regions.markerTool && editable) { const point = worldPointer(); if (point) session.placeMarker(point) } }}
          onDragStart={(event) => { if (event.target === stage.current) { suppressClick.current = true; if (blockStagePan.current) { event.target.stopDrag(); event.target.position({ x: camera.x, y: camera.y }) } } }}
          onDragEnd={(event) => { if (event.target === stage.current) stopClick() }}
          onDragMove={(event) => {
            if (event.target === stage.current) setCamera((current) => ({ ...current, x: event.target.x(), y: event.target.y() }))
          }}
          onWheel={(event) => {
            interaction.cancel()
            alignmentDrag.current = undefined
            event.evt.preventDefault()
            const pointer = event.target.getStage()?.getPointerPosition()
            if (!pointer) return
            const delta = event.evt.deltaY * (event.evt.deltaMode === 1 ? 16 : event.evt.deltaMode === 2 ? size.height : 1)
            setCamera((current) => zoomAt(current, pointer, current.scale * Math.exp(-Math.max(-500, Math.min(500, delta)) * 0.002)))
            if (regions.draft) setPointer(undefined)
          }}>
          <Layer>
            {placement && visibleBitmap && <CanvasImage listening={false} image={visibleBitmap} x={placement.x} y={placement.y} width={placement.width} height={placement.height} rotation={placement.rotation} visible={placement.visible} />}
            {regions.regions.map((saved) => {
              const moved = movePreview?.selection.regionIds.includes(saved.id) ? movePreview : undefined
              const base = moved ? moved.regions.find((r) => r.id === saved.id)! : saved
              const displayed = { ...base, vertices: moved ? base.vertices : regions.details[saved.id]?.fields.vertices ?? saved.vertices }
              const region = !readOnly && preview?.id === saved.id ? preview : displayed
              const selected = region.id === regions.selectedId || regions.selection.regionIds.includes(region.id)
              const vertices = !readOnly && selected && regions.vertexMode && !regions.draft
              const anchor = labelAnchor(region.vertices)
              return <Group key={region.id} name="map-region" regionId={region.id} listening={!alignment} _useStrictMode x={moved ? moved.offset.x : 0} y={moved ? moved.offset.y : 0}
                onMouseDown={() => { focus() }}
                onClick={(event) => { if (!regions.draft && !regions.markerTool) { event.cancelBubble = true; if (!suppressClick.current && event.evt.button === 0 && !regions.vertexMode) { setHover(undefined); session.openCard(region.id) } } }}
                onTap={(event) => { if (!regions.markerTool) { event.cancelBubble = true; if (!suppressClick.current && !regions.draft && !regions.vertexMode) { setHover(undefined); session.openCard(region.id) } } }}
                onMouseMove={() => { const p = stage.current?.getPointerPosition(); if (p && !movePreview) setHover({ id: region.id, x: Math.max(8, Math.min(p.x + 16, size.width - 320)), y: Math.max(8, Math.min(p.y + 16, size.height - 180)) }) }}
                onMouseLeave={() => setHover(undefined)}
                >
                <Line points={flat(region.vertices)} closed fill={fill(region)} stroke={selected ? '#fff5cb' : region.color} strokeWidth={selected ? 3 : 1.5} strokeScaleEnabled={false} listening={!regions.draft} />
                {selected && <Line points={flat(region.vertices)} closed stroke="#1a1e29" strokeWidth={1} strokeScaleEnabled={false} dash={[5 / camera.scale, 4 / camera.scale]} listening={false} />}
                <Text x={anchor.x - 90 / camera.scale} y={anchor.y - 9 / camera.scale} width={180 / camera.scale} align="center" fontSize={14 / camera.scale} fontStyle="bold" text={`${region.number}. ${region.title}`} fill="#ffffff" shadowColor="#000000" shadowBlur={3} shadowOpacity={1} listening={false} />
                {vertices && region.vertices.map((point, index) => {
                  const next = region.vertices[(index + 1) % region.vertices.length]
                  return <Line key={`edge-${index}`} points={flat([point, next])} stroke="#fff5cb" strokeWidth={1 / camera.scale} hitStrokeWidth={14 / camera.scale}
                    onMouseDown={(event) => { event.cancelBubble = true }}
                    onClick={(event) => {
                      event.cancelBubble = true
                      if (!editable || event.evt.button !== 0) return
                      const pointer = worldPointer()
                      if (!pointer) return
                      const inserted = projectOnEdge(pointer, point, next)
                      void session.change({ ...saved, vertices: [...saved.vertices.slice(0, index + 1), inserted, ...saved.vertices.slice(index + 1)] })
                    }} />
                })}
                {vertices && region.vertices.map((point, index) => <Circle key={`vertex-${index}`} name="region-vertex" vertexIndex={index} regionId={region.id} _useStrictMode x={point.x} y={point.y} radius={6 / camera.scale} fill={regions.selectedVertex === index ? '#eaa746' : '#ffffff'} stroke="#1a1e29" strokeWidth={2 / camera.scale} draggable={editable}
                  onMouseDown={(event) => { event.cancelBubble = true; focus(); session.selectVertex(index) }}
                  onClick={(event) => { event.cancelBubble = true; session.selectVertex(index) }}
                  onDragStart={(event) => { event.cancelBubble = true; session.selectVertex(index) }}
                  onDragMove={(event) => {
                    event.cancelBubble = true
                    const moved = { x: event.target.x(), y: event.target.y() }
                    setPreview({ ...saved, vertices: saved.vertices.map((p, i) => i === index ? moved : p) })
                  }}
                  onDragEnd={(event) => {
                    event.cancelBubble = true
                    const moved = { x: event.target.x(), y: event.target.y() }
                    savePreview({ ...saved, vertices: saved.vertices.map((p, i) => i === index ? moved : p) })
                  }} />)}
              </Group>
            })}
            {[...regions.markers, ...(regions.markerDraft?.isNew ? [regions.markerDraft.marker] : [])].map((marker) => {
              const entity = regions.entities.find((e) => e.id === marker.entityId) ?? regions.markerDraft?.entity
              if (!entity) return null
              const scale = markerScreenScale(camera.scale)
              const active = marker.id === regions.selectedMarkerId || regions.selection.markerIds.includes(marker.id)
              const isNew = !!regions.markerDraft?.isNew && regions.markerDraft.marker.id === marker.id
              const locked = isNew ? regions.markerDraft!.fields.locked : marker.locked
              const canDrag = isNew && session.canMoveMarkerDraft(marker.id)
              const moved = movePreview?.selection.markerIds.includes(marker.id) ? movePreview : undefined
              const base = moved ? moved.markers.find((m) => m.id === marker.id)! : marker
              return <Group key={marker.id} name="map-marker" markerId={marker.id} _useStrictMode={!isNew || readOnly} x={base.x+(moved ? moved.offset.x : 0)} y={base.y+(moved ? moved.offset.y : 0)} scaleX={scale} scaleY={scale} dragDistance={5} draggable={!alignment && canDrag && !regions.draft && !regions.markerTool && !regions.vertexMode} listening={!alignment && !regions.draft && !regions.markerTool && !regions.vertexMode}
                onMouseDown={(event) => { event.cancelBubble = true; focus() }}
                onClick={(event) => { event.cancelBubble = true; if (event.evt.button === 0 && draggedMarker.current !== marker.id) { setMarkerHover(undefined); setHover(undefined); session.openMarkerCard(marker.id) } }}
                onTap={(event) => { event.cancelBubble = true; if (draggedMarker.current !== marker.id) { setMarkerHover(undefined); setHover(undefined); session.openMarkerCard(marker.id) } }}
                onMouseMove={(event) => { event.cancelBubble = true; const p = stage.current?.getPointerPosition(); if (p && !draggedMarker.current) { setHover(undefined); setMarkerHover({ id: marker.id, x: Math.max(8, Math.min(p.x + 20, size.width - 320)), y: Math.max(8, Math.min(p.y + 20, size.height - 140)) }) } }}
                onMouseLeave={() => setMarkerHover(undefined)}
                onDragStart={(event) => { event.cancelBubble = true; draggedMarker.current = marker.id; setMarkerHover(undefined); setHover(undefined); session.selectMarker(marker.id) }}
                onDragMove={(event) => { event.cancelBubble = true }}
                onDragEnd={(event) => { event.cancelBubble = true; const point = { x: event.target.x(), y: event.target.y() }; event.target.position({ x: marker.x, y: marker.y }); if (isNew) session.moveMarkerDraft(marker.id, point); else void session.moveMarker(marker.id, point); requestAnimationFrame(() => { draggedMarker.current = undefined }) }}>
                <Circle radius={20} fill={marker.color} stroke={active ? '#fff5cb' : '#11161b'} strokeWidth={active ? 3 : 2} />
                <Path x={-12} y={-12} data={markerIcons[entity.kind]} stroke={markerInk(marker.color)} strokeWidth={1.8} lineCap="round" lineJoin="round" listening={false} />
                <Circle x={15} y={15} radius={8} fill="#11161b" stroke="#fff5cb" strokeWidth={1} listening={false} />
                <Text x={7} y={8} width={16} align="center" text={statusBadge(entity.status)} fontSize={13} fontStyle="bold" fill="#fff5cb" listening={false} />
                {locked && <Text x={10} y={-25} text="▣" fontSize={11} fill="#fff5cb" stroke="#11161b" strokeWidth={.5} listening={false} />}
              </Group>
            })}
            {regions.draft && <>
              <Line points={flat(regions.draft)} stroke="#fff5cb" strokeWidth={2} strokeScaleEnabled={false} listening={false} />
              {regions.draft.length > 0 && pointer && <Line points={flat([regions.draft.at(-1)!, pointer, regions.draft[0]])} stroke="#fff5cb" strokeWidth={1} strokeScaleEnabled={false} dash={[6 / camera.scale, 4 / camera.scale]} listening={false} />}
              {regions.draft.map((point, index) => <Circle key={index} name="draft-vertex" vertexIndex={index} _useStrictMode x={point.x} y={point.y} radius={6 / camera.scale} fill="#fff5cb" stroke="#1a1e29" strokeWidth={2 / camera.scale} draggable={editable}
                onMouseDown={(event) => { event.cancelBubble = true; focus() }}
                onClick={(event) => { event.cancelBubble = true }}
                onDragStart={(event) => { event.cancelBubble = true; setPointer(undefined) }}
                onDragMove={(event) => {
                  event.cancelBubble = true
                  session.moveDraftVertex(index, { x: event.target.x(), y: event.target.y() })
                }}
                onDragEnd={(event) => {
                  event.cancelBubble = true
                  session.moveDraftVertex(index, { x: event.target.x(), y: event.target.y() })
                }} />)}
            </>}
            {interaction.marquee && <Rect name="selection-box" {...interaction.marquee} stroke="#fff5cb" strokeWidth={1.5/camera.scale} fill="#dfb57722" dash={[6/camera.scale,4/camera.scale]} listening={false} />}
          </Layer>
        </Stage>
      )}
      {asset && !visibleBitmap && !decodeError && <p className="map-overlay" role="status">{t("ui.preparing.image")}</p>}
      {decodeError && <p className="map-overlay form-error" role="alert">{localize(decodeError)}</p>}
      {menu && !readOnly && !alignment && <MapContextMenu position={menu} size={size} disabled={menu.markerId ? session.busy() || session.detailsSaving() : !editable} onDuplicate={menu.markerId && regions.markers.some((m) => m.id === menu.markerId) ? () => { session.duplicateMarker(menu.markerId!); setMenu(undefined) } : undefined} onClose={() => setMenu(undefined)} onRegion={() => { session.start(menu.point); setMenu(undefined); focus() }} onMarker={(kind) => { session.startMarker(kind); session.placeMarker(menu.point); setMenu(undefined); focus() }} />}
      {hoverRegion && hover && !alignment && !movePreview && !interaction.marquee && <ObjectTooltip position={hover} size={size}><strong>{hoverRegion.number}. {localize(hoverRegion.title)}</strong>{hoverRegion.shortDescription.trim() && <p className="tooltip-description">{hoverRegion.shortDescription}</p>}<TooltipTags tags={hoverRegion.tags} /></ObjectTooltip>}
      {hoverEntity && markerHover && !movePreview && !interaction.marquee && <ObjectTooltip position={markerHover} size={size}><strong>{hoverEntity.name}</strong><p>{localize(markerTypes[hoverEntity.kind].label)} · {statusBadge(hoverEntity.status)} {localize(statusLabel(hoverEntity))}{localize(hoverMarker?.locked ? message("ui.locked.695017") : '')}</p><TooltipTags tags={hoverEntity.tags} />{hoverEntity.kind === 'trap' && <div className="tooltip-checks">{hoverEntity.checks.slice(0, 3).map((c) => <p key={c.id}>{c.condition} — {c.ability}{t("ui.dc")} {c.dc}</p>)}{hoverEntity.checks.length > 3 && <small>{t('counts.moreChecks', { count: hoverEntity.checks.length - 3 })}</small>}</div>}</ObjectTooltip>}
      {!!selectionSize(regions.selection) && !readOnly && <div className="selection-tools" role="group" aria-label={t('selection.title')}><span role="status">{t('selection.count',{count:selectionSize(regions.selection)})}</span><button type="button" onClick={session.clearSelection}>{t('selection.clear')}</button></div>}
      <p id="map-controls-hint" className="map-hint">{localize(playing ? message("ui.play.geometry.locked.pan.zoom.ctrl.z.ctrl.shift") : regions.markerTool ? message("ui.click.or.tap.marker.position.esc.cancel") : regions.draft ? message("ui.click.vertex.handles.move.double.click.handle.delete.enter") : regions.vertexMode ? message("ui.drag.a.vertex.click.edge.add.double.click.handle") : message('selection.hint'))}</p>
    </div>
  )
}
