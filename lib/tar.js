/**
 * A minimal tar reader — enough for a GitHub source archive.
 *
 * GitHub's `codeload` tarballs use plain USTAR headers, but a repository can
 * carry long paths (`L` GNU long-name records) and pax extended headers (`x`),
 * so both are handled. Only the entry kinds a source archive contains are
 * modeled: regular files, directories, and the metadata records above;
 * anything else (hard links, devices, symlinks) is skipped rather than
 * guessed at.
 */

/** Parse a pax extended-header payload into its key/value records. */
function parsePax(buffer) {
  const records = {}
  let offset = 0
  while (offset < buffer.length) {
    const space = buffer.indexOf(0x20, offset)
    if (space < 0) break
    const length = Number(buffer.toString('utf8', offset, space))
    if (!Number.isFinite(length) || length <= 0) break
    const record = buffer.toString('utf8', space + 1, offset + length).replace(/\n$/, '')
    const equals = record.indexOf('=')
    if (equals > 0) records[record.slice(0, equals)] = record.slice(equals + 1)
    offset += length
  }
  return records
}

/** Read one NUL-terminated ASCII field. */
function field(buffer, start, length) {
  const end = buffer.indexOf(0, start)
  const slice = buffer.subarray(start, end < 0 || end > start + length ? start + length : end)
  return slice.toString('utf8').trim()
}

/**
 * Parse a tar archive.
 *
 * @param buffer - the uncompressed archive bytes.
 * @returns entries in archive order, each `{ name, type, data }` where `type`
 * is `'file'` or `'dir'`.
 */
export function parseTar(buffer) {
  const entries = []
  let offset = 0
  let longName
  let pax = {}

  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break

    const size = Number.parseInt(field(header, 124, 12) || '0', 8) || 0
    const typeflag = String.fromCharCode(header[156] || 0x30)
    const body = buffer.subarray(offset + 512, offset + 512 + size)
    offset += 512 + Math.ceil(size / 512) * 512

    if (typeflag === 'x' || typeflag === 'g') {
      pax = { ...pax, ...parsePax(body) }
      continue
    }
    if (typeflag === 'L') {
      longName = body.toString('utf8').replace(/\0+$/, '')
      continue
    }
    if (typeflag === 'K') continue

    const prefix = field(header, 345, 155)
    const rawName = longName ?? pax.path ?? (prefix === '' ? field(header, 0, 100) : `${prefix}/${field(header, 0, 100)}`)
    const name = String(rawName).replace(/^\.\//, '').replace(/\/+$/, '')
    longName = undefined

    if (name === '') continue
    if (typeflag === '5') entries.push({ name, type: 'dir', data: Buffer.alloc(0) })
    else if (typeflag === '0' || typeflag === '\0' || typeflag === '') entries.push({ name, type: 'file', data: body })
  }

  return entries
}
