import type { ReactNode } from 'react'
import { useScroll, useSpring, useReducedMotion, useTransform, motion } from 'motion/react'
import logoSvg from '@/public/СКВОТ.svg'
import { NotificationBell } from '@/features/notifications/NotificationBell'
import { SearchIcon } from '@/components/icons/search'
import { PlusIcon } from '@/components/icons/plus'
import { HomeIcon } from '@/components/icons/home'
import { MessageSquareIcon } from '@/components/icons/message-square'
import { UserIcon } from '@/components/icons/user'
import { cn } from '@/lib/utils'
import type { View } from '@/app/navigation/types'

/**
 * Пункты шапки. Подписи — договор с e2e-тестами: менять нельзя, можно только
 * добавлять (регистр и пробелы тоже значимы: `getByRole` сверяет имя целиком).
 */
const NAV_ITEMS: ReadonlyArray<{ view: View; label: string; icon: typeof SearchIcon }> = [
  { view: 'home', label: 'Поиск', icon: SearchIcon },
  { view: 'new', label: 'Новое', icon: PlusIcon },
  { view: 'mine', label: 'Мои', icon: HomeIcon },
  { view: 'chats', label: 'Чаты', icon: MessageSquareIcon },
  { view: 'profile', label: 'Профиль', icon: UserIcon },
]

/**
 * Экран → раздел шапки. `detail`/`thread` здесь нет намеренно: это вложенные
 * экраны, и ни один пункт на них не подсвечен (как и раньше в доке).
 */
const SECTION: Partial<Record<View, View>> = {
  home: 'home',
  new: 'new',
  mine: 'mine',
  chats: 'chats',
  profile: 'profile',
}

/** Навигационная часть проппов — её пробрасывает `AppContent`. */
export interface AppShellNavProps {
  /** Текущий экран. Без него навигация не рисуется (загрузка, fallback). */
  view?: View
  onNavigate?: (view: View) => void
  /**
   * Обработчик «Чатов»: там, где док показывал панель уведомлений. Если его
   * нет, «Чаты» ведут себя как обычный пункт — просто `onNavigate('chats')`.
   */
  onToggleNotifications?: () => void
  /**
   * Непрочитанные чаты. В доке это был бейдж на пункте «Чаты»; док убрали —
   * счётчик переехал в колокольчик, чтобы не потерять инфу.
   */
  unreadTotal?: number
}

export interface AppShellProps extends AppShellNavProps {
  children: ReactNode
}

interface HeaderNavProps extends AppShellNavProps {
  className?: string
}

/**
 * Единственный ряд пунктов. Десктоп и мобильный делят одну разметку: меняется
 * только поведение контейнера — на широком экране пункты стоят в строку с
 * логотипом, на узком уезжают второй строкой (`w-full` внутри flex-wrap) и
 * прокручиваются по горизонтали. Второй копии навигации нет намеренно: две —
 * это два набора обработчиков и дубли в доступном дереве.
 */
