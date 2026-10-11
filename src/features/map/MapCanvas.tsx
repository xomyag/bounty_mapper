import { useEffect, useRef, useState } from 'react'
import { Image as CanvasImage, Circle, Group, Layer, Line, Stage, Text, Path } from 'react-konva'
import type Konva from 'konva'
import type { MapImage } from '../../application/mapImageRepository'
import type { Camera, Point } from '../../domain/viewport'
import { centerOn, fitBounds, screenToWorld, zoomAt } from '../../domain/viewport'
import { labelAnchor, projectOnEdge, translateVertices } from '../../domain/region'
import type { Region } from '../../domain/region'
import { documentText } from '../../domain/richText'
import type { RegionSession, RegionState } from '../../application/regionSession'
import { decodeImage } from './prepareImage'
import { markerTypes, statusBadge, statusLabel } from '../../domain/marker'
import { markerIcons, markerScreenScale, markerInk } from './markerIcons'
import { MapContextMenu } from './MapContextMenu'

interface Props { image: MapImage; fitVersion: number; regions: RegionState; session: RegionSession; editable: boolean }
const flat = (points: Point[]) => points.flatMap((p) => [p.x, p.y])
const fill = (region: Region) => `${region.color}${Math.round(region.fillOpacity * 255).toString(16).padStart(2, '0')}`

export function MapCanvas({ image, fitVersion, regions, session, editable }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const stage = useRef<Konva.Stage>(null)
  const doubleClickTarget = useRef<{ kind: 'draft' | 'region'; index: number; regionId?: string } | undefined>(undefined)
  const draggingRegion = useRef(false)
  const draggedMarker = useRef<string | undefined>(undefined)
  const blockStagePan = useRef(false)
  const [markerHover, setMarkerHover] = useState<{ id: string; x: number; y: number }>()
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [cameraState, setCameraState] = useState<{ key: string; camera: Camera; focus?: RegionState['viewFocus'] }>()
  const [bitmap, setBitmap] = useState<{ assetId: string; image: HTMLImageElement }>()
  const [decodeError, setDecodeError] = useState('')
  const [pointer, setPointer] = useState<Point>()
  const [preview, setPreview] = useState<Region>()
  const [menu, setMenu] = useState<{ x: number; y: number; point: Point }>()
  const [hover, setHover] = useState<{ id: string; x: number; y: number }>()
  const hoverRegion = !markerHover && !regions.markerTool && !regions.draft && !regions.vertexMode && !preview && hover ? regions.regions.find((r) => r.id === hover.id) : undefined
  const hoverMarker = !regions.markerTool && !regions.draft && !regions.vertexMode && markerHover ? regions.markers.find((m) => m.id === markerHover.id) : undefined
  const hoverEntity = hoverMarker ? regions.entities.find((e) => e.id === hoverMarker.entityId) : undefined
  const hoverNotes = hoverRegion ? documentText(hoverRegion.gmNotes) : ''
  const asset = image.background?.asset
  const placement = image.background?.placement
  // Resizing the viewport (including temporary status banners) must not change
  // the camera. Fit only a new map/background or an explicit Show all action.
  const cameraKey = `${image.map?.id}:${asset?.id}:${fitVersion}`
  const bounds = placement ?? image.map?.coordinateBounds
  const fitted = bounds && size.width > 0 && size.height > 0 ? fitBounds(bounds, size) : { x: 0, y: 0, scale: 1 }
  if (size.width > 0 && size.height > 0) {
    if (cameraState?.key !== cameraKey) setCameraState({ key: cameraKey, camera: fitted, focus: regions.viewFocus })
    // Consume each explicit card-link navigation once, before painting. Later
    // saves, drags, resizing and closing the card must not repeat the focus.
    else if (cameraState.focus !== regions.viewFocus) setCameraState({ ...cameraState, focus: regions.viewFocus, camera: regions.viewFocus ? centerOn(cameraState.camera, regions.viewFocus.point, size) : cameraState.camera })
  }
  const camera = cameraState?.key === cameraKey ? cameraState.camera : fitted
  const setCamera = (change: (current: Camera) => Camera) => {
    setCameraState((current) => ({ key: cameraKey, camera: change(current?.key === cameraKey ? current.camera : fitted), focus: current?.key === cameraKey ? current.focus : regions.viewFocus }))
  }

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
    decodeImage(asset.blob).then((decoded) => {
      if (active) { setBitmap({ assetId: asset.id, image: decoded }); setDecodeError('') }
    }).catch((error: unknown) => {
      if (active) setDecodeError(error instanceof Error ? error.message : 'Не удалось отобразить изображение.')
    })
    return () => { active = false }
  }, [asset])
  const pan = (x: number, y: number) => setCamera((current) => ({ ...current, x: current.x + x, y: current.y + y }))
  const worldPointer = () => {
    const point = stage.current?.getPointerPosition()
    return point ? screenToWorld(point, camera) : undefined
  }
  const savePreview = (region: Region) => {
    setPreview(region)
    void session.change(region).finally(() => setPreview(undefined))
  }
  const focus = () => host.current?.focus({ preventScroll: true })
  return (
    <div ref={host} className={`canvas-host${regions.draft || regions.markerTool ? ' drawing' : ''}`} tabIndex={0} role="region" aria-label="Карта приключения" aria-describedby="map-controls-hint"
      onContextMenu={(event) => {
        event.preventDefault()
        if (!editable || regions.draft || regions.markerTool) return
        const rect = host.current!.getBoundingClientRect()
        const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top }
        setMenu({ x: Math.min(screen.x, Math.max(0, size.width - 196)), y: Math.min(screen.y, Math.max(0, size.height - 90)), point: screenToWorld(screen, camera) })
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
        if (!editable) return
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
        if (event.key === 'Escape') { setMenu(undefined); if (regions.draft) session.cancel(); else if (regions.markerTool) session.cancelMarkerTool(); else if (regions.cardId || regions.markerCardId) session.closeCard(); else session.select() }
        else if (event.key === 'Enter' && regions.draft && editable) void session.finish()
        else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && editable) { if (event.shiftKey) void session.redo(); else void session.undo() }
        else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y' && editable) void session.redo()
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
        <Stage ref={stage} width={size.width} height={size.height} x={camera.x} y={camera.y} scaleX={camera.scale} scaleY={camera.scale} draggable={!regions.draft && !regions.markerTool && !preview}
          onMouseDown={() => { focus(); setMenu(undefined) }}
          onMouseMove={() => { if (regions.draft) setPointer(worldPointer()) }}
          onClick={(event) => {
            if (event.evt.button !== 0) return
            if (regions.markerTool && editable) { const point = worldPointer(); if (point) session.placeMarker(point) }
            else if (regions.draft && editable) { const point = worldPointer(); if (point && event.evt.detail !== 2) session.addPoint(point) }
            else if (event.target === stage.current) session.select()
          }}
          onTap={() => { if (regions.markerTool && editable) { const point = worldPointer(); if (point) session.placeMarker(point) } }}
          onDragStart={(event) => { if (event.target === stage.current && blockStagePan.current) { event.target.stopDrag(); event.target.position({ x: camera.x, y: camera.y }) } }}
          onDragMove={(event) => {
            if (event.target === stage.current) setCamera((current) => ({ ...current, x: event.target.x(), y: event.target.y() }))
          }}
          onWheel={(event) => {
            event.evt.preventDefault()
            const pointer = event.target.getStage()?.getPointerPosition()
            if (!pointer) return
            const delta = event.evt.deltaY * (event.evt.deltaMode === 1 ? 16 : event.evt.deltaMode === 2 ? size.height : 1)
            setCamera((current) => zoomAt(current, pointer, current.scale * Math.exp(-Math.max(-500, Math.min(500, delta)) * 0.002)))
            if (regions.draft) setPointer(undefined)
          }}>
          <Layer>
            {placement && bitmap && bitmap.assetId === asset?.id && <CanvasImage listening={false} image={bitmap.image} x={placement.x} y={placement.y} width={placement.width} height={placement.height} rotation={placement.rotation} visible={placement.visible} />}
            {regions.regions.map((saved) => {
              const region = preview?.id === saved.id ? preview : saved
              const selected = region.id === regions.selectedId
              const vertices = selected && regions.vertexMode && !regions.draft
              const anchor = labelAnchor(region.vertices)
              return <Group key={region.id} draggable={editable && !regions.markerTool && !regions.draft && !regions.vertexMode}
                onMouseDown={(event) => { if (!regions.draft && !regions.vertexMode && !regions.markerTool) { event.cancelBubble = true; focus() } }}
                onClick={(event) => { if (!regions.draft && !regions.markerTool) { event.cancelBubble = true; if (event.evt.button === 0 && !regions.vertexMode) { setHover(undefined); session.openCard(region.id) } } }}
                onTap={(event) => { if (!regions.markerTool) { event.cancelBubble = true; if (!regions.draft && !regions.vertexMode) { setHover(undefined); session.openCard(region.id) } } }}
                onMouseMove={() => { const p = stage.current?.getPointerPosition(); if (p && !draggingRegion.current) setHover({ id: region.id, x: Math.max(8, Math.min(p.x + 16, size.width - 320)), y: Math.max(8, Math.min(p.y + 16, size.height - 180)) }) }}
                onMouseLeave={() => setHover(undefined)}
                onDragStart={(event) => { event.cancelBubble = true; draggingRegion.current = true; setHover(undefined); session.select(region.id) }}
                onDragMove={(event) => { event.cancelBubble = true }}
                onDragEnd={(event) => {
                  event.cancelBubble = true
                  draggingRegion.current = false
                  const offset = { x: event.target.x(), y: event.target.y() }
                  event.target.position({ x: 0, y: 0 })
                  savePreview({ ...saved, vertices: translateVertices(saved.vertices, offset) })
                }}>
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
              const active = marker.id === regions.selectedMarkerId
              const isNew = !!regions.markerDraft?.isNew && regions.markerDraft.marker.id === marker.id
              const locked = isNew ? regions.markerDraft!.fields.locked : marker.locked
              const canDrag = isNew ? session.canMoveMarkerDraft(marker.id) : editable && !locked
              return <Group key={marker.id} name="map-marker" x={marker.x} y={marker.y} scaleX={scale} scaleY={scale} draggable={canDrag && !regions.draft && !regions.markerTool && !regions.vertexMode} listening={!regions.draft && !regions.markerTool && !regions.vertexMode}
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
          </Layer>
        </Stage>
      )}
      {asset && bitmap?.assetId !== asset.id && !decodeError && <p className="map-overlay" role="status">Подготовка изображения…</p>}
      {decodeError && <p className="map-overlay form-error" role="alert">{decodeError}</p>}
      {menu && <MapContextMenu position={menu} size={size} disabled={!editable} onClose={() => setMenu(undefined)} onRegion={() => { session.start(menu.point); setMenu(undefined); focus() }} onMarker={(kind) => { session.startMarker(kind); session.placeMarker(menu.point); setMenu(undefined); focus() }} />}
      {hoverRegion && hover && hoverNotes && <aside className="region-hover" role="tooltip" style={{ left: hover.x, top: hover.y }}><strong>{hoverRegion.number}. {hoverRegion.title}</strong><p>{hoverNotes.length > 450 ? `${hoverNotes.slice(0, 450)}…` : hoverNotes}</p><small>Полный текст — в карточке по клику</small></aside>}
      {hoverEntity && markerHover && <aside className="region-hover" role="tooltip" style={{ left: markerHover.x, top: markerHover.y }}><strong>{hoverEntity.name}</strong><p>{markerTypes[hoverEntity.kind].label} · {statusBadge(hoverEntity.status)} {statusLabel(hoverEntity)}{hoverMarker?.locked ? ' · Закреплён' : ''}</p></aside>}
      <p id="map-controls-hint" className="map-hint">{regions.markerTool ? 'Клик или тап — положение маркера · Esc — отмена' : regions.draft ? 'Клик — вершина · Ручки — перемещение · Двойной клик по ручке — удалить · Enter / двойной клик по фону — готово · Esc — отмена' : regions.vertexMode ? 'Перетащите вершину · Клик по ребру — добавить · Двойной клик по ручке / Delete — удалить' : 'Фон — перемещение вида · Колесо — масштаб · Ctrl+Z / Ctrl+Shift+Z — отмена / повтор'}</p>
    </div>
  )
}
