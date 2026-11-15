import { useEffect, useRef, useState, Suspense, lazy } from 'react'
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

// Fade-only page transition.
// `scale` is deliberately gone: scaling the whole page subtree (it holds
// backdrop-blur chips and layered shadows) makes the compositor re-raster those
// layers every frame — the single most expensive thing on a low-end GPU.
// `mode="wait"` below runs exit → enter sequentially, so durations are kept
// small: 0.1s out + 0.16s in ≈ 0.26s total swap (was 0.25 + 0.25 = 0.5s).
const pageVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.16, ease: 'easeOut' as const } },
  exit: { opacity: 0, transition: { duration: 0.1, ease: 'easeIn' as const } },
}

function PageTransition({ children }: { children: React.ReactNode }) {
  const reducedMotion = useReducedMotion()
  // With reduced motion there is no motion component at all, so nothing keeps
  // the old page mounted (see PageStack below).
  if (reducedMotion) return <>{children}</>

  return (
    <motion.div variants={pageVariants} initial="initial" animate="animate" exit="exit">
      {children}
    </motion.div>
  )
}

// AnimatePresence is only mounted when motion is allowed: it delays every page
// swap by one extra commit even when its children have no exit animation.
// `children` must stay a *flat JSX list* of keyed <PageTransition> elements —
// wrapping them in a fragment would hide the keys from AnimatePresence and
// silently kill exit animations.
function PageStack({ animated, children }: { animated: boolean; children: React.ReactNode }) {
  if (!animated) return <>{children}</>
  return <AnimatePresence mode="wait">{children}</AnimatePresence>
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

function MenuNav({
  view,
  onNavigate,
  unreadTotal,
  onToggleNotifications,
}: {
  view: View
  onNavigate: (view: View) => void
  unreadTotal: number
  onToggleNotifications: () => void
}) {
  const topLevel: Record<string, View> = {
    home: 'home',
    new: 'new',
    mine: 'mine',
    chats: 'chats',
    profile: 'profile',
  }
  const items: MenuBarItem[] = NAV_ITEMS.map((item) => ({
    ...item,
    active: topLevel[item.key] === view,
    badge: item.key === 'chats' && unreadTotal > 0 ? unreadTotal : undefined,
  }))

  // Shrink the dock while scrolling down; it restores on scroll up (and on hover
  // inside MenuBar itself).
  const [compact, setCompact] = useState(false)
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
  }, [])

  return (
    <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2">
      <MenuBar
        items={items}
        compact={compact}
        onSelect={(key) => {
          if (key === 'chats') onToggleNotifications()
          else onNavigate(topLevel[key])
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

  // Direction tracking: monotonic depth counter
  const depthRef = useRef(0)
  const prevDepthRef = useRef(0)

  const push = (view: View, params?: NavParams) => {
    prevDepthRef.current = depthRef.current
    depthRef.current++
    navPush(view, params)
  }

  const goBack = () => {
    prevDepthRef.current = depthRef.current
    depthRef.current--
    back()
  }

  useEffect(() => {
    if (!session) {
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
      setAuthIntent({ view: next, hint })
      return
    }
    push(next)
  }

  // Колбэк для экранных действий («Написать автору», «Пожаловаться»):
  // без сессии открывает вход поверх текущего экрана; после входа человек
  // возвращается туда, где был, и (для resume) действие продолжается само.
  function requestAuth(opts: { hint: string; resume?: AuthResume }) {
    if (session) return
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

  return (
    <PageStack animated={!reducedMotion}>
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
            onBack={() => setAuthIntent(null)}
            onOpenLegal={(legalView) => navigate(legalView)}
          />
        </PageTransition>
      )}

      {!authActive && current.view === 'new' && (
        <PageTransition key={current.key}>
          <Suspense fallback={SuspenseFallback}>
            <AppShell>
              <MenuNav
                view={current.view}
                onNavigate={navigate}
                unreadTotal={unread.total}
                onToggleNotifications={toggleNotifications}
              />
              <NewListing onSaved={() => navigate('mine')} onCancel={() => navigate('home')} />
            </AppShell>
          </Suspense>
        </PageTransition>
      )}

      {!authActive && current.view === 'mine' && (
        <PageTransition key={current.key}>
          <Suspense fallback={SuspenseFallback}>
            <AppShell>
              <MenuNav
                view={current.view}
                onNavigate={navigate}
                unreadTotal={unread.total}
                onToggleNotifications={toggleNotifications}
              />
              <MyListingsScreen onBack={goBack} />
            </AppShell>
          </Suspense>
        </PageTransition>
      )}

      {!authActive && current.view === 'detail' && current.params.listingId && (
        <PageTransition key={current.key}>
          <Suspense fallback={SuspenseFallback}>
            <AppShell>
              <MenuNav
                view={current.view}
                onNavigate={navigate}
                unreadTotal={unread.total}
                onToggleNotifications={toggleNotifications}
              />
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
              <MenuNav
                view={current.view}
                onNavigate={navigate}
                unreadTotal={unread.total}
                onToggleNotifications={toggleNotifications}
              />
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
              <MenuNav
                view={current.view}
                onNavigate={navigate}
                unreadTotal={unread.total}
                onToggleNotifications={toggleNotifications}
              />
              <ThreadScreen chatId={current.params.chatId} onBack={goBack} />
            </AppShell>
          </Suspense>
        </PageTransition>
      )}

      {!authActive && current.view === 'profile' && (
        <PageTransition key={current.key}>
          <Suspense fallback={SuspenseFallback}>
            <AppShell>
              <MenuNav
                view={current.view}
                onNavigate={navigate}
                unreadTotal={unread.total}
                onToggleNotifications={toggleNotifications}
              />
              <ProfileScreenWrapper onBack={goBack} />
            </AppShell>
          </Suspense>
        </PageTransition>
      )}

      {!authActive && current.view === 'home' && (
        <PageTransition key={current.key}>
          <AppShell>
            <MenuNav
              view={current.view}
              onNavigate={navigate}
              unreadTotal={unread.total}
              onToggleNotifications={toggleNotifications}
            />
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