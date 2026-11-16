import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { animate, useMotionValue } from 'motion/react'

/** Порог переключения: смещение >= 25% ширины кадра. */
export const SWIPE_THRESHOLD_RATIO = 0.25
/** Инерционный флик: скорость в px/ms за последнее окно. */
export const FLING_VELOCITY = 0.4
/** Пикселей нужно, чтобы понять, по какой оси пошёл свайп. */
const AXIS_LOCK_PX = 8
/** Резистивность на краях: движение «за границу» списка гасится до 30%. */
const EDGE_RESISTANCE = 0.3
/** Окно, по которому считается скорость отпускания. */
const VELOCITY_WINDOW_MS = 100

const SNAP_SPRING = { type: 'spring', stiffness: 260, damping: 32, mass: 0.9 } as const

interface Sample {
  t: number
  x: number
}

interface DragState {
  pointerId: number
  startX: number
  startY: number
  baseX: number
  axis: 'x' | 'y' | null
  samples: Sample[]
}

interface CarouselDragOptions {
  count: number
  index: number
  /** Ставит целевой кадр; компонент решает, листается ли с wrap (стрелки) — drag сам не заворачивает. */
  onIndexChange: (index: number) => void
  reducedMotion: boolean
  containerRef: RefObject<HTMLElement | null>
}

/**
 * Свайп по дорожке карусели через Pointer Events + пружинный snap через motion.
 *
 * Почему свои обработчики, а `drag` у motion.div: тесты должны дёргать жестом
 * через fireEvent.pointerDown/Move/Up предсказуемо; motion-drag навешивает
 * нативные слушатели и зависит от setPointerCapture, которого в jsdom нет.
 *
 * Поведение:
 *  - ось блокируется на первом движении (|dx| >= |dy| → горизонталь, иначе —
 *    вертикаль отдаётся браузеру: touch-action: pan-y не мешает скроллу);
 *  - смещение >= SWIPE_THRESHOLD_RATIO * ширины кадра ИЛИ скорость >=
 *    FLING_VELOCITY px/ms → ближайший кадр (без wrap: на краях — назад);
 *  - на краях движение гасится EDGE_RESISTANCE (резистивность);
 *  - после отпускания snap пружиной; при prefers-reduced-motion — мгновенно.
 */
export function useCarouselDrag({
  count,
  index,
  onIndexChange,
  reducedMotion,
  containerRef,
}: CarouselDragOptions) {
  const x = useMotionValue(0)
  const controls = useRef<ReturnType<typeof animate> | null>(null)
  const dragging = useRef(false)
  const moved = useRef(false)
  const drag = useRef<DragState | null>(null)
  const indexRef = useRef(index)
  indexRef.current = index

  // jsdom не отдаёт реальные размеры (clientWidth === 0) — fallback на вьюпорт.
  const frameWidth = useCallback(
    () => containerRef.current?.clientWidth || window.innerWidth || 1,
    [containerRef],
  )

  const stop = useCallback(() => {
    controls.current?.stop()
    controls.current = null
  }, [])

  const glideTo = useCallback(
    (target: number) => {
      stop()
      if (reducedMotion) {
        x.set(target)
        return
      }
      controls.current = animate(x, target, SNAP_SPRING)
    },
    [reducedMotion, stop, x],
  )

  // Смена кадра стрелками/точками/автослайдом — доезжаем до него пружиной.
  useEffect(() => {
    glideTo(-index * frameWidth())
  }, [index, glideTo, frameWidth])

  // Ресайз: пересчитать кадр без анимации.
  useEffect(() => {
    function onResize() {
      stop()
      x.set(-indexRef.current * frameWidth())
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [frameWidth, stop, x])

  useEffect(() => stop, [stop])

  function velocity(samples: Sample[], event: ReactPointerEvent<HTMLElement>): number {
    if (samples.length === 0) return 0
    const t = event.timeStamp || performance.now()
    // Самая ранняя точка, ещё попадающая в окно скорости.
    const first = samples.find((s) => t - s.t <= VELOCITY_WINDOW_MS) ?? samples[samples.length - 1]
    const dt = Math.max(1, t - first.t)
    return (event.clientX - first.x) / dt
  }

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (count <= 1 || drag.current) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    stop()
    dragging.current = true
    moved.current = false
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: x.get(),
      axis: null,
      samples: [{ t: event.timeStamp || performance.now(), x: event.clientX }],
    }
    // setPointerCapture нужен, чтобы move/up долетали до элемента за его
    // пределами; в jsdom его нет — не критично для тестов.
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } catch {
      /* окружение без capture — двиг по события документа всё равно дойдёт */
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const d = drag.current
    if (!d || !dragging.current) return
    const dx = event.clientX - d.startX
    if (!d.axis) {
      const dy = event.clientY - d.startY
      if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_LOCK_PX) return
      if (Math.abs(dx) < Math.abs(dy)) {
        // Вертикаль — не наша: отдаём браузеру (скролл страницы).
        drag.current = null
        dragging.current = false
        return
      }
      d.axis = 'x'
      moved.current = true
    }
    let off = dx
    const atStart = index === 0
    const atEnd = index === count - 1
    if ((off > 0 && atStart) || (off < 0 && atEnd)) off *= EDGE_RESISTANCE
    x.set(d.baseX + off)
    const t = event.timeStamp || performance.now()
    d.samples.push({ t, x: event.clientX })
    while (d.samples.length > 2 && t - d.samples[0].t > VELOCITY_WINDOW_MS) d.samples.shift()
  }

  function endDrag(event: ReactPointerEvent<HTMLElement>) {
    const d = drag.current
    drag.current = null
    dragging.current = false
    if (!d || d.axis !== 'x') return
    const w = frameWidth()
    const off = x.get() - d.baseX
    const v = velocity(d.samples, event)
    let target = index
    if (off <= -w * SWIPE_THRESHOLD_RATIO || v <= -FLING_VELOCITY) target = Math.min(count - 1, index + 1)
    else if (off >= w * SWIPE_THRESHOLD_RATIO || v >= FLING_VELOCITY) target = Math.max(0, index - 1)
    if (target !== index) onIndexChange(target)
    glideTo(-target * w)
  }

  function cancelDrag() {
    const d = drag.current
    drag.current = null
    dragging.current = false
    if (d) glideTo(-index * frameWidth())
  }

  const handlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: cancelDrag,
  }

  return { x, dragging, moved, handlers }
}
