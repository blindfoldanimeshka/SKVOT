import * as React from 'react'
import {
  AnimatePresence,
  motion,
  useAnimationControls,
  useReducedMotion,
  type Transition,
} from 'motion/react'
import { cn } from '@/lib/utils'

export interface MenuBarItem {
  key: string
  label: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  active?: boolean
  badge?: number
}

interface MenuBarProps {
  items: MenuBarItem[]
  onSelect?: (key: string) => void
  compact?: boolean
  className?: string
}

const ICON_SIZE = 20
// Скоба-зажим: 12px от верхней кромки полосы (под рисками), 8px от нижней.
// Верх/низ заданы CSS-смещениями, поэтому скоба следует за высотой дока
// (обычный/компакт/мобильный) без повторной разметки в JS.
const BRACKET_TOP = 12
const BRACKET_BOTTOM = 8
// Пункты не уже 64px (min-w-[64px] в разметке): скобы выглядят ровно,
// а при compact (подписи скрыты) ширина не прыгает.

/* === Микроанимации «Рейки» (в духе iOS) =====================================
   Всё движение — пружины (`type: 'spring'`) или короткие keyframe-«попы» без
   линейных ease; ни один эффект не длиннее 300 мс, чтобы док оставался
   отзывчивым. Таблица «действие → форма» продублирована в отчёте.

   prefers-reduced-motion: `animated === false` → цели анимаций становятся
   идентичными (scale 1, y 0, без translate), transition — INSTANT, а
   keyframe-«попы» не запускаются вовсе. Страховка на CSS — в
   src/styles/index.css (@media prefers-reduced-motion: transform: none для
   декоративных слоёв дока). */

// Появление самого дока.
const ENTRANCE: Transition = { type: 'spring', stiffness: 320, damping: 26 }

// 1) Нажатие: иконка сжимается до 0.88 и проседает на 1px; отпускание —
//    пружина с лёгким overshoot (ζ ≈ 0.49, «доходит» за ~180 мс, хвост гаснет
//    к ~300 мс).
const TAP_SCALE = 0.88
const TAP_SINK = -1
const PRESS: Transition = { type: 'spring', stiffness: 620, damping: 34 }
const TAP_RETURN: Transition = { type: 'spring', stiffness: 500, damping: 22 }

// 2) Активация пункта: «pop» иконки 1 → 1.12 → 1 за 260 мс; подпись при смене
//    активности переезжает на 2px с fade (ход ~120 мс, ζ ≈ 0.66 — почти без overshoot).
const POP_SCALE = 1.12
const POP: Transition = { duration: 0.26, times: [0, 0.42, 1], ease: ['easeOut', 'easeInOut'] }
const LABEL_SINK = 2
const LABEL_FADE = 0.72
const LABEL: Transition = { type: 'spring', stiffness: 520, damping: 30 }

// 3) Скоба-зажим: переезд с overshoot (damping 21 < прежних 26 → ~9% залёт),
//    «bounce» по высоте 1 → 1.06 → 1 за 180 мс, «губки» отклоняются на 2px
//    в сторону движения и возвращаются, когда скоба долетела.
const BRACKET_SPRING: Transition = { type: 'spring', stiffness: 300, damping: 21 }
const BRACKET_BOUNCE_SCALE = 1.06
const BRACKET_BOUNCE: Transition = {
  duration: 0.18,
  times: [0, 0.45, 1],
  ease: ['easeOut', 'easeInOut'],
}
const LIP_LEAN = 2
const LIP: Transition = { type: 'spring', stiffness: 460, damping: 24 }

// 4) Точка-индикатор активного пункта (мобильный): scale 0 → 1 со свечением.
const DOT: Transition = { type: 'spring', stiffness: 480, damping: 24 }

// 5) Бейдж непрочитанных: pop 1 → 1.25 → 1 (240 мс) на каждое новое сообщение,
//    вход — пружина, уход — fade + scale.
const BADGE_POP_SCALE = 1.25
const BADGE_POP: Transition = {
  duration: 0.24,
  times: [0, 0.4, 1],
  ease: ['easeOut', 'easeInOut'],
}
const BADGE: Transition = { type: 'spring', stiffness: 520, damping: 26 }
// Общий быстрый «уход» (badge/точка): fade + scale за 140 мс.
const EXIT_QUICK: Transition = { duration: 0.14, ease: 'easeIn' }

// 7) Тактильность: самый короткий «тик» — ровно на узнаваемость нажатия.
const HAPTIC_MS = 8

