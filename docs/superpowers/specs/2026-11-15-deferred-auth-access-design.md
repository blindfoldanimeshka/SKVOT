# Design: Deferred Auth — снятие стены входа для гостя

- Date: 2026-11-15
- Status: implemented
- Roadmap ref: technical-specification-roadmap.md §4.2 (публичная лента),
  `docs/backend-analysis.md` §2 (RLS-матрица: `listings`/`listing_images`
  уже SELECT-доступны `anon`)
- Depends on: Phase 3 (auth), Phase 4 (listings), Phase 6 (chat)
- Not to be confused with: `2026-07-19-deferred-auth-design.md` — тот файл
  про «отложенную часть фазы 3» (legal pages / consent / password reset),
  а не про доступ анонимов.

## Goal

Раньше `App.tsx` ставил жёсткий гейт: без сессии показывался только
`AuthScreen` — это был остаток закрытой беты. Теперь публичная часть
(лента, карточка объявления, legal-страницы) читается гостем; вход
требуют только действия (подать объявление, написать автору,
пожаловаться, открыть чат/профиль). Реализация клиентская, миграции
не потребовались — бэкенд уже позволял чтение анонимом.

## Scope (YAGNI)

- Не меняем RLS: «Public sees active listings» + «Public reads listing
  images» + публичный бакет `listing-photos` уже в схемах
  `202607190001` / `202607190002`.
- Не трогаем `record_listing_view` — RPC по-прежнему выдана только
  `authenticated` (`202607201025_f5_listing_stats.sql`); для анонима
  вызов завершается permission denied (см. Risks).
- Не делаем гостевые объявления / лиды по телефону (Out of scope).
- Не вводим серверный/edge-редирект: приложение остаётся SPA, гейт
  только клиентский. RLS — второй слой, он не отменяется.

## Success criteria

1. Аноним открывает приложение и сразу видит `HomeFeed` с фильтрами,
   пагинацией и обложками фото (картинки из публичного бакета).
2. Аноним открывает карточку объявления: фото/описание/цена/карта —
   всё видно, CTA «Написать автору» виден и кликабелен.
3. Клики по «Новое» / «Мои» / «Чаты» / «Профиль» в доке и по CTA
   «Написать автору» / «Пожаловаться» без сессии не шлют запросы в
   Supabase — вместо них открывается `AuthScreen` как обычный view
   с кнопкой «← Назад» и подсказкой («Войдите, чтобы …»).
4. Legal-страницы (`/privacy`, `/terms`) доступны анониму и остаются
   view-поверх: ссылка «Политика конфиденциальности» из формы входа
   работает, не теряя текущий экран.
5. После успешного входа: пользователя возвращает на исходный экран
   (`push(intent.view, intent.params)`); если намерение имело
   `resume: 'chat'`, чат открывается автоматически, как только
   загрузятся данные объявления.
6. Баннер «Подтвердите email» не показывается анониму — только
   залогиненному пользователю без `email_confirmed_at`.
7. Realtime/счётчики не подписываются без `user`
   (`useUnreadCounts`, `useNotifications`).

## Architecture

### Состояние `authIntent`

`src/app/App.tsx`:

```ts
type AuthResume = 'chat' | null
interface AuthIntent {
  view: View            // куда вернуться после входа
  params?: NavParams     // с какими параметрами (объявление/чат)
  hint: string          // подсказка над формой входа
  resume?: AuthResume   // какое действие продолжить автоматически
}
const AUTH_VIEW_HINTS: Partial<Record<View, string>> = { ... }
```

Заполняется в двух местах:

- **Навигация по доке** — `navigate(view)`: если сессии нет и у view
  есть подсказка в `AUTH_VIEW_HINTS`, ставим intent на целевой view
  (`new` / `mine` / `chats` / `profile` / `thread`) без `resume`.
  Колокольчик (`toggleNotifications`) тоже идёт через intent на
  `chats`.
- **Экранные действия** — `requestAuth({ hint, resume })` пробрасывается
  в `ListingDetail` (и через него в `ReportButton`); без сессии
  сохраняем `current.view` + `current.params` и ставим `resume: 'chat'`
  для «Написать автору». `createReport` / `openOrCreateChat` в этот
  момент не вызываются.

### AuthScreen как view, а не блокирующий оверлей

```
authActive =
  !session && (authIntent !== null || AUTH_VIEW_HINTS[current.view]) &&
  current.view !== 'privacy' && current.view !== 'terms'
```

Когда `authActive`, `AppContent` рендерит `<AuthScreen hint onBack
onOpenLegal>` вместо защищённого контента. `onBack` снимает intent
(«← Назад»), `onOpenLegal('privacy' | 'terms')` уходит в legal-view
поверх — форма входа не теряет свой экран.

### Возврат после входа и `resumeChat`

Один эффект:

```
useEffect(() => {
  if (!session || !authIntent) return
  const intent = authIntent
  setAuthIntent(null)
  if (intent.view !== current.view) push(intent.view, intent.params)
  if (intent.resume === 'chat') setResumeChat(true)
}, [session, authIntent, current.view, current.params, push])
```

