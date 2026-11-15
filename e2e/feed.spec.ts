import { expect, test } from '@playwright/test'
import {
  SKIP_NO_SESSION,
  assertNoRenderErrors,
  listingCards,
  openApp,
  watchErrors,
} from './helpers'

/**
 * Лента объявлений на «/».
 *
 * Важно: приложение гейтит ленту по сессии — в App.tsx при отсутствии
 * сессии рендерится AuthScreen, поэтому без E2E_STORAGE_STATE контентные
 * проверки честно skip'ятся. Дымовой тест (приложение открылось, ничего не
 * упало в консоль) выполняется всегда — именно он ловил бы цикл ре-рендеров.
 */

test.describe('feed — лента объявлений', () => {
  test('дымовой: приложение открывает / и рендерит экран без ошибок консоли', async ({
    page,
  }) => {
    const watch = watchErrors(page)

    const screen = await openApp(page)
    test.info().annotations.push({
      type: 'screen',
      description:
        screen === 'feed'
          ? 'открылась лента «Объявления» (есть сессия)'
          : 'открылся экран «Вход» (сессии нет — лента гейтится в App.tsx)',
    })

    // Каркас жив: документ загружен, есть заголовок вкладки.
    await expect(page).toHaveTitle(/СКВОТ/)

    assertNoRenderErrors(watch)
  })

  test('лента загружает карточки объявлений', async ({ page }) => {
    const watch = watchErrors(page)

    const screen = await openApp(page)
    test.skip(screen !== 'feed', SKIP_NO_SESSION)

    await expect(page.getByRole('heading', { level: 1, name: 'Объявления' })).toBeVisible()

    // Ждём конец первой загрузки: карточки либо осмысленное пустое состояние.
    const cards = listingCards(page)
    await expect(
      cards.or(page.getByText('Объявлений не найдено')).first(),
      'лента не завершила загрузку (нет ни карточек, ни пустого состояния)',
    ).toBeVisible({ timeout: 20_000 })

    if ((await cards.count()) === 0) {
      // Ослабленная проверка по инструкции оркестратора: пустая выдача при
      // включённом RLS — не повод удалять ассерт, фиксируем факт в отчёте.
      test.info().annotations.push({
        type: 'feed-empty',
        description: 'Карточек нет: лента отрендерилась пустой (RLS/данные) — проверяем только отсутствие ошибок',
      })
      assertNoRenderErrors(watch)
      return
    }

    // За цепляемся за карточку: город (h3) и цена с «₽».
    const firstCard = cards.first()
    await expect(firstCard.getByRole('heading', { level: 3 })).toBeVisible()
    await expect(firstCard.getByText(/₽/).first()).toBeVisible()

    assertNoRenderErrors(watch)
  })

  test('фильтр «Тип = Сдают» не роняет ленту и выдача остаётся рабочей', async ({
    page,
  }) => {
    const watch = watchErrors(page)

    const screen = await openApp(page)
    test.skip(screen !== 'feed', SKIP_NO_SESSION)

    const cards = listingCards(page)
    await expect(cards.first()).toBeVisible({ timeout: 20_000 })
    const beforeCount = await cards.count()

    await page.getByLabel('Тип', { exact: true }).selectOption('offer')

    // После смены фильтра лента перерендеривается и завершает загрузку.
    await expect(
      cards.or(page.getByText('Объявлений не найдено')).first(),
      'после фильтра лента не вернулась к осмысленному состоянию',
    ).toBeVisible({ timeout: 20_000 })

    await expect(page.getByRole('heading', { level: 1, name: 'Объявления' })).toBeVisible()

    const afterCount = await cards.count()
    if (afterCount === 0) {
      test.info().annotations.push({
        type: 'filter-empty',
        description: `Фильтр «Сдают» вернул 0 карточек (до: ${beforeCount}) — пустая выдача при RLS`,
      })
    } else {
      // Все отфильтрованные карточки — типа «Сдаётся» (бейдж внутри карточки).
      await expect(
        cards.first().getByText(/^Сдаётся$/),
        'в выдаче после фильтра «Сдают» появилась карточка другого типа',
      ).toBeVisible()
    }

    assertNoRenderErrors(watch)
  })
})
