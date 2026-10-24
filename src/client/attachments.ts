/** The single client upload protocol, shared by chat attachments and the library. */
import type { FishPageProps } from './page-props.ts'
import type { FishAttachment } from './contract/workbench.ts'
import type { FishResult } from './contract/slots.ts'
import { parseAttachment, parseUploadProgress, parseUploadStarted } from './parsers.ts'

export interface AttachmentTransferProgress {
  readonly name: string
  readonly received: number
  readonly size: number
  readonly finalizing: boolean
}

/** Store an original without ever constructing a whole-file base64 control message. */
export async function importAttachment(
  call: FishPageProps['call'], id: string, file: File,
  progress: (value: AttachmentTransferProgress) => void,
  copy: { readonly readError: string; readonly progressError: string },
): Promise<FishResult<FishAttachment>> {
  const reply = await call('attachments.begin', { id, name: file.name, size: file.size })
  if (!reply.ok) return reply
  const begin = parseUploadStarted(reply.value)
  if (!begin.ok) return begin
  let offset = begin.value.received
  progress({ name: file.name, received: offset, size: file.size, finalizing: false })
  while (offset < file.size) {
    const end = Math.min(file.size, offset + begin.value.chunk_bytes)
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => { resolve(String(reader.result).split(',', 2)[1] ?? '') }
      reader.onerror = () => { reject(new Error(copy.readError)) }
      reader.readAsDataURL(file.slice(offset, end))
    })
    const chunk = await call('attachments.chunk', { id, upload_id: begin.value.upload_id, offset, data })
    if (!chunk.ok) return chunk
    const parsed = parseUploadProgress(chunk.value)
    if (!parsed.ok) return parsed
    if (parsed.value.received < end || parsed.value.received > file.size) throw new Error(copy.progressError)
    offset = parsed.value.received
    progress({ name: file.name, received: offset, size: file.size, finalizing: false })
  }
  progress({ name: file.name, received: offset, size: file.size, finalizing: true })
  const finish = await call('attachments.finish', { id, upload_id: begin.value.upload_id })
  return finish.ok ? parseAttachment(finish.value) : finish
}
