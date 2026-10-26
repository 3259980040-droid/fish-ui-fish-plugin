/**
 * Paste-import support for SKILL.md: split the same frontmatter the Fish
 * backend reads from a file, so the page can hand `skills.save` the fields it
 * accepts. The workbench has no text-import action, so this is the one place
 * the paste route interprets the owner's text before the backend rewrites the
 * stored file with its own frontmatter.
 */

/** Why a pasted SKILL.md cannot be imported. */
export type PastedSkillFailure = 'header' | 'name' | 'description'

/** A pasted SKILL.md split into the fields `skills.save` accepts. */
export type PastedSkill =
  | { readonly ok: true; readonly name: string; readonly description: string; readonly body: string }
  | { readonly ok: false; readonly reason: PastedSkillFailure }

/** Trim one layer of matching single or double quotes, as the backend does. */
function unquote(value: string): string {
  let text = value
  if (text.startsWith('"') || text.startsWith("'")) text = text.slice(1)
  if (text.endsWith('"') || text.endsWith("'")) text = text.slice(0, -1)
  return text
}

/**
 * Split a full SKILL.md the same way `skills_store._split` does for a file.
 * @param text - the pasted full SKILL.md.
 * @returns the name, description, and body, or which required part is missing.
 */
export function splitSkillText(text: string): PastedSkill {
  const normalized = text.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) return { ok: false, reason: 'header' }
  const end = normalized.indexOf('\n---', 4)
  if (end === -1) return { ok: false, reason: 'header' }
  const fields: Record<string, string> = {}
  for (const line of normalized.slice(4, end).split('\n')) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    fields[line.slice(0, separator).trim().toLowerCase()] = unquote(line.slice(separator + 1).trim())
  }
  const name = fields['name'] ?? ''
  if (name === '') return { ok: false, reason: 'name' }
  const description = fields['description'] ?? ''
  if (description === '') return { ok: false, reason: 'description' }
  // `end` is the newline before the closing ---; +4 skips it and the dashes.
  const body = normalized.slice(end + 4).replace(/^\n+/, '')
  return { ok: true, name, description, body }
}
