/** The sidebar's Fish entry icon; the sidebar owns the button, label, and selected state around it. */
import type { ReactNode } from 'react'
import { FishLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FishIconProps } from './contract/slots.ts'

/**
 * Render the Fish mark at the size the sidebar asks for.
 * @param props - the sidebar's icon share: the requested edge and whether the panel is selected.
 * @returns the Fish logo sized to the icon box.
 */
export function FishPanelIcon({ size }: FishIconProps): ReactNode {
  // The fish silhouette is wider than tall; the icon box edge sizes its width.
  return <FishLogo size={size} />
}
