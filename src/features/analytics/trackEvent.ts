import { getSupabaseClient } from '@/lib/supabase'

export type FunnelEvent =
  | 'view_listing'
  | 'open_chat'
  | 'send_message'
  | 'create_listing'
  | 'complete_deal'
  | 'boost_listing'

/**
 * Fire-and-forget funnel event. Errors are swallowed (warn only) so analytics
 * never breaks the user's flow. The server validates event_type and stamps
 * the real user_id from the session JWT.
 *
 * Гостевые события не отправляем намеренно: сервер берёт user_id только из
 * проверенного JWT, а гостевой аналитики у нас нет (funnel_events.user_id —
 * NOT NULL). Раньше клик гостя по карточке в ленте (Feed.handleOpen зовёт
 * trackEvent для каждого просмотра) уходил на функцию без токена: это давало
 * бесполезный 401 и CORS-предупреждения в консоли на каждый такой клик.
 */
export async function trackEvent(
  eventType: FunnelEvent,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    const supabase = getSupabaseClient()

    // Нет сессии — тихо выходим, не поднимая шума в консоли.
    const { data } = await supabase.auth.getSession()
    if (!data.session) return

    await supabase.functions.invoke('track-event', {
      body: { event_type: eventType, payload: payload ?? null },
    })
  } catch (err) {
    console.warn('trackEvent failed', err)
  }
}