Флаг `resumeChat` привязан к конкретной записи стека: отдельный эффект
снимает его при смене `current.key`. Второй эффект в `logout`-ветке
сбрасывает и `authIntent`, и `resumeChat`, поэтому осиротевшее
намерение из прежней сессии не стреляет позже.

Сам чат открывает не App, а `ListingDetail`: `resumeStartChat=true`
(проброшено из App) + `listing` загружен + `user` есть → однократно
(защита через `resumeHandledRef`) вызывается `handleStartChat`. Это
нужно, чтобы RPC попал уже на готовую страницу с актуальными
`listing.id`/`author_id`.

### Ключевые инварианты

1. **Аноним не делает ни одной записи.** Все write-пути
   (`openOrCreateChat`, `createReport`, публикация/редактирование
   листинга) закрыты либо ранним выходом с `requireAuth`, либо —
   второй слой — RLS для роли `anon` (см. `docs/backend-analysis.md`).
2. **Гейт только на клиенте, RLS — страховка.** Клиент не шлёт запрос,
   но и при прямом вызове RPC Supabase его отклонит: `chats`,
   `chat_participants`, `reports` не имеют ни одной anon-политики.
3. `resumeChat` живёт ровно на одной stack-записи и снимается
   при `logout`, при уходе с экрана и после первого срабатывания.
4. `privacy` / `terms` — всегда обычные view. Они не считаются
   «требующими входа», поэтому legal-подвал формы входа не уходит в
   саму форму.

### Баннер «Подтвердите email»

`src/app/screens/HomeFeed.tsx` получил `isAuthenticated` и
`userEmailConfirmed`; баннер оборачивается условием
`isAuthenticated && !userEmailConfirmed`. Аноним не видит «подтвердите
email» — ему нечего подтверждать.

## Out of scope (не делаем сейчас)

- **Гостевые объявления без аккаунта.** Нет автора, нет модерации,
  нет способа ответственности — ломает §4.2 ТЗ.
- **Лиды по телефону / показ телефона автора гостю.** Требует
  телефонной интеграции, анти-фрода и юридической рамки; не MVP.
- **Серверный edge-редирект / SSR-проверка сессии.** Приложение
  остаётся SPA, гейт — только в клиентском view-state.
- **CAPTCHA при регистрации / публичном чтении.** Отдельный блокер
  (`docs/out-of-code/01-captcha.md`), не часть этой задачи.

## Risks

- **Спам просмотров / шум в логах.** `Feed.handleOpen` безусловно
  вызывает `recordListingView(id)` — и для гостя тоже. RPC
  `record_listing_view` по grants (`202607201025_f5_listing_stats.sql`)
  доступна только `authenticated`, поэтому вызов от анонима
  завершается `permission denied`: счётчик не растёт (побочный
  эффект — просмотры гостей сейчас не учитываются), но запрос
  виден в сетевых логах и метриках Supabase. Следующий шаг, если
  захотим считать гостей, — отдельная миграция + rate-limit,
  иначе счётчик превращается в спам-вектор.
- **Отсутствие CAPTCHA.** Публичная лента + открытая регистрация
  без hCaptcha/Turnstile — риск автоматического перебора и спам-
  объявлений. См. `docs/progress.md` §«Решения, требующие участия
  пользователя».
- **Отсутствие серверного rate-limit для anon-чтения.** Supabase
  default-анон-ключ ограничивает QPS; при реальном всплеске
  придётся думать об edge-кэше ленты — не сейчас.
- **Юридическая рамка.** Legal-страницы сейчас шаблон-заглушка под
  152-ФЗ; пока аноним их читает без аккаунта, ПДн не собираются,
  но это не снимает блокер проверки текстов.

## Testing (qa-engineer)

- `src/app/App.test.tsx` — «anonymous user sees the feed instead of
  the login gate»; «gated dock action … opens login with a hint, and
  «← Назад» returns to the feed»; «after sign-in returns to the screen
  the anonymous user asked for».
- `src/features/auth/AuthScreen.test.tsx` — «shows the hint and
  «← Назад» when rendered as a deferred-auth view»; «keeps the old
  full-screen gate (no back button) when `onBack` is not passed».
- `src/features/listings/ListingDetail.test.tsx` — «shows «Написать
  автору» to an anonymous user and asks for login instead of calling
  Supabase»; «asks for login on «Пожаловаться» without opening the
  form or sending a report»; «`resumeStartChat` auto-continues the
  action after login, once the listing is loaded».
- `src/app/screens/HomeFeed.test.tsx` — «hides the email banner for
  anonymous users»; «shows the email banner for a logged-in
  unconfirmed user».
- `tests/features/chat/useUnreadCounts.test.tsx` — «does not subscribe
  to realtime for anonymous users».

## Rollout

Изменение живёт в `src/app/App.tsx` + точечных правках
`AuthScreen.tsx`, `ListingDetail.tsx`, `ReportButton.tsx`,
`HomeFeed.tsx`, `useUnreadCounts.ts`, `useNotifications.ts` —
миграций нет, схема не менялась. Ожидаемая тема коммита:
`feat(auth): remove login wall — guest access to feed, listing, legal`.
Лог запуска не меняется: `npm run lint` / `typecheck` / `test`.
