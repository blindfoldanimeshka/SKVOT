# Прогресс реализации MVP «напрямую»

Отслеживаем выполнение roadmap из `technical-specification-roadmap.md`.
Статус обновляется после каждого завершённого вертикального среза.

| Фаза | Результат | Статус | Заметки |
|---|---|---|---|
| 0. Инвентаризация | Понятная стартовая точка | ✅ | `.env` не в git; старый код удалён; новый стек (React 19 + Vite + TS + Tailwind 4 + Zod) на месте |
| 1. Основание | Безопасная пустая сборка | ✅ | Сборка собирается, lint/typecheck/test зелёные |
| 2. Миграция БД и RLS | Надёжная модель доступа | ✅ | `202607190001_initial_secure_schema.sql` накатана на проект `MVP-House`; прямые INSERT в chats/chat_participants закрыты; RPC `open_or_create_chat` |
| 3. Auth и профиль | Безопасный вход | ✅ | `AuthProvider`, `AuthScreen`, `ProfileScreen`; 18 тестов; email-confirmation guard на клиенте |
| 4. Объявления | Сквозной CRUD | ✅ | Feed (публичная лента с фильтрами/пагинацией), создание/редактирование/архив своих объявлений, детальный просмотр; `author_id` только из сессии; 36 тестов |
| 5. Фото | Безопасные изображения | ✅ | Bucket `listing-photos` (публичный, ≤10MB, JPEG/PNG/WebP), таблица `listing_images`, Storage RLS (только автор), PhotoUploader (≤10 фото, валидация типа/размера, путь `listing/{id}/{uuid}`); 49 тестов |
| 6. Чат | Связь между пользователями | ✅ | RPC `open_or_create_chat` (атомарно), ChatList, Thread (realtime + polling-fallback), кнопка «Написать» в деталях; `sender_id` из сессии; 68 тестов |
| 7. Жалобы и финальная защита | Контролируемая beta | ✅ | UI «Пожаловаться» (объявление+чат), таблица `moderation_audit` (только service role), security-review.md с RLS-матрицей; 83 теста; единственный lint-ворнинг (`open_or_create_chat` SECURITY DEFINER) — намеренный и безопасный |
| 3b. Отложенная ч. фазы 3 | Безопасный вход (юр./reset) | ✅ | Reset password (`resetPasswordForEmail`), legal pages (Privacy/Terms, заглушка 152-ФЗ), чекбокс согласия при регистрации; 90 тестов. **TODO (требует внешних ключей/решения): CAPTCHA (hCaptcha/Turnstile) и собственный SMTP** |
| 3c. Снятие стены входа | Отложенная авторизация для гостя | ✅ | Убран жёсткий гейт `!session → AuthScreen`; гость читает ленту, карточку объявления и legal; вход требуется только на действиях (`authIntent` + `resume: 'chat'` в `src/app/App.tsx`), `openOrCreateChat`/`createReport` и realtime-подписки у анонима не стреляют; миграций не потребовалось (RLS «Public sees active listings» уже на месте). Spec: `docs/superpowers/specs/2026-11-15-deferred-auth-access-design.md`. Тема коммита: `feat(auth): remove login wall — guest access to feed, listing, legal` |
| 8. Редизайн профиля | 4-вкладочный ProfilePage | ✅ | Личные данные / Аккаунт / Подключения / Действия; typecheck/lint/tests зелёные; settings и connections — пока локальный UI без бэкенда |

### Решения, требующие участия пользователя (не сделано автономно)

> ⛔ **CAPTCHA, собственный SMTP и юридическая проверка 152-ФЗ — блокеры
> публичного запуска, а не «сделаем потом».** Бета-гейт снят
> (миграция `20261115152139`), проект открывается для всех: лента публична
> для анонимов уже сейчас (инвариант 1 в `docs/backend-analysis.md`,
> `docs/superpowers/specs/2026-07-19-listings-design.md`), а вход нужен
> только на действиях (публикация, чат, жалоба). Все три задачи раньше
> разрешалось не делать на этапе закрытого набора — такого этапа больше нет.

- **CAPTCHA** (блокер пуска): нужен провайдер (hCaptcha или Cloudflare Turnstile) + sitekey/secret. Без ключей не включается, а открытая форма регистрации без серверной проверки токена = флуд аккаунтами и спам-объявлениями. Фронтенд-хук под Turnstile можно добавить, когда будут env-ключи.
- **Собственный SMTP** (блокер пуска): для production по ТЗ §4.1 нужен выделенный SMTP — встроенная отправка Supabase имеет демонстрационные лимиты, из-за чего часть пользователей не получит письмо подтверждения и встанет на `email-confirmation guard`. Решение за пользователем.
- **Юридическая проверка 152-ФЗ** (блокер пуска): тексты Privacy/Terms — шаблоны-заглушки, требуют реальной проверки перед публичным РФ-запуском (ТЗ §6) плюс решения по инфраструктуре ПДн (`docs/out-of-code/03-152fz.md`, раздел 1). ПДн начинают собираться с первого зарегистрированного пользователя.
- **Кнопка удаления аккаунта (фаза 8 / 152-ФЗ §3.2)**: реализована — Edge Function `delete-account` (service_role, каскадное удаление `auth.users` → `public.users` → `listings`/`chats`/`messages`/`reports` настроено миграцией 001 через `ON DELETE CASCADE`). Требует деплоя функции (`supabase functions deploy delete-account`).
- **Инвайт-коды убраны.** Бета-гейт удалён 2026-11-15 (миграция `20261115152139_remove_beta_invites.sql`): регистрация открыта, таблица `invites` и RPC `is_invite_valid` / `invite_status` / `claim_invite` удалены.

## Security hardening (post-review)

- `202607190004_security_hardening.sql` накатана на проект `MVP-House`:
  - лимит ≤10 фото/объявление принудительно на уровне БД (триггер `listing_images_limit`);
  - валидация пути `private.listing_id_from_path` через regex (защита от путей-инъекций);
  - Realtime RLS включён для `messages` и `chats` (`supabase_realtime`).
- Документация синхронизирована с миграциями: `supabase/schema.sql` помечен DEPRECATED,
  `docs/security-review.md` отражает RPC-only создание чатов (без прямого INSERT).

## Решения, зафиксированные в ходе работы

- **Стек — Supabase, без Next.js/NestJS/Prisma.** Согласно roadmap §1; `docs/out-of-code/plan-legacy-nextjs.md`
  предлагает альтернативу (Telegram + Next.js), но roadmap имеет приоритет и код
  уже построен на Supabase Auth.
- **`listing_status` без `pending`.** В текущей схеме объявление создаётся как
  `active`. Ручная модерация (ТЗ §4.5) потребует добавления `pending` отдельной
  миграцией — пока не реализуем (YAGNI до появления модератора).
- **`.env` использует `VITE_SUPABASE_PUBLISHABLE_KEY`** (каноничное имя из ТЗ §3),
  совпадает с `src/lib/env.ts`.
