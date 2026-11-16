import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, animate, motion, useMotionValue, useTransform, type MotionValue, type Variants } from 'motion/react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { preloadNeighbours, usePrefersReducedMotion } from './media'

interface PhotoLightboxProps {
  urls: string[]
  index: number
  open: boolean
  onClose: () => void
  onIndexChange: (index: number) => void
  alt?: string
}

/* ── Пороги жестов ──────────────────────────────────────────────────────── */
/** Свайп по X: смещение >= 25% ширины сцены… */
const SWIPE_RATIO = 0.25
/** …или инерция >= 0.4 px/ms. */
const FLICK_VELOCITY = 0.4
/** Пикселей до блокировки оси жеста (x — листание, y — закрытие, pan — зум). */
const AXIS_LOCK_PX = 8
/** Движение за край списка гасится до 30% (резистивность на краях). */
const EDGE_RESISTANCE = 0.3
/** Закрытие свайпом вниз: смещение > 120 px И скорость > 0.25 px/ms. */
const CLOSE_DISTANCE_PX = 120
const CLOSE_VELOCITY = 0.25
/** Второй тап в этом окне (мс) и рядом с первым — двойной тап = зум. */
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_SLOP_PX = 40

/* ── Зум ────────────────────────────────────────────────────────────────── */
const ZOOM_SCALE = 2

/* ── Анимации: 180–220 мс на слайд, при prefers-reduced-motion — нулевые ── */
const SLIDE_MS = 0.2
const FADE_MS = 0.15
const SPRING = { type: 'spring', stiffness: 300, damping: 34 } as const
const VELOCITY_WINDOW_MS = 100

const FOCUSABLE = 'button:not([disabled])'

interface GestureSample {
  t: number
  x: number
  y: number
}

interface GestureState {
  pointerId: number
  startX: number
  startY: number
  axis: 'x' | 'y' | 'pan' | null
  moved: boolean
  panBaseX: number
  panBaseY: number
  samples: GestureSample[]
}

