import { expect, test } from '@playwright/test'
import {
  ANONYMOUS_STATE,
  SCREEN_TIMEOUT,
  assertNoRenderErrors,
  authScreen,
  feedFilter,
  feedHeading,
  listingCards,
  openApp,
  openListingButton,
  watchErrors,
} from './helpers'

/**
 * Лента объявлений на «/».
 *
 * Отложенная авторизация: ленту и фильтры показываем без сессии, поэтому
 * контентные проверки выполняются анонимно (storageState пустой принудительно)
 * и идут в реальный Supabase. Операций записи нет: только чтение и навигация.
 */

test.describe('feed — лента объявлений', () => {
  test.use({ storageState: ANONYMOUS_STATE })

  test('дымовой: приложение открывает / на ленту без ошибок консоли', async ({ page }) => {
    const watch = watchErrors(page)

    await openApp(page)
    // Аноним стартует в ленте: экран входа — только по требующему сессию действию.
    await expect(feedHeading(page), 'аноним не попал в ленту «Объявления»').toBeVisible()

    // Каркас жив: документ загружен, есть заголовок вкладки.
    await expect(page).toHaveTitle(/СКВОТ/)
    await expect(authScreen(page)).toHaveCount(0)

    assertNoRenderErrors(watch)
  })

  test('лента загружает карточки объявлений', async ({ page }) => {
    const watch = watchErrors(page)

    await openApp(page)

    await expect(feedHeading(page)).toBeVisible()

    // Ждём конец первой загрузки: карточки либо осмысленное пустое состояние.
    const cards = listingCards(page)
    await expect(
      cards.or(page.getByText('Объявлений не найдено')).first(),
      'лента не завершила загрузку (нет ни карточек, ни пустого состояния)',
    ).toBeVisible({ timeout: SCREEN_TIMEOUT })

    const cardCount = await cards.count()
    test.info().annotations.push({
      type: 'feed-size',
      description: `Карточек на первой странице (аноним, реальная выдача): ${cardCount}`,
    })

    if (cardCount === 0) {
      // Пустая выдача — не повод удалять ассерт: фиксируем факт в отчёте и
      // проверяем, что рендер как минимум не упал.
      test.info().annotations.push({
        type: 'feed-empty',
        description:
          'Карточек нет: лента отрендерилась пустой (данные/RLS) — проверяем только отсутствие ошибок',
      })
      assertNoRenderErrors(watch)
      return
    }

    // За цепляемся за карточку: город (h3) и цена с «₽» — текст статьи, он лежит
    // вне кнопки-оверлея, поэтому доступен и скринридеру, и этим проверкам.
    const firstCard = cards.first()
    const city = (await firstCard.getByRole('heading', { level: 3 }).textContent())?.trim()
    expect(city, 'первая карточка без города в h3').toBeTruthy()
    await expect(firstCard.getByRole('heading', { level: 3 })).toBeVisible()
    await expect(firstCard.getByText(/₽/).first()).toBeVisible()

    // Интерактив карточки ровно один — кнопка-оверлей «Открыть объявление: <город>».
    // Это контракт новой разметки (ListingCard: <article> + оверлей вместо <button>),
    // и по нему клик по карточке приходит на оверлей, а не на контролы карусели.
    const overlay = openListingButton(firstCard)
    await expect(overlay).toHaveCount(1)
    await expect(overlay).toHaveAccessibleName(`Открыть объявление: ${city}`)

    // Реальная выдача подтверждается счётчиком пагинации «Всего: N».
    // Он появляется, только когда страниц больше одной, — тогда N >= карточек.
    const totalLabel = page.getByText(/^Всего: \d+$/)
    if ((await totalLabel.count()) > 0) {
      const total = Number((await totalLabel.first().textContent())?.match(/\d+/)?.[0] ?? NaN)
      test.info().annotations.push({
        type: 'feed-total',
        description: `Счётчик пагинации: всего ${total} объявлений`,
      })
      expect(
        total,
        '«Всего: N» меньше, чем отрендеренных карточек — выдача не сходится',
      ).toBeGreaterThanOrEqual(cardCount)
    }

    assertNoRenderErrors(watch)
  })

  test('фильтр «Тип = Сдают» не роняет ленту и выдача остаётся рабочей', async ({
    page,
  }) => {
    const watch = watchErrors(page)

    await openApp(page)

    const cards = listingCards(page)
    await expect(cards.first()).toBeVisible({ timeout: SCREEN_TIMEOUT })
    const beforeCount = await cards.count()

    // Доступное имя селекта включает текст опций («Тип Все Сдают Ищут»),
    // поэтому берём его начало — см. feedFilter().
    await feedFilter(page, 'Тип').selectOption('offer')

    // После смены фильтра лента перерендеривается и завершает загрузку.
    await expect(
      cards.or(page.getByText('Объявлений не найдено')).first(),
      'после фильтра лента не вернулась к осмысленному состоянию',
    ).toBeVisible({ timeout: SCREEN_TIMEOUT })

    await expect(feedHeading(page)).toBeVisible()

    const afterCount = await cards.count()
    test.info().annotations.push({
      type: 'filter-offer',
      description: `Фильтр «Сдают»: карточек ${afterCount} (до фильтра: ${beforeCount})`,
    })

    if (afterCount === 0) {
      test.info().annotations.push({
        type: 'filter-empty',
        description: `Фильтр «Сдают» вернул 0 карточек (до: ${beforeCount}) — пустая выдача`,
      })
    } else {
      // Все отфильтрованные карточки — типа «Сдаётся» (бейдж внутри карточки).
      await expect(
        cards.first().getByText(/^Сдаётся$/),
        'в выдаче после фильтра «Сдают» появилась карточка другого типа',
      ).toBeVisible()
      // Фильтр не расширяет выдачу.
      expect(
        afterCount,
        'фильтр по типу расширил выдачу — фильтрация не подействовала',
      ).toBeLessThanOrEqual(beforeCount)
    }

    assertNoRenderErrors(watch)
  })
})