const INSTANT: Transition = { duration: 0 }

/**
 * Виброотклик есть не везде (iOS Safari — нет, тесты — нет), поэтому только
 * проверка наличия API: никакого polyfill и никаких зависимостей.
 */
function haptic() {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  try {
    navigator.vibrate(HAPTIC_MS)
  } catch {
    /* вне пользовательского жеста браузер отказывает — молча пропускаем */
  }
}

interface DockBracketProps {
  x: number
  width: number
  visible: boolean
  animated: boolean
  /** Ключ активного пункта: его смена — триггер «bounce» по высоте. */
  activation: string
  /** До первого замера геометрии скоба становится без пружины — не «прилетает». */
  sprung: boolean
}

/**
 * Скоба-зажим: внешний слой отвечает за переезд (x/width — это позиционирование,
 * его reduce не трогает), внутренний — за декор: scaleY-«bounce» и отклонение
 * «губок». Разделение по двум элементам нужно, чтобы props-анимация переезда
 * не спорила с событийной (controls) анимацией высоты.
 */
function DockBracket({ x, width, visible, animated, activation, sprung }: DockBracketProps) {
  const bounce = useAnimationControls()
  const [lean, setLean] = React.useState(0)
  const prevX = React.useRef(x)
  const prevActivation = React.useRef(activation)

  // Направление последнего переезда: держим уклон, пока пружина не долетела.
  React.useEffect(() => {
    const from = prevX.current
    prevX.current = x
    if (!animated || from === x) return
    setLean(Math.sign(x - from))
  }, [animated, x])

  // Активация пункта: короткий «bounce» по высоте.
  React.useEffect(() => {
    const changed = prevActivation.current !== activation
    prevActivation.current = activation
    if (!changed || !animated) return
    void bounce
      .start({ scaleY: [1, BRACKET_BOUNCE_SCALE, 1], transition: BRACKET_BOUNCE })
      .catch(() => {})
  }, [animated, activation, bounce])

  return (
    <motion.div
      aria-hidden
      data-dock-bracket
      initial={false}
      animate={{ x, width, opacity: visible ? 1 : 0 }}
      transition={sprung ? BRACKET_SPRING : INSTANT}
      onAnimationComplete={() => setLean(0)}
      className="pointer-events-none absolute left-0"
      style={{ top: BRACKET_TOP, bottom: BRACKET_BOTTOM }}
    >
      <motion.div
        data-dock-bracket-frame
        className="relative h-full w-full origin-bottom rounded-b-[3px] border border-t-0 border-primary/70 bg-primary/10"
        initial={false}
        animate={bounce}
      >
        <motion.span
          data-dock-lip
          className="absolute -left-[1px] -top-[3px] h-[6px] w-[3px] bg-primary"
          initial={false}
          animate={{ x: lean * LIP_LEAN }}
          transition={sprung ? LIP : INSTANT}
        />
        <motion.span
          data-dock-lip
          className="absolute -right-[1px] -top-[3px] h-[6px] w-[3px] bg-primary"
          initial={false}
          animate={{ x: lean * LIP_LEAN }}
          transition={sprung ? LIP : INSTANT}
        />
      </motion.div>
    </motion.div>
  )
}

/**
 * Обёртка presence-анимаций: при prefers-reduced-motion `AnimatePresence`
 * вообще не монтируется — состояние (бейдж/точка) переключается синхронно,
 * и ничто не держит удалённый узел на один лишний кадр.
 */
function Presence({ animated, children }: { animated: boolean; children: React.ReactNode }) {
  return animated ? <AnimatePresence initial={false}>{children}</AnimatePresence> : <>{children}</>
}

interface DockItemProps {
  item: MenuBarItem
  index: number
  compact: boolean
  animated: boolean
  onSelect: (key: string) => void
  /** Ряд меряет скобу по offsetLeft/offsetWidth кнопки — ссылка нужна наружу. */
  registerRef: (index: number, el: HTMLButtonElement | null) => void
}

/**
 * Один пункт дока. Слои трансформаций разнесены по элементам, чтобы они
 * складывались, а не перезаписывали друг друга:
 * [data-dock-icon]  — CSS-ховер (translate-y) и цвет;
 *   [data-dock-press] — пружина нажатия (scale + y);
 *     [data-dock-pop] — keyframe «pop» активации (scale).
 */
