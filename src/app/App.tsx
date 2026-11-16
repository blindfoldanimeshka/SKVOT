import { createContext, useContext, useEffect, useRef, useState, Suspense, lazy } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { SearchIcon } from '@/components/icons/search'
import { PlusIcon } from '@/components/icons/plus'
import { HomeIcon } from '@/components/icons/home'
import { MessageSquareIcon } from '@/components/icons/message-square'
import { UserIcon } from '@/components/icons/user'
import type { Database } from '@/types/database'
import { AppShell } from '@/components/layout/AppShell'
import { MenuBar, type MenuBarItem } from '@/components/layout/MenuBar'
import { isSupabaseConfigured } from '@/lib/env'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { useAuth } from '@/features/auth/useAuth'
import { AuthScreen } from '@/features/auth/AuthScreen'
import { useUnreadCounts } from '@/features/chat/useUnreadCounts'
import { NavigationProvider } from '@/app/navigation/NavigationProvider'
import { useNav } from '@/app/navigation/NavigationProvider'
import { CustomCursor } from '@/components/CustomCursor'
import type { NavParams } from '@/app/navigation/types'

// Lazy-loaded heavy screens
const NewListing = lazy(() => import('@/app/screens/NewListing').then((m) => ({ default: m.NewListing })))
const MyListingsScreen = lazy(() => import('@/app/screens/MyListingsScreen').then((m) => ({ default: m.MyListingsScreen })))
const ListingDetailScreen = lazy(() => import('@/app/screens/ListingDetailScreen').then((m) => ({ default: m.ListingDetailScreen })))
const ChatsScreen = lazy(() => import('@/app/screens/ChatsScreen').then((m) => ({ default: m.ChatsScreen })))
const ThreadScreen = lazy(() => import('@/app/screens/ThreadScreen').then((m) => ({ default: m.ThreadScreen })))
const ProfileScreenWrapper = lazy(() => import('@/app/screens/ProfileScreenWrapper').then((m) => ({ default: m.ProfileScreenWrapper })))
const LegalScreen = lazy(() => import('@/app/screens/LegalScreen').then((m) => ({ default: m.LegalScreen })))

// Eager-loaded landing screen
import { HomeFeed } from '@/app/screens/HomeFeed'

// Переход между экранами: направленный сдвиг + fade вместо чистого fade.
// `scale` здесь нет намеренно: масштабирование всего поддерева страницы
// (backdrop-blur чипы, многослойные тени) заставляет композитор растеризовать
// слои каждый кадр — дороже всего на слабом GPU. `x` — transform, он дёшев.
// `mode="wait"` ниже проигрывает exit → enter последовательно:
// 0.1s уход + 0.16s приход ≈ 0.26s на смену (в пределах бюджета 300 мс).
const PAGE_SHIFT = 16

/** `forward` — push: новый экран въезжает справа; `back` — наоборот, слева. */
type PageDirection = 'forward' | 'back'

const pageVariants = {
  initial: (direction: PageDirection) => ({
    opacity: 0,
    x: direction === 'back' ? -PAGE_SHIFT : PAGE_SHIFT,
  }),
  animate: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.16, ease: 'easeOut' as const },
  },
  exit: (direction: PageDirection) => ({
    opacity: 0,
    x: direction === 'back' ? PAGE_SHIFT : -PAGE_SHIFT,
    transition: { duration: 0.1, ease: 'easeIn' as const },
  }),
}

// Направление нужно каждому <PageTransition>, а пробрасывать его через все
// блоки разметки — шум: передаём рядом с AnimatePresence (единственный
// владелец перехода) и читаем контекстом.
const PageDirectionContext = createContext<PageDirection>('forward')

function PageTransition({ children }: { children: React.ReactNode }) {
  const reducedMotion = useReducedMotion()
  const direction = useContext(PageDirectionContext)
  // With reduced motion there is no motion component at all, so nothing keeps
  // the old page mounted (see PageStack below) — экран меняется мгновенно.
  if (reducedMotion) return <>{children}</>

  return (
    <motion.div
      variants={pageVariants}
      custom={direction}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {children}
    </motion.div>
  )
}

// AnimatePresence is only mounted when motion is allowed: it delays every page
// swap by one extra commit even when its children have no exit animation.
// `children` must stay a *flat JSX list* of keyed <PageTransition> elements —
// wrapping them in a fragment would hide the keys from AnimatePresence and
// silently kill exit animations.
function PageStack({
  animated,
  direction,
  children,
}: {
  animated: boolean
  direction: PageDirection
  children: React.ReactNode
}) {
  return (
    <PageDirectionContext.Provider value={direction}>
      {animated ? (
        <AnimatePresence mode="wait" custom={direction}>
          {children}
        </AnimatePresence>
      ) : (
        children
      )}
    </PageDirectionContext.Provider>
  )
}

