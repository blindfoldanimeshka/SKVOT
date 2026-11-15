-- F3 (лимит 5 объявлений в месяц) перестал срабатывать после введения
-- премодерации: триггер enforce_listing_limit() срабатывал только при
-- NEW.status = 'active' на INSERT, а клиент теперь всегда создаёт 'pending'.
--
-- Исправление: лимит считается по объявлениям в статусах active/pending
-- (то есть и одобренные, и ожидающие проверки) и проверяется при создании
-- в любом из этих статусов.

create or replace function private.count_listings_this_month(p_author uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from public.listings l
  where l.author_id = p_author
    and l.status in ('active'::public.listing_status, 'pending'::public.listing_status)
    and l.deleted_at is null
    and l.created_at >= date_trunc('month', now())
$$;

revoke all on function private.count_listings_this_month(uuid) from public;

create or replace function public.enforce_listing_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
BEGIN
  IF NEW.status IN ('active'::public.listing_status, 'pending'::public.listing_status)
     AND NEW.deleted_at IS NULL THEN
    IF private.count_listings_this_month(NEW.author_id) >= 5 THEN
      RAISE EXCEPTION 'listing_limit_exceeded: max 5 listings per month'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
