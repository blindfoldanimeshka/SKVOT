-- Снятие бета-гейта по решению владельца: регистрация открыта всем.
-- Таблица public.invites удаляется вместе с историей инвайт-кодов
-- (будет забэкаплена перед применением).
-- Порядок обязателен: функции зависят от таблицы.

drop function if exists public.claim_invite(text, uuid);
drop function if exists public.invite_status(text);
drop function if exists public.is_invite_valid(text);

drop table if exists public.invites;