type ListingRow = Database['public']['Tables']['listings']['Row']

type View =
  | 'home'
  | 'new'
  | 'mine'
  | 'detail'
  | 'profile'
  | 'chats'
  | 'thread'
  | 'privacy'
  | 'terms'

const NAV_ITEMS: MenuBarItem[] = [
  { key: 'home', label: 'Поиск', icon: SearchIcon },
  { key: 'new', label: 'Новое', icon: PlusIcon },
  { key: 'mine', label: 'Мои', icon: HomeIcon },
  { key: 'chats', label: 'Чаты', icon: MessageSquareIcon },
  { key: 'profile', label: 'Профиль', icon: UserIcon },
]

// Отложенная авторизация: читать проект можно без входа, вход требуется
// только на действиях. Клик по такому действию открывает экран входа как
// обычный view стека (не модалку) и запоминает намерение — куда вернуться
// после входа (view + params) и что автоматически продолжить (resume).
type AuthResume = 'chat' | null

interface AuthIntent {
  view: View
  params?: NavParams
  hint: string
  resume?: AuthResume
}

const AUTH_VIEW_HINTS: Partial<Record<View, string>> = {
  new: 'Войдите, чтобы подать объявление',
  mine: 'Войдите, чтобы посмотреть свои объявления',
  chats: 'Войдите, чтобы открыть чаты',
  thread: 'Войдите, чтобы открыть переписку',
  profile: 'Войдите, чтобы открыть профиль',
}

// Раздел дока, которому принадлежит экран. `detail`/`thread` здесь нет: это
// вложенные экраны, ни одна кнопка не активна (скоба прячется) — как и раньше.
const TOP_LEVEL: Record<string, View> = {
  home: 'home',
  new: 'new',
  mine: 'mine',
  chats: 'chats',
  profile: 'profile',
}

// Экраны, на которых док живёт. Юридические страницы (`privacy`/`terms`) и
// экран входа (`authActive`) дока не имеют — условия ниже повторяют блоки
// разметки 1:1, включая «detail/thread нужен свой params».
const DOCK_VIEWS: readonly View[] = ['home', 'new', 'mine', 'detail', 'chats', 'thread', 'profile']

/**
 * Единственный инстанс дока на всё приложение. Раньше его рендерили семь
 * блоков страниц внутри `<PageTransition>` — из-за навигации док монтировался
 * заново, и «переезд» скобы, pop иконки и bounce скобы не успевали сыграть:
 * новому экземпляру не откуда ехать. Теперь док — сиблинг стека экранов,
 * состояние (пружина скобы, compact) переживает смену экрана.
 */
