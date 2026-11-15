import { type ReactElement } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { PersonalInfoTab } from './PersonalInfoTab'
import { SettingsTab } from './SettingsTab'
import { ConnectionsTab } from './ConnectionsTab'
import { DangerTab } from './DangerTab'
import { OrganizationsTab } from './OrganizationsTab'
import { useNavEntryState } from '@/app/navigation/useNavEntryState'

type TabId =
  | 'personal'
  | 'settings'
  | 'connections'
  | 'organizations'
  | 'danger'

/**
 * Все вкладки профиля вместе с признаком готовности. В таб-лист попадает только
 * то, что действительно умеет своё основное действие (`hidden` не задан):
 * нерабочие вкладки скрываем до готовности, а сам компонент и его контент
 * оставляем в TAB_CONTENT — чтобы включить вкладку, достаточно убрать `hidden`.
 */
const ALL_TABS: { id: TabId; label: string; hidden?: boolean }[] = [
  { id: 'personal', label: 'Личные данные' },
  { id: 'settings', label: 'Аккаунт' },
  // Подключение: все кнопки привязки захардкожены `disabled` («Скоро»),
  // OAuth-провайдеры в Supabase не настроены → нажать «Подключить» нельзя.
  { id: 'connections', label: 'Подключения', hidden: true },
  { id: 'organizations', label: 'Организации' },
  { id: 'danger', label: 'Действия' },
]

const TABS = ALL_TABS.filter((tab) => !tab.hidden)

const TAB_CONTENT: Record<TabId, () => ReactElement> = {
  personal: PersonalInfoTab,
  settings: SettingsTab,
  connections: ConnectionsTab,
  organizations: OrganizationsTab,
  danger: DangerTab,
}

/** Дефолтная вкладка — она же безопасный фолбэк для скрытой/неизвестной вкладки. */
const FALLBACK_TAB: TabId = 'personal'

export function ProfilePage() {
  const [storedTab, setActiveTab] = useNavEntryState<TabId>('profileTab', FALLBACK_TAB)
  // Nav-состояние переживает сокрытие вкладки (и может содержать произвольный id):
  // если вкладки нет в таб-листе, показываем дефолтную, а не пустую панель.
  const activeTab: TabId = TABS.some((tab) => tab.id === storedTab)
    ? storedTab
    : FALLBACK_TAB
  const ActiveTab = TAB_CONTENT[activeTab]

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
          Профиль
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Управляйте личными данными и настройками аккаунта
        </p>
      </header>

      <nav
        role="tablist"
        aria-label="Разделы профиля"
        className="flex flex-wrap gap-1"
      >
        {TABS.map((tab) => {
          const selected = tab.id === activeTab
          const tabId = `tab-${tab.id}`
          const panelId = `panel-${tab.id}`
          return (
            <button
              key={tab.id}
              id={tabId}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={panelId}
              onClick={() => setActiveTab(tab.id)}
              className={[
                'px-3 py-2 text-sm font-medium transition-colors',
                selected
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {tab.label}
            </button>
          )
        })}
      </nav>

      <AnimatePresence initial={false}>
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          role="tabpanel"
          id={`panel-${activeTab}`}
          aria-labelledby={`tab-${activeTab}`}
          tabIndex={0}
        >
          <ActiveTab />
        </motion.div>
      </AnimatePresence>
    </section>
  )
}
