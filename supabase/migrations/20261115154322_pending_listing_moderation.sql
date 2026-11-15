-- Премодерация объявлений, шаг 2/2: поведение модерации.
--
-- Требует 20261115154312_add_pending_listing_status.sql (значение 'pending' должно
-- быть добавлено отдельной предыдущей миграцией).
--
-- Модель жизненного цикла:
--   создание клиентом  -> 'pending'  (не видно в публичной ленте)
--   одобрение          -> 'active'   (только модератор: service_role / SQL-консоль)
--   отклонение         -> 'rejected' (только модератор)
--   архивация автором  -> 'archived' (разрешена самому автору)
--
-- Существующие 35 объявлений остаются 'active': данных этот файл не меняет.

-- 1. Новое объявление по умолчанию всегда создаётся на модерации.
alter table public.listings
  alter column status set default 'pending'::public.listing_status;

-- 2. Клиент имеет право вставить объявление ТОЛЬКО в статусе 'pending'.
--    (Старая политика "Users create their own active listings" требовала
--    status = 'active', то есть публиковала объявление сразу и без проверки.)
drop policy if exists "Users create their own active listings" on public.listings;

create policy "Users create their own pending listings"
  on public.listings
  for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and status = 'pending'::public.listing_status
  );

-- 3. Защита от самопубликации: автор не может поднять себе статус.
--
-- ТОЧНОЕ ПРАВИЛО (BEFORE UPDATE FOR EACH ROW, построчно):
--   a) new.status is not distinct from old.status  -> ничего не делаем;
--   b) привилегированный вызов — GUC 'role' НЕ клиентский (не 'authenticated',
--      не 'anon', не пусто) и роль из JWT тоже не клиентская: это service_role
--      (запрос с service key) или прямое подключение без SET ROLE ('none' —
--      SQL-консоль модератора):
--      смена статуса разрешена в ЛЮБУЮ сторону (pending -> active, active ->
--      rejected, archived -> active и т.д.) и логируется в public.moderation_audit;
--   c) непривилегированная роль (клиент JWT = авторизованный пользователь):
--      разрешен ровно один переход —
--          old.status in ('active', 'pending') AND new.status = 'archived'
--      И ТОЛЬКО для своего объявления (old.author_id = auth.uid()),
--      т.е. автор снимает своё объявление с публикации;
--      запрещены и молча откатываются (new.status := old.status) любые другие
--      переходы, в первую очередь pending -> active и rejected -> active;
--      остальные колонки строки обновляются как обычно;
--   d) откат сделан молча (без RAISE), чтобы случайный/злоумышленный status в
--      обычном UPDATE-запросе не ломал редактирование объявления.
--
-- Как определяется роль (проверено по исходникам PostgreSQL):
--   * GUC 'role' (`current_setting('role', true)`) ставит PostgREST для каждого
--     запроса: 'authenticated' / 'anon' / 'service_role' (всё через
--     `set local role ...`). Прямое подключение без SET ROLE (SQL-консоль,
--     psql под postgres/supabase_admin) даёт 'none' — show_role() возвращает
--     "none", когда SET ROLE не выполнялся вовсе.
--   * current_user внутри функции НЕ подходит: функция SECURITY DEFINER,
--     поэтому current_user = владелец функции (postgres) для любого вызывающего.
--   * Дополнительно смотрим на роль из JWT (`auth.jwt() ->> 'role'`): это
--     клиентский сигнал, который нельзя подделать через возню с GUC 'role'.
--   * Пустой GUC ('') трактуется как непривилегированный доступ (fail closed).
--   * Если auth.jwt() недоступна — ошибка перехватывается, и решение принимается
--     только по GUC 'role' (консоль без JWT остаётся привилегированной).
create or replace function private.guard_listing_status_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce(nullif(current_setting('role', true), ''), '');
  v_jwt_role text;
  v_privileged boolean;
  v_author_archive boolean;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  begin
    v_jwt_role := coalesce(auth.jwt() ->> 'role', '');
  exception when others then
    -- Нет доступа к claims: опираемся только на GUC 'role'.
    v_jwt_role := '';
  end;

  v_privileged := v_role not in ('', 'authenticated', 'anon')
    and v_jwt_role not in ('authenticated', 'anon');

  -- coalesce обязателен: без JWT (auth.uid() is null) сравнение дало бы NULL,
  -- а NOT NULL тоже NULL — триггер бы «разрешил» смену статуса (fail open).
  v_author_archive := coalesce(
    not v_privileged
    and old.author_id = (select auth.uid())
    and new.status = 'archived'::public.listing_status
    and old.status in ('active'::public.listing_status, 'pending'::public.listing_status),
    false
  );

  if not (v_privileged or v_author_archive) then
    -- Самопубликация запрещена: оставляем прежний статус.
    new.status := old.status;
    return new;
  end if;

  -- 4. Журнал модерации. Таблица рассчитана на service_role-вставки
  --    (202607190003_moderation_audit.sql: RLS включена, прав у
  --    anon/authenticated нет), поэтому вставка идёт только реально
  --    применённой смены статуса и обёрнута в подблок: нехватка прав не должна
  --    отменять UPDATE объявления. Перечисляются только существующие колонки
  --    (moderator_id, action, target_type, target_id, note).
  begin
    insert into public.moderation_audit (
      moderator_id,
      action,
      target_type,
      target_id,
      note
    ) values (
      (select auth.uid()),
      'listing_status_change',
      'listing',
      old.id,
      'status: ' || old.status::text || ' -> ' || new.status::text
        || '; role: ' || case when v_privileged then v_role else 'author' end
    );
  exception when insufficient_privilege then
    null;
  end;

  return new;
end;
$$;

revoke all on function private.guard_listing_status_update() from public;

drop trigger if exists listings_guard_status_update on public.listings;

create trigger listings_guard_status_update
  before update on public.listings
  for each row execute function private.guard_listing_status_update();

-- 3b. Существующий триггер private.prepare_listing_update() (миграция 0001)
--     поднимал исключение на ЛЮБУЮ смену статуса пользователем, включая
--     разрешённое автором снятие в архив. Проверку статуса из него убираем:
--     теперь за статус целиком отвечает guard_listing_status_update().
--     Остальные проверки (author_id, created_at, запрет восстановления из
--     архива, проставление deleted_at/updated_at) сохранены без изменений.
create or replace function private.prepare_listing_update()
returns trigger
language plpgsql
set search_path = ''
as $$
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL THEN
    IF NEW.author_id IS DISTINCT FROM OLD.author_id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'author_id and created_at cannot be changed by a user';
    END IF;

    IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      RAISE EXCEPTION 'an archived listing cannot be restored by a user';
    END IF;

    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      NEW.deleted_at := now();
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- 5. Жизненный цикл статуса — в описание колонки.
comment on column public.listings.status is
  'pending -> на премодерации, видно только автору (default при создании); '
  'active -> одобрен модератором (service_role), виден в публичной ленте; '
  'rejected -> отклонён модератором; archived -> снят с публикации. '
  'Смену статуса контролирует триггер listings_guard_status_update: '
  'автору разрешён только переход active|pending -> archived, '
  'одобрение pending|rejected -> active выдаёт только привилегированный вызов '
  '(service_role или SQL-консоль модератора). '
  'Факт смены пишется в public.moderation_audit.';
