/**
 * Fish workspace panel, browser half: the sidebar entry opens one global panel
 * in the main column. The panel covers private chat, personas, memory, tasks,
 * and settings; every page reaches the Python Fish ToolHost through the Host's
 * authenticated workbench Remote (`src/index.ts`), so no token or workbench port
 * reaches the browser.
 *
 * The browser remembers only its last viewed instance. Status and all page
 * requests remain inside that instance's panel and bound caller.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots) and the
// `sidebar.panellist` list the entry registers into.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { FishPanelInjected } from './contract/slots.ts'
import { FishPanel } from './FishPanel.tsx'
import { FishPanelIcon } from './FishPanelIcon.tsx'
import { en, zh, type FishKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import fishWorkbenchRemote from '@deepseek-ai/dsh-client-ui-fish/remote'
import { createNativeWorkbench } from './workbench-client.ts'
import { createFishTurnResources } from './turn-resources.ts'

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
 * Framework services and the native Remote carrier required by the registrations.
 */
export const inject = ['slots', 'layout', 'locale', 'resources', 'remote']

/**
 * Contribute the Fish icon to the sidebar and the workspace panel it opens.
 * @param ctx - the browser plugin context.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  const disposeRemote = await ctx.remote.$mount(fishWorkbenchRemote)
  ctx.effect(() => disposeRemote, 'ui-fish: native workbench Remote')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-fish: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.inject(['remote.fishWorkbench'], (scoped) => {
    const workbench = scoped.remote.fishWorkbench
    const call = createNativeWorkbench(request => workbench.workbench(request))
    const turns = createFishTurnResources(call)
    ctx.effect(() => ctx.resources.register(turns.directory), 'ui-fish: turn directory resource')
    ctx.effect(() => ctx.resources.register(turns.detail), 'ui-fish: turn detail resource')
    const selectionKey = 'dsh.fish.viewed-instance'
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: PANEL_ID,
      locale: NS,
      inject: (): FishPanelInjected => ({
        readSelectedInstance: () => {
          try { return localStorage.getItem(selectionKey) } catch (error) {
            // Browser preference storage can be disabled; the host still owns the initial identity.
            console.warn('Fish viewing preference is unavailable', error)
            return null
          }
        },
        saveSelectedInstance: (id) => {
          try { localStorage.setItem(selectionKey, id) } catch (error) {
            // An unavailable browser preference does not alter the already selected instance.
            console.warn('Fish viewing preference was not saved', error)
          }
        },
        call,
        requestTurns: turns.request,
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
  })
}
