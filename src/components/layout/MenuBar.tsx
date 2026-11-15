import * as React from 'react'
import { motion, useReducedMotion } from 'motion/react'
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

const SPRING = { type: 'spring', stiffness: 320, damping: 26 } as const
const INSTANT = { duration: 0 } as const

/**
 * Нижний док «Рейка»: полоса во всю ширину, прижатая к нижней кромке экрана.
 * Читается как измерительная линейка: волосяная линия сверху, два слоя штрихов
 * (24px / 120px), активный раздел обхвачен скобой-зажимом, которая пружинно
 * переезжает между пунктами.
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

  const noAnim = reducedMotion === true || !ready
  const bracketTransition = noAnim ? INSTANT : SPRING

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reducedMotion === true ? INSTANT : SPRING}
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
          {/* Скоба-зажим: рамка слева/справа/снизу, сверху открыта;
              фиолетовая заливка и «губки» по верхним углам. */}
          <motion.div
            aria-hidden
            initial={false}
            animate={{ x: bracket.x, width: bracket.w, opacity: bracket.visible ? 1 : 0 }}
            transition={bracketTransition}
            className="pointer-events-none absolute left-0 rounded-b-[3px] border border-t-0 border-primary/70 bg-primary/10"
            style={{ top: BRACKET_TOP, bottom: BRACKET_BOTTOM }}
          >
            <span className="absolute -left-[1px] -top-[3px] h-[6px] w-[3px] bg-primary" />
            <span className="absolute -right-[1px] -top-[3px] h-[6px] w-[3px] bg-primary" />
          </motion.div>

          {items.map((item, index) => (
            <button
              key={item.key}
              ref={(el) => {
                itemRefs.current[index] = el
              }}
              type="button"
              aria-label={item.label}
              aria-current={item.active ? 'page' : undefined}
              onClick={() => onSelect(item.key)}
              className="group relative z-10 flex min-w-[64px] cursor-pointer flex-col items-center outline-none"
            >
              <span
                data-dock-icon
                className={cn(
                  'relative flex items-center justify-center',
                  'transition-transform duration-[var(--duration-fast)] ease-[var(--ease-smooth)]',
                  'group-hover:-translate-y-[2px]',
                  item.active
                    ? 'text-foreground drop-shadow-[0_0_8px_rgba(125,57,235,0.45)]'
                    : 'text-[color:var(--dock-icon-idle)]',
                )}
              >
                <item.icon size={ICON_SIZE} className="h-[20px] w-[20px]" />
                {item.badge ? (
                  <span className="absolute -right-2.5 -top-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                ) : null}
              </span>

              {/* Подписи: компакт — не рендерятся; мобильный (<420px) — скрыты. */}
              {!compact && (
                <span
                  className={cn(
                    'dock-label mt-1.5 max-[420px]:hidden',
                    item.active ? 'text-foreground' : 'text-[color:var(--dock-label-idle)]',
                  )}
                >
                  {item.label}
                </span>
              )}

              {/* Мобильный индикатор активного — точка под иконкой. */}
              {item.active && (
                <span
                  aria-hidden
                  className="mt-1.5 hidden h-[5px] w-[5px] rounded-full bg-primary max-[420px]:block"
                />
              )}
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  )
}