export function PhotoLightbox({
  urls,
  index,
  open,
  onClose,
  onIndexChange,
  alt = 'Фото',
}: PhotoLightboxProps) {
  const count = urls.length
  const reducedMotion = usePrefersReducedMotion()

  const [direction, setDirection] = useState(0)
  const [zoomed, setZoomed] = useState(false)

  const closeRef = useRef<HTMLButtonElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  // x/y — смещение сцены целиком свайпом; zx/zy — панорамирование внутри зума.
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const zx = useMotionValue(0)
  const zy = useMotionValue(0)
  // Фон плавно темнеет при протяжке вниз.
  const bgOpacity = useTransform(y, [0, 300], [1, 0.25])

  const controls = useRef(new Map<MotionValue<number>, ReturnType<typeof animate>>())
  const gesture = useRef<GestureState | null>(null)
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null)

  /** Остановить glide значения — перед ручным управлением. */
  function halt(value: MotionValue<number>) {
    controls.current.get(value)?.stop()
    controls.current.delete(value)
  }

  /** Пружина к цели; при reduced-motion — мгновенно (функциональность та же). */
  function glide(value: MotionValue<number>, target: number) {
    halt(value)
    if (reducedMotion) {
      value.set(target)
      return
    }
    controls.current.set(value, animate(value, target, SPRING))
  }

  function jump(value: MotionValue<number>, target: number) {
    halt(value)
    value.set(target)
  }

  useEffect(() => {
    const running = controls.current
    return () => running.forEach((c) => c.stop())
  }, [])

  // Сцена в px; в jsdom нули → fallback на вьюпорт.
  function stageSize() {
    return {
      width: stageRef.current?.clientWidth || window.innerWidth || 1,
      height: stageRef.current?.clientHeight || window.innerHeight || 1,
    }
  }

  // Навигация без цикла: на краях листать некуда — там резистивность свайпа.
  function go(target: number) {
    if (target < 0 || target >= count || target === index) return
    setDirection(target > index ? 1 : -1)
    onIndexChange(target)
  }

  function prev() {
    go(index - 1)
  }

  function next() {
    go(index + 1)
  }

  // Escape + стрелки (клавиатура), clamp по краям; направление задаём для слайда.
  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      } else if (event.key === 'ArrowLeft' && index > 0) {
        event.preventDefault()
        setDirection(-1)
        onIndexChange(index - 1)
      } else if (event.key === 'ArrowRight' && index < count - 1) {
        event.preventDefault()
        setDirection(1)
        onIndexChange(index + 1)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, index, count, onClose, onIndexChange])

  // Фокус-ловушка: при открытии запоминаем элемент, который открыл, и ставим
  // фокус на «Закрыть»; при закрытии возвращаем фокус обратно.
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    // Сброс жестов/зума на каждом открытии.
    jump(x, 0)
    jump(y, 0)
    jump(zx, 0)
    jump(zy, 0)
    setZoomed(false)
    closeRef.current?.focus()
    return () => {
      if (opener && typeof opener.focus === 'function') opener.focus()
    }
  }, [open])

  // Блокировка скролла под модалкой.
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  // Предзагрузка соседей (index±1): переключение без белой вспышки.
  useEffect(() => {
    if (!open) return
    preloadNeighbours(urls, index)
  }, [open, index, urls])

  // Смена кадра — зум сбрасывается, панорамирование не переезжает на другой снимок.
  useEffect(() => {
    setZoomed(false)
    jump(zx, 0)
    jump(zy, 0)
  }, [index])

  /**
   * Tab циклится внутри модалки: X → стрелки → точки. Отключённые стрелки на
   * краях из обхода выпадают (FOCUSABLE их режет), фокус снаружи — запрыгивает
   * на первый/последний внутренний элемент.
   */
  function onDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return
    const root = event.currentTarget
    const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (nodes.length === 0) {
      event.preventDefault()
      return
    }
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    const active = document.activeElement
    const inside = active instanceof HTMLElement && root.contains(active)
    if (event.shiftKey) {
      if (!inside || active === first) {
        event.preventDefault()
        last.focus()
      }
    } else if (!inside || active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function velocity(samples: GestureSample[], event: ReactPointerEvent<HTMLElement>) {
    if (samples.length === 0) return { vx: 0, vy: 0 }
    const t = event.timeStamp || performance.now()
    // Самая ранняя точка, ещё попадающая в окно скорости.
    const first = samples.find((s) => t - s.t <= VELOCITY_WINDOW_MS) ?? samples[samples.length - 1]
    const dt = Math.max(1, t - first.t)
    return {
      vx: (event.clientX - first.x) / dt,
      vy: (event.clientY - first.y) / dt,
    }
  }

  function setZoomedNext(nextZoom: boolean) {
    setZoomed(nextZoom)
    if (!nextZoom) {
      glide(zx, 0)
      glide(zy, 0)
    }
  }

  function toggleZoom() {
    setZoomedNext(!zoomed)
  }

  /* ── Жесты: pointer-down задаёт базу, move решает ось и двигает, up решает ── */

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (gesture.current) return // вторая рука/палец — первый жест важнее
    if (event.pointerType === 'mouse' && event.button !== 0) return
    halt(x)
    halt(y)
    gesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      axis: null,
      moved: false,
      panBaseX: zx.get(),
      panBaseY: zy.get(),
      samples: [{ t: event.timeStamp || performance.now(), x: event.clientX, y: event.clientY }],
    }
    // В jsdom setPointerCapture нет — пробуем и не падаем.
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } catch {
      /* без capture движение всё равно дойдёт до обработчиков */
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const g = gesture.current
    if (!g) return
    const dx = event.clientX - g.startX
    const dy = event.clientY - g.startY
    if (!g.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_LOCK_PX) return
      if (zoomed) {
        g.axis = 'pan'
      } else {
        g.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y'
      }
      g.moved = true
    }
    const { width, height } = stageSize()
    if (g.axis === 'x') {
      let off = dx
      const atStart = index === 0
      const atEnd = index === count - 1
      if ((off > 0 && atStart) || (off < 0 && atEnd)) off *= EDGE_RESISTANCE
      x.set(off)
    } else if (g.axis === 'y') {
      // Вверх сцену не тянем: движение против направления — с сильным сопротивлением.
      let off = dy
      if (off < 0) off *= EDGE_RESISTANCE
      y.set(off)
    } else {
      // pan: границы = половина сцены на каждый вектор при ZOOM_SCALE = 2.
      const maxX = (width * (ZOOM_SCALE - 1)) / 2
      const maxY = (height * (ZOOM_SCALE - 1)) / 2
      zx.set(clamp(g.panBaseX + dx, -maxX, maxX))
      zy.set(clamp(g.panBaseY + dy, -maxY, maxY))
    }
    const t = event.timeStamp || performance.now()
    g.samples.push({ t, x: event.clientX, y: event.clientY })
    while (g.samples.length > 2 && t - g.samples[0].t > VELOCITY_WINDOW_MS) g.samples.shift()
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    const g = gesture.current
    gesture.current = null
    if (!g) return

    if (!g.moved) {
      // Тап без смещения: двойной тап (touch/pen) = зум, как двойной клик мышью.
      const t = event.timeStamp || performance.now()
      const near =
        lastTap.current !== null &&
        t - lastTap.current.t <= DOUBLE_TAP_MS &&
        Math.abs(event.clientX - lastTap.current.x) <= DOUBLE_TAP_SLOP_PX &&
        Math.abs(event.clientY - lastTap.current.y) <= DOUBLE_TAP_SLOP_PX
      if (near && event.pointerType !== 'mouse') {
        lastTap.current = null
        toggleZoom()
      } else {
        lastTap.current = { t, x: event.clientX, y: event.clientY }
      }
      return
    }

    lastTap.current = null
    if (g.axis === 'pan') return // панорамирование остаётся как есть

    const { width } = stageSize()
    const { vx, vy } = velocity(g.samples, event)

    if (g.axis === 'x') {
      const off = x.get()
      let accepted = false
      if ((off <= -width * SWIPE_RATIO || vx <= -FLICK_VELOCITY) && index < count - 1) {
        go(index + 1)
        accepted = true
      } else if ((off >= width * SWIPE_RATIO || vx >= FLICK_VELOCITY) && index > 0) {
        go(index - 1)
        accepted = true
      }
      // Кадр принят: смещение обнуляем мгновенно, движение делает direction-слайд.
      // Не принят: пружина назад (snap).
      if (accepted) jump(x, 0)
      else glide(x, 0)
    } else if (g.axis === 'y') {
      const off = y.get()
      // Смещение > 120 px и скорость — закрываем; иначе пружиной назад,
      // фон перестает темнеть сам собой (y едет к нулю).
      if (off > CLOSE_DISTANCE_PX && vy > CLOSE_VELOCITY) {
        jump(y, 0)
        onClose()
      } else {
        glide(y, 0)
      }
    }
  }

  function onPointerCancel() {
    const g = gesture.current
    gesture.current = null
    if (!g || !g.moved) return
    if (g.axis === 'x') glide(x, 0)
    else if (g.axis === 'y') glide(y, 0)
  }

  // Без prefers-reduced-motion слайд едет по направлению на 28% за 200 мс;
  // с ним — мгновенная замена кадра (функциональность полная).
  const slideVariants: Variants = {
    enter: (dir: number) => ({ x: reducedMotion ? '0%' : `${dir * 28}%`, opacity: reducedMotion ? 1 : 0 }),
    center: { x: '0%', opacity: 1 },
    exit: (dir: number) => ({ x: reducedMotion ? '0%' : `${-dir * 28}%`, opacity: reducedMotion ? 1 : 0 }),
  }

  // Портал в document.body: внутри дерева AppShell лайтбокс наследует чужие
  // stacking context'ы (transform/backdrop-blur на предках экранов), и его
  // z-index конкурировал бы только внутри них — шапка (z-40) и док (z-40)
  // оказывались выше. В body оверлей — корневой layer: z-[100] гарантированно
  // перекрывает шапку, док, тосты (z-40) и панорели уведомлений (z-50);
  // CustomCursor (z-[9999]) остаётся сверху — он не мешает.
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : FADE_MS }}
          className="group/lightbox fixed inset-0 z-[100] flex items-center justify-center"
          onKeyDown={onDialogKeyDown}
          role="dialog"
          aria-modal="true"
          aria-label="Просмотр фото объявления"
        >
          {/* Фон: плотный (+blur), чтобы текст объявления не просвечивал;
              клик по нему закрывает, клик/жест по картинке — нет.
              При протяжке вниз фон плавно светлеет (bgOpacity ← y). */}
          <motion.div
            data-testid="lightbox-backdrop"
            aria-hidden="true"
            className="absolute inset-0 bg-black/96 backdrop-blur-sm"
            style={{ opacity: reducedMotion ? 1 : bgOpacity }}
            onClick={onClose}
          />

          {/* Close button */}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="absolute right-4 top-4 z-20 rounded-full bg-white/10 p-2 text-white backdrop-blur-sm transition hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Счётчик: моно, приглушённый, в углу */}
          <div
            aria-live="polite"
            className="absolute left-4 top-4 z-20 font-mono text-sm text-white/60"
          >
            {index + 1} / {count}
          </div>

          {/* Стрелки: на десктопе — по hover/focus модалки, на тач-устройствах
              скрыты полностью (там свайп), на краях — выключены (листать некуда). */}
          {count > 1 && (
            <button
              type="button"
              onClick={prev}
              disabled={index === 0}
              aria-label="Предыдущее фото"
              className="pointer-coarse:hidden absolute left-4 top-1/2 z-20 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white opacity-0 backdrop-blur-sm transition-opacity duration-150 hover:bg-white/20 group-hover/lightbox:opacity-100 group-focus-within/lightbox:opacity-100 focus-visible:opacity-100 disabled:invisible"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}
          {count > 1 && (
            <button
              type="button"
              onClick={next}
              disabled={index === count - 1}
              aria-label="Следующее фото"
              className="pointer-coarse:hidden absolute right-4 top-1/2 z-20 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white opacity-0 backdrop-blur-sm transition-opacity duration-150 hover:bg-white/20 group-hover/lightbox:opacity-100 group-focus-within/lightbox:opacity-100 focus-visible:opacity-100 disabled:invisible"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          )}

          {/* Сцена фиксированного размера: «прыжка» высот при смене кадра нет. */}
          <div
            ref={stageRef}
            data-testid="lightbox-stage"
            className={`relative flex h-[70vh] w-[min(92vw,1200px)] touch-none select-none items-center justify-center overflow-hidden ${
              zoomed ? 'cursor-zoom-out' : 'cursor-zoom-in'
            }`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onDoubleClick={toggleZoom}
          >
            {/* Жестовый слой: x — свайп листания, y — свайп закрытия. */}
            <motion.div
              className="absolute inset-0 flex items-center justify-center"
              style={{ x, y }}
            >
              <AnimatePresence custom={direction} initial={false}>
                <motion.div
                  key={index}
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: reducedMotion ? 0 : SLIDE_MS, ease: 'easeOut' }}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  {/* Зум-обёртка: scale анимируется, панорамирование — zx/zy. */}
                  <motion.div
                    className="flex items-center justify-center"
                    style={{ x: zx, y: zy }}
                    animate={{ scale: zoomed ? ZOOM_SCALE : 1 }}
                    transition={{ duration: reducedMotion ? 0 : SLIDE_MS, ease: 'easeOut' }}
                  >
                    <img
                      src={urls[index]}
                      alt={`${alt} ${index + 1} из ${count}`}
                      decoding="async"
                      draggable={false}
                      className="max-h-full max-w-full select-none object-contain"
                    />
                  </motion.div>
                </motion.div>
              </AnimatePresence>
            </motion.div>
          </div>

          {/* Индикатор-точки (≤ 8 кадров): на мобильном заменяют миниатюры,
              на десктопе участвуют в фокус-ловушке. Больше 8 — только счётчик. */}
          {count > 1 && count <= 8 && (
            <div className="absolute inset-x-0 bottom-4 z-20 flex justify-center gap-1.5">
              {urls.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => go(i)}
                  aria-label={`Фото ${i + 1} из ${count}`}
                  aria-current={i === index}
                  className={`h-1.5 rounded-full transition-all duration-150 ${
                    i === index ? 'w-4 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/70'
                  }`}
                />
              ))}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