function DockItem({ item, index, compact, animated, onSelect, registerRef }: DockItemProps) {
  const [pressed, setPressed] = React.useState(false)
  const pop = useAnimationControls()
  const badgePop = useAnimationControls()

  // «Pop» только на смене неактивный → активный: на первом рендере тишина.
  const prevActive = React.useRef(item.active)
  React.useEffect(() => {
    const changed = prevActive.current !== item.active
    prevActive.current = item.active
    if (!changed || !item.active || !animated) return
    void pop.start({ scale: [1, POP_SCALE, 1], transition: POP }).catch(() => {})
  }, [animated, item.active, pop])

  // Бейдж: новое сообщение поверх уже видимого — «pop»; само появление
  // рисует entrance-пружина, поэтому там pop не дублируем.
  const prevBadge = React.useRef(item.badge ?? 0)
  React.useEffect(() => {
    const next = item.badge ?? 0
    const grew = prevBadge.current > 0 && next > prevBadge.current
    prevBadge.current = next
    if (!grew || !animated) return
    void badgePop
      .start({ scale: [1, BADGE_POP_SCALE, 1], transition: BADGE_POP })
      .catch(() => {})
  }, [animated, item.badge, badgePop])

  const release = () => setPressed(false)

  return (
    <button
      ref={(el) => registerRef(index, el)}
      type="button"
      aria-label={item.label}
      aria-current={item.active ? 'page' : undefined}
      onPointerDown={(event) => {
        // Правая/средняя кнопка мыши не «нажатие»; touch и pen идут всегда.
        if (event.pointerType === 'mouse' && event.button !== 0) return
        if (animated) setPressed(true)
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
      onClick={() => {
        haptic()
        onSelect(item.key)
      }}
      className="group relative z-10 flex min-w-[64px] cursor-pointer flex-col items-center outline-none"
    >
      <span
        data-dock-icon
        data-pressed={pressed ? 'true' : undefined}
        className={cn(
          'relative flex items-center justify-center',
          'transition-transform duration-[var(--duration-fast)] ease-[var(--ease-smooth)]',
          'group-hover:-translate-y-[2px]',
          item.active
            ? 'text-foreground drop-shadow-[0_0_8px_rgba(125,57,235,0.45)]'
            : 'text-[color:var(--dock-icon-idle)]',
        )}
      >
        <motion.span
          data-dock-press
          className="flex items-center justify-center"
          initial={false}
          animate={{
            scale: pressed ? TAP_SCALE : 1,
            y: pressed ? TAP_SINK : 0,
          }}
          transition={pressed ? PRESS : TAP_RETURN}
        >
          <motion.span
            data-dock-pop
            className="flex items-center justify-center"
            initial={false}
            animate={pop}
          >
            <item.icon size={ICON_SIZE} className="h-[20px] w-[20px]" />
          </motion.span>
        </motion.span>

        {/* Бейдж: уход анимируется presence-слоем, при reduce он не монтируется
            (см. Presence), поэтому exit-целем можно не ветвиться. */}
        <Presence animated={animated}>
          {item.badge ? (
            <motion.span
              key="badge"
              data-dock-badge
              className="absolute -right-2.5 -top-1.5"
              initial={animated ? { scale: 0, opacity: 0 } : false}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0, transition: EXIT_QUICK }}
              transition={animated ? BADGE : INSTANT}
            >
              <motion.span
                className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white"
                initial={false}
                animate={badgePop}
              >
                {item.badge > 99 ? '99+' : item.badge}
              </motion.span>
            </motion.span>
          ) : null}
        </Presence>
      </span>

      {/* Подписи: компакт — не рендерятся; мобильный (<420px) — скрыты. */}
      {!compact && (
        <motion.span
          data-dock-label
          className={cn(
            'dock-label mt-1.5 max-[420px]:hidden',
            item.active ? 'text-foreground' : 'text-[color:var(--dock-label-idle)]',
          )}
          initial={false}
          animate={
            animated
              ? { y: item.active ? 0 : LABEL_SINK, opacity: item.active ? 1 : LABEL_FADE }
              : { y: 0, opacity: 1 }
          }
          transition={animated ? LABEL : INSTANT}
        >
          {item.label}
        </motion.span>
      )}

      {/* Мобильный индикатор активного — точка под иконкой: появляется
          scale 0 → 1 со свечением (.dock-dot), уходит scale → 0; при
          reduced-motion просто сменяется мгновенно. */}
      <Presence animated={animated}>
        {item.active ? (
          <motion.span
            key="dot"
            data-dock-dot
            aria-hidden
            className="dock-dot mt-1.5 hidden h-[5px] w-[5px] rounded-full bg-primary max-[420px]:block"
            initial={animated ? { scale: 0, opacity: 0 } : false}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0, transition: EXIT_QUICK }}
            transition={animated ? DOT : INSTANT}
          />
        ) : null}
      </Presence>
    </button>
  )
}

