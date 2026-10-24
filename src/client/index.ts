/**
 * Fish workspace panel, browser half: the sidebar entry opens one global panel
 * in the main column. The panel covers private chat, personas, memory, tasks,
 * and settings; every page reaches the Python Fish ToolHost through the Host's
 * `/fish/workbench` proxy (`src/index.ts`), so no token or workbench port
 * reaches the browser.
 *
 * One mode-state source lives in this apply closure: the panel header renders
 * it through the injected `useMode` hook, and the Chat and Settings pages
 * publish into it (chat settings and mode switches) so the header and every
 * page agree without a second subscription.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots) and the
// `sidebar.panellist` list the entry registers into.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { FishPanelInjected } from './contract/slots.ts'
import type { FishModeState } from './contract/workbench.ts'
import { FishPanel } from './FishPanel.tsx'
import { FishPanelIcon } from './FishPanelIcon.tsx'
import { en, zh, type FishKey } from './locales.ts'
import { createWorkbench } from './workbench-client.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Fish workspace panel copy. */
    fish: FishKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'fish'

/** The id shared by the sidebar entry and the main panel it opens. */
export const PANEL_ID = 'fish' as MainPanelId

/**
 * Services required by the registrations. `connection` is optional on purpose:
 * the panel only prefers its RPC-carrier Fetch when a carrier was installed.
 */
export const inject = ['slots', 'layout', 'locale']

/**
 * Contribute the Fish icon to the sidebar and the workspace panel it opens.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-fish: dictionaries')
  const t = ctx.locale.bind(NS)
  // A shell that owns the transport (the worker tunnel) presents the Host as
  // an RPC carrier, not as a served page: post through that carrier so the
  // same-origin route resolves against the Host root in either composition.
  const connection = (ctx.get('connection') as { readonly rpc?: { readonly fetch?: unknown } } | undefined)
  const carrierFetch = connection?.rpc?.fetch
  const call = createWorkbench(typeof carrierFetch === 'function'
    ? (carrierFetch as (input: string, init: RequestInit) => Promise<Response>)
    : (input, init) => fetch(input, init))
  const mode = createSnapshotStore<FishModeState | null>(null)
  const publishMode = (next: FishModeState): void => { mode.set(next) }
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: (): FishPanelInjected => ({
      hooks: { mode: { getSnapshot: mode.getSnapshot, subscribe: mode.subscribe } },
      publishMode,
      call,
      formatTimestamp: (value) => {
        const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value)
        return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(undefined, { timeZone: 'Asia/Shanghai' })
      },
    }),
  }, FishPanel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 20,
    locale: NS,
    label: () => t('panel'),
  }, FishPanelIcon))
}