function HeaderNav({ className, view, onNavigate, onToggleNotifications }: HeaderNavProps) {
  const active = view === undefined ? undefined : SECTION[view]

  const select = (item: View) => {
    if (!onNavigate) return
    // «Чаты» — не просто переход: как в доке, они ещё и открывают панель
    // уведомлений поверх списка. Решение живёт в AppContent (toggleNotifications).
    if (item === 'chats' && onToggleNotifications) onToggleNotifications()
    else onNavigate(item)
  }

  return (
    // `nav-scroll` + `max-sm:overflow-x-auto` — страховка для экранов уже
    // ~360px: там пять подписей не влезают физически, и скролл честнее
    // обрезания. На 390px ряд умещается целиком (замер в браузере: 317px
    // содержимого при 350px доступных), а на десктопе scroll-контейнер не
    // нужен и только обрезал бы фокус-рамку.
    <nav
      aria-label="Основная навигация"
      className={cn('min-w-0 nav-scroll max-sm:overflow-x-auto', className)}
    >
      {/* Компактность мобильного ряда делают отступы и gap, а не размер
          шрифта: `font: inherit` для button/input в src/styles/index.css
          лежит вне слоёв и перебивает tailwind-овские `text-*`, так что
          `text-[13px]` был бы здесь мёртвым классом.
          Итог на 390px: `px-2` + `gap-0.5` = 317px (подчёркивание активного
          пункта при `inset-x-2` ровно над текстом и не выезжает за кнопку). */}
      <ul className="flex shrink-0 items-center gap-0.5 sm:gap-1">
        {NAV_ITEMS.map((item) => {
          const isActive = item.view === active
          return (
            <li key={item.view}>
              <button
                type="button"
                aria-current={isActive ? 'page' : undefined}
                aria-label={item.label}
                onClick={() => select(item.view)}
                className={cn(
                  'relative flex shrink-0 flex-col items-center gap-0.5 whitespace-nowrap rounded-t-md px-2 py-1.5 font-medium',
                  'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-smooth)]',
                  'sm:flex-row sm:gap-1.5 sm:px-3 sm:py-2',
                  isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <item.icon size={18} className="shrink-0" />
                <span>{item.label}</span>
                {/* Подчёркивание активного пункта: lime-акцент бренда, а не
                    дефолтная «пилюля из SaaS-шаблона». */}
                {isActive && (
                  <span
                    aria-hidden
                    className="absolute inset-x-2 bottom-0.5 h-[2px] rounded-full bg-secondary"
                  />
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export function AppShell({ children, ...nav }: AppShellProps) {
  const { scrollYProgress } = useScroll()
  const prefersReduced = useReducedMotion()
  const smoothX = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 30,
    restDelta: 0.001,
  })
  const scaleX = prefersReduced ? scrollYProgress : smoothX

  const topFade = useTransform(scrollYProgress, [0, 0.04], [0, 0.9])
  const bottomFade = useTransform(scrollYProgress, [0.96, 1], [0, 0.9])
  const topOpacity = prefersReduced ? undefined : topFade
  const bottomOpacity = prefersReduced ? undefined : bottomFade

  // Навигация есть только там, где её попросили показать: legal-страницы и
  // экран входа шапки не имеют вовсе, а «Загрузка…» и Suspense-fallback —
  // шапка без пунктов.
  const showNav = nav.view !== undefined && nav.onNavigate !== undefined

  return (
    <main className="min-h-screen bg-stone-50 pb-16">
      <header className="sticky top-0 z-40 bg-surface/80 shadow-[var(--shadow-surface)] backdrop-blur-xl">
        {/* Классическая раскладка: логотип слева, пункты сразу за ним,
            колокольчик у правого края. Один и тот же ряд на узком экране
            переставляется `order`-ами во вторую строку (`basis-full`) и
            прокручивается по горизонтали без скроллбара (`nav-scroll`).
            Порядок на обоих брейкпоинтах задаёт flex, а не дубль разметки:
            двух наборов кнопок в DOM не существует. */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3 sm:px-8">
          <a href="/" aria-label="СКВОТ" className="order-1 shrink-0">
            <img src={logoSvg} alt="СКВОТ" className="h-9 w-auto" />
          </a>
          {showNav && (
            <HeaderNav
              {...nav}
              className="order-3 basis-full border-t border-border-muted sm:order-2 sm:basis-auto sm:border-0"
            />
          )}
          <div className="order-2 ml-auto flex shrink-0 items-center sm:order-3">
            <NotificationBell unreadTotal={nav.unreadTotal} />
          </div>
        </div>
        <motion.div
          className="absolute bottom-0 left-0 right-0 z-50 h-0.5 origin-left bg-primary"
          style={{ scaleX }}
        />
      </header>
      <div className="mx-auto max-w-6xl px-5 pt-6 sm:px-8 sm:pt-8">{children}</div>
      {/* top edge fade */}
      <motion.div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-30 h-24 bg-gradient-to-b from-black/70 to-transparent"
        style={prefersReduced ? undefined : { opacity: topOpacity }}
      />
      {/* bottom edge fade */}
      <motion.div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-0 z-30 h-32 bg-gradient-to-t from-black/70 to-transparent"
        style={prefersReduced ? undefined : { opacity: bottomOpacity }}
      />
    </main>
  )
}