function MenuNav({
  view,
  screenKey,
  onNavigate,
  unreadTotal,
  onToggleNotifications,
}: {
  view: View
  /** Key текущей записи стека: смена экрана = новый ключ. */
  screenKey: string
  onNavigate: (view: View) => void
  unreadTotal: number
  onToggleNotifications: () => void
}) {
  const items: MenuBarItem[] = NAV_ITEMS.map((item) => ({
    ...item,
    active: TOP_LEVEL[item.key] === view,
    badge: item.key === 'chats' && unreadTotal > 0 ? unreadTotal : undefined,
  }))

  // Shrink the dock while scrolling down; it restores on scroll up.
  //
  // Инстанс теперь один, поэтому слушатель перепривязывается на смене экрана
  // (`screenKey`): `lastY` заново считается от фактического скролла (иначе
  // первое движение после возврата на длинную ленту ошибётся направлением),
  // а `compact` сбрасывается синхронно — не в эффекте, чтобы док не мигал
  // сжатой полосой на первом кадре нового экрана.
  const [compact, setCompact] = useState(false)
  const lastScreenKey = useRef(screenKey)
  if (lastScreenKey.current !== screenKey) {
    lastScreenKey.current = screenKey
    setCompact(false)
  }

  useEffect(() => {
    let lastY = window.scrollY
    let ticking = false
    function onScroll() {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        const y = window.scrollY
        const goingDown = y > lastY
        if (goingDown && y > 80) setCompact(true)
        else if (!goingDown) setCompact(false)
        lastY = y
        ticking = false
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [screenKey])

  return (
    <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2">
      <MenuBar
        items={items}
        compact={compact}
        onSelect={(key) => {
          if (key === 'chats') onToggleNotifications()
          else onNavigate(TOP_LEVEL[key])
        }}
      />
    </div>
  )
}

function AppContent() {
  const { session, user, isLoading } = useAuth()
  const { current, push: navPush, back, reset } = useNav()
  const [showNotifications, setShowNotifications] = useState(false)
  const [authIntent, setAuthIntent] = useState<AuthIntent | null>(null)
  // Действие, которое надо автоматически продолжить после входа (сейчас —
  // «Написать автору» на экране объявления). Живёт ровно на одной записи
  // стека; при смене экрана снимается (см. эффект ниже).
  const [resumeChat, setResumeChat] = useState(false)
  const unread = useUnreadCounts()
  const reducedMotion = useReducedMotion()

  // Направление перехода: «вперёд» — push (и экран входа, открытый поверх
  // текущего view), «назад» — back, отмена входа и reset при выходе из
  // аккаунта. Считается здесь, в точке принятия решения о переходе: глубина
  // стека для этого не нужна, а направление отката видно только из вызова.
  const [direction, setDirection] = useState<PageDirection>('forward')

  const push = (view: View, params?: NavParams) => {
    setDirection('forward')
    navPush(view, params)
  }

  const goBack = () => {
    setDirection('back')
    back()
  }

  useEffect(() => {
    if (!session) {
      setDirection('back')
      reset()
      // Выход из аккаунта: неотвеченный экран входа и незавершённое
      // resume-действие относились к прежней сессии — снимаем их.
      setAuthIntent(null)
      setResumeChat(false)
    }
  }, [session, reset])

  // Возврат из отложенной авторизации: как только сессия появилась —
  // уходим с экрана входа на запомненный экран и, если намерение просило
  // продолжение, размечаем его. Для чата само действие перезапускает уже
  // ListingDetail, когда данные объявления загрузятся.
  useEffect(() => {
    if (!session || !authIntent) return
    const intent = authIntent
    setAuthIntent(null)
    if (intent.view !== current.view) push(intent.view, intent.params)
    if (intent.resume === 'chat') setResumeChat(true)
  }, [session, authIntent, current.view, current.params, push])

  // Resume-флаг привязан к конкретной записи стека: уход с экрана (новый
  // key) снимает его, чтобы действие не повторилось при следующем визите.
  useEffect(() => {
    setResumeChat(false)
  }, [current.key])

  function navigate(next: View) {
    if (current.view === next) return
    const hint = AUTH_VIEW_HINTS[next]
    if (!session && hint) {
      setDirection('forward')
      setAuthIntent({ view: next, hint })
      return
    }
    push(next)
  }

  // Направление перехода по экрану входа: сам он — не запись стека, поэтому
  // признаки ставим вручную: открыли — «вперёд», отменили — «назад».
  function closeAuth() {
    setDirection('back')
    setAuthIntent(null)
  }

  // Колбэк для экранных действий («Написать автору», «Пожаловаться»):
  // без сессии открывает вход поверх текущего экрана; после входа человек
  // возвращается туда, где был, и (для resume) действие продолжается само.
  function requestAuth(opts: { hint: string; resume?: AuthResume }) {
    if (session) return
    setDirection('forward')
    setAuthIntent({
      view: current.view,
      params: current.params,
      hint: opts.hint,
      resume: opts.resume ?? null,
    })
  }

  function openDetail(listing: ListingRow) {
    push('detail', { listingId: listing.id })
  }

  function openChat(chatId: string) {
    unread.markChatRead(chatId)
    setShowNotifications(false)
    push('thread', { chatId })
  }

  function toggleNotifications() {
    if (!session) {
      setDirection('forward')
      setAuthIntent({
        view: 'chats',
        hint: AUTH_VIEW_HINTS.chats ?? 'Войдите, чтобы открыть чаты',
      })
      return
    }
    setShowNotifications((prev) => !prev)
    if (current.view !== 'chats') push('chats')
  }

  if (isLoading) {
    return (
      <AppShell>
        <p className="text-muted-foreground animate-pulse">Загрузка…</p>
      </AppShell>
    )
  }

  // Экран входа — это view, а не блокирующий оверлей: legal-страницы
  // («Политика», «Условия» из формы входа) остаются обычными экранами,
  // остальной контент подменяется формой. Вход показываем в двух случаях:
  // есть намерение (клик по требующему входа действию) или стек стоит на
  // защищённом экране без сессии (например, сессия истекла на профиле) —
  // до того момента, как эффект выше вернёт анонима в ленту.
  const viewRequiresAuth = AUTH_VIEW_HINTS[current.view] !== undefined
  const authActive =
    !session &&
    (authIntent !== null || viewRequiresAuth) &&
    current.view !== 'privacy' &&
    current.view !== 'terms'

  const SuspenseFallback = (
    <AppShell>
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        Загрузка…
      </div>
    </AppShell>
  )

  // Единственный инстанс дока: рендерится ПОСЛЕ стека экранов и вне
  // `PageTransition`. Условия те же, что были у семи блоков разметки:
  // не экран входа, экран из DOCK_VIEWS, и для detail/thread — наличие
  // своего параметра (без него страница не рендерилась, значит и дока нет).
  const dockVisible =
    !authActive &&
    DOCK_VIEWS.includes(current.view) &&
    (current.view !== 'detail' || Boolean(current.params.listingId)) &&
    (current.view !== 'thread' || Boolean(current.params.chatId))

  return (
    <>
      <PageStack animated={!reducedMotion} direction={direction}>
        {current.view === 'privacy' && (
          <PageTransition key={current.key}>
            <Suspense fallback={SuspenseFallback}>
              <LegalScreen doc="privacy" onBack={goBack} />
            </Suspense>
          </PageTransition>
        )}

        {current.view === 'terms' && (
          <PageTransition key={current.key}>
            <Suspense fallback={SuspenseFallback}>
              <LegalScreen doc="terms" onBack={goBack} />
            </Suspense>
          </PageTransition>
        )}

        {authActive && (
          <PageTransition key={`auth:${current.key}`}>
            <AuthScreen
              hint={authIntent?.hint}
              onBack={closeAuth}
              onOpenLegal={(legalView) => navigate(legalView)}
            />
          </PageTransition>
        )}

        {!authActive && current.view === 'new' && (
          <PageTransition key={current.key}>
            <Suspense fallback={SuspenseFallback}>
              <AppShell>
                <NewListing onSaved={() => navigate('mine')} onCancel={() => navigate('home')} />
              </AppShell>
            </Suspense>
          </PageTransition>
        )}

        {!authActive && current.view === 'mine' && (
          <PageTransition key={current.key}>
            <Suspense fallback={SuspenseFallback}>
              <AppShell>
                <MyListingsScreen onBack={goBack} />
              </AppShell>
            </Suspense>
          </PageTransition>
        )}

        {!authActive && current.view === 'detail' && current.params.listingId && (
          <PageTransition key={current.key}>
            <Suspense fallback={SuspenseFallback}>
              <AppShell>
                <ListingDetailScreen
                  id={current.params.listingId}
                  onBack={goBack}
                  onStartChat={openChat}
                  requireAuth={requestAuth}
                  resumeStartChat={resumeChat}
                />
              </AppShell>
            </Suspense>
          </PageTransition>
        )}

        {!authActive && current.view === 'chats' && (
          <PageTransition key={current.key}>
            <Suspense fallback={SuspenseFallback}>
              <AppShell>
                <ChatsScreen
                  onBack={goBack}
                  unread={unread}
                  onOpenChat={openChat}
                  showNotifications={showNotifications}
                  onCloseNotifications={() => setShowNotifications(false)}
                />
              </AppShell>
            </Suspense>
          </PageTransition>
        )}
        {!authActive && current.view === 'thread' && current.params.chatId && (
          <PageTransition key={current.key}>
            <Suspense fallback={SuspenseFallback}>
              <AppShell>
                <ThreadScreen chatId={current.params.chatId} onBack={goBack} />
              </AppShell>
            </Suspense>
          </PageTransition>
        )}

        {!authActive && current.view === 'profile' && (
          <PageTransition key={current.key}>
            <Suspense fallback={SuspenseFallback}>
              <AppShell>
                <ProfileScreenWrapper onBack={goBack} />
              </AppShell>
            </Suspense>
          </PageTransition>
        )}

        {!authActive && current.view === 'home' && (
          <PageTransition key={current.key}>
            <AppShell>
              <HomeFeed
                onOpen={openDetail}
                onCreate={() => navigate('new')}
                isAuthenticated={Boolean(user)}
                userEmailConfirmed={Boolean(user?.email_confirmed_at)}
                isSupabaseConfigured={isSupabaseConfigured()}
                showNotifications={showNotifications}
                unread={unread}
                onOpenChat={openChat}
                onCloseNotifications={() => setShowNotifications(false)}
              />
            </AppShell>
          </PageTransition>
        )}
      </PageStack>

      {dockVisible && (
        <MenuNav
          view={current.view}
          screenKey={current.key}
          onNavigate={navigate}
          unreadTotal={unread.total}
          onToggleNotifications={toggleNotifications}
        />
      )}
    </>
  )
}

function SupabaseNotConfigured() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center bg-background">
      <h1 className="font-display text-lg font-semibold">Supabase не настроен</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Приложение запущено без переменных окружения{' '}
        <code>VITE_SUPABASE_URL</code> и{' '}
        <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>. Задайте их в настройках
        окружения и пересоберите проект.
      </p>
    </div>
  )
}

export function App() {
  if (!isSupabaseConfigured()) {
    return <SupabaseNotConfigured />
  }

  return (
    <AuthProvider>
      <NavigationProvider>
        <CustomCursor />
        <AppContent />
      </NavigationProvider>
    </AuthProvider>
  )
}