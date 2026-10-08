import { useEffect, useRef, useState } from 'react'
import { Image as CanvasImage, Layer, Stage } from 'react-konva'
import type Konva from 'konva'
import type { MapImage } from '../../application/mapImageRepository'
import type { Camera } from '../../domain/viewport'
import { fitBounds, zoomAt } from '../../domain/viewport'
import { decodeImage } from './prepareImage'

interface Props { image: MapImage; fitVersion: number }

export function MapCanvas({ image, fitVersion }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const stage = useRef<Konva.Stage>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [cameraState, setCameraState] = useState<{ key: string; camera: Camera }>()
  const [bitmap, setBitmap] = useState<{ assetId: string; image: HTMLImageElement }>()
  const [decodeError, setDecodeError] = useState('')
  const asset = image.background?.asset
  const placement = image.background?.placement
  const cameraKey = `${asset?.id}:${size.width}:${size.height}:${fitVersion}`
  const fitted = placement && size.width > 0 && size.height > 0 ? fitBounds(placement, size) : { x: 0, y: 0, scale: 1 }
  const camera = cameraState?.key === cameraKey ? cameraState.camera : fitted
  const setCamera = (change: (current: Camera) => Camera) => {
    setCameraState((current) => ({ key: cameraKey, camera: change(current?.key === cameraKey ? current.camera : fitted) }))
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
  return (
    <div ref={host} className="canvas-host" tabIndex={0} role="region" aria-label="Карта приключения" aria-describedby="map-controls-hint"
      onKeyDown={(event) => {
        if (!placement) return
        if (event.key === 'ArrowLeft') pan(40, 0)
        else if (event.key === 'ArrowRight') pan(-40, 0)
        else if (event.key === 'ArrowUp') pan(0, 40)
        else if (event.key === 'ArrowDown') pan(0, -40)
        else if (['+', '=', '-'].includes(event.key)) setCamera((current) => zoomAt(current, { x: size.width / 2, y: size.height / 2 }, current.scale * (event.key === '-' ? 1 / 1.2 : 1.2)))
        else return
        event.preventDefault()
      }}>
      {size.width > 0 && size.height > 0 && (
        <Stage ref={stage} width={size.width} height={size.height} x={camera.x} y={camera.y} scaleX={camera.scale} scaleY={camera.scale} draggable={!!placement}
          onDragMove={(event) => {
            if (event.target === stage.current) setCamera((current) => ({ ...current, x: event.target.x(), y: event.target.y() }))
          }}
          onWheel={(event) => {
            event.evt.preventDefault()
            if (!placement) return
            const pointer = event.target.getStage()?.getPointerPosition()
            if (!pointer) return
            const delta = event.evt.deltaY * (event.evt.deltaMode === 1 ? 16 : event.evt.deltaMode === 2 ? size.height : 1)
            setCamera((current) => zoomAt(current, pointer, current.scale * Math.exp(-Math.max(-500, Math.min(500, delta)) * 0.002)))
          }}>
          <Layer>
            {placement && bitmap && bitmap.assetId === asset?.id && <CanvasImage image={bitmap.image} x={placement.x} y={placement.y} width={placement.width} height={placement.height} rotation={placement.rotation} visible={placement.visible} />}
          </Layer>
        </Stage>
      )}
      {asset && bitmap?.assetId !== asset.id && !decodeError && <p className="map-overlay" role="status">Подготовка изображения…</p>}
      {decodeError && <p className="map-overlay form-error" role="alert">{decodeError}</p>}
      {placement && <p id="map-controls-hint" className="map-hint">Перетаскивание — перемещение вида · Колесо — масштаб · Стрелки и +/− — с клавиатуры</p>}
    </div>
  )
}