/**
 * Нижний док «Рейка»: полоса во всю ширину, прижатая к нижней кромке экрана.
 * Читается как измерительная линейка: волосяная линия сверху, два слоя штрихов
 * (24px / 120px), активный раздел обхвачен скобой-зажимом, которая пружинно
 * переезжает между пунктами.
 *
 * Публичный API намеренно узкий (`items` / `onSelect` / `compact` / `className`):
 * всё «яблочное» поведение — нажатие, pop, свечение точки, тактильность —
 * выводится из уже знакомых родителю признаков (`active`, `badge`).
 *
 * Компонент отрендерен внутри обёртки `fixed bottom-4 left-1/2 -translate-x-1/2`
 * (src/app/App.tsx), поэтому корневой элемент растягивается на 100vw
 * (`w-screen`) и вычитает нижний отступ обёртки (`-mb-4`) — полоса ложится
 * ровно на кромку экрана во всю ширину.
 */
export function MenuBar({
  items,
  className,
  onSelect = () => {},
  compact = false,
}: MenuBarProps) {
  const reducedMotion = useReducedMotion()
  const rowRef = React.useRef<HTMLDivElement>(null)
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([])

  // Горизонтальная геометрия скобы измеряется в локальных координатах ряда;
  // вертикаль — CSS (top/bottom), она наследует высоту полосы.
  const [bracket, setBracket] = React.useState({ x: 0, w: 0, visible: false })
  // Первый замер не должен «прилетать» слева: до готовности — без пружины.
  const [ready, setReady] = React.useState(false)

  const measure = React.useCallback(() => {
    const row = rowRef.current
    const index = items.findIndex((item) => item.active)
    const el = row && index >= 0 ? itemRefs.current[index] : null
    if (!el) {
      setBracket((prev) => (prev.visible ? { ...prev, visible: false } : prev))
      return
    }
    const next = { x: el.offsetLeft, w: el.offsetWidth, visible: true }
    setBracket((prev) =>
      prev.x === next.x && prev.w === next.w && prev.visible ? prev : next,
    )
  }, [items])

  // Каждое изменение разметки (items/compact/высота) — новый замер скобы.
  React.useLayoutEffect(() => {
    measure()
  })

  React.useEffect(() => {
    const onResize = () => measure()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [measure])

  React.useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const animated = reducedMotion !== true
  const activation = items.find((item) => item.active)?.key ?? ''

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={animated ? ENTRANCE : INSTANT}
      className={cn('relative -mb-4 w-screen max-w-none', className)}
    >
      {/* «Подъём» над полосой: 24px градиент цвет→прозрачный — контент не
          обрывается резкой кромкой дока. */}
      <div aria-hidden className="dock-lift pointer-events-none absolute inset-x-0 bottom-full" />

      {/* Полоса: почти непрозрачный тёмный фон (--dock-bg, α .97 — текст
          страницы не просвечивает), backdrop-blur как страховка,
          волосяная линия сверху, риски линейки. */}
      <div
        className={cn(
          'dock-bar relative border-t border-white/15 backdrop-blur-xl',
          'transition-[height] duration-[var(--duration-base)] ease-[var(--ease-smooth)]',
          compact ? 'h-[var(--dock-h-compact)]' : 'h-[var(--dock-h)]',
        )}
      >
        <div aria-hidden className="dock-rules pointer-events-none absolute inset-x-0 top-0" />

        <div ref={rowRef} className="relative mx-auto flex h-full w-full max-w-6xl items-center justify-around px-2">
          <DockBracket
            x={bracket.x}
            width={bracket.w}
            visible={bracket.visible}
            animated={animated}
            activation={activation}
            sprung={animated && ready}
          />

          {items.map((item, index) => (
            <DockItem
              key={item.key}
              item={item}
              index={index}
              compact={compact}
              animated={animated}
              onSelect={onSelect}
              registerRef={(i, el) => {
                itemRefs.current[i] = el
              }}
            />
          ))}
        </div>
      </div>
    </motion.div>
  )
}
