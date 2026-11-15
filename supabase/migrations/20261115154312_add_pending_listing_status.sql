-- Премодерация объявлений, шаг 1/2: в enum public.listing_status добавляется
-- значение 'pending' (новое объявление ждёт проверки модератором).
--
-- В этом файле ТОЛЬКО ALTER TYPE ... ADD VALUE: значение enum запрещено
-- использовать в тех же транзакции/миграции, где оно добавлено, поэтому весь
-- код, который ссылается на 'pending', живёт в
-- 20261115154322_pending_listing_moderation.sql.
--
-- Существующие объявления не затрагиваются: все они остаются 'active'.

alter type public.listing_status add value if not exists 'pending' before 'archived';
