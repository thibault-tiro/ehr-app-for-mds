/**
 * Everything that touches the DICOM libraries lives here.
 *
 * The Cornerstone libraries are large and need a real browser (WebGL, web
 * workers), so they are loaded the first time images are opened rather than
 * when the page loads. That keeps the first paint fast and lets the rest of
 * the app be tested without them.
 */
import type { DataSet } from 'dicom-parser'

/** The DICOM tags we read, written the way dicom-parser names them. */
const Tag = {
  studyDate: 'x00080020',
  modality: 'x00080060',
  institution: 'x00080080',
  studyDescription: 'x00081030',
  seriesDescription: 'x0008103e',
  patientName: 'x00100010',
  patientId: 'x00100020',
  birthDate: 'x00100030',
  sex: 'x00100040',
  studyUid: 'x0020000d',
  seriesUid: 'x0020000e',
  seriesNumber: 'x00200011',
  instanceNumber: 'x00200013',
  frameCount: 'x00280008',
  rows: 'x00280010',
  columns: 'x00280011',
  pixelData: 'x7fe00010',
} as const

/**
 * How much of a file we read to identify it. The descriptive part of a DICOM
 * file sits at the front, so this is nearly always enough; the rare file that
 * needs more is re-read in full.
 */
const HEADER_BYTES = 1024 * 1024

/** A group of images that belong together: one series of one study. */
export type DicomSeries = {
  /** Stable identity for React keys and selection. */
  key: string
  modality: string
  seriesNumber: number | null
  seriesDescription: string
  studyDescription: string
  studyDate: string
  patientName: string
  patientId: string
  birthDate: string
  sex: string
  institution: string
  rows: number
  columns: number
  /** One entry per image, already in the right order. */
  imageIds: string[]
}

/** What came out of a folder or a handful of files. */
export type LoadReport = {
  series: DicomSeries[]
  /** Files that were not DICOM at all, such as a viewer or a readme on a CD. */
  notDicom: number
  /** DICOM files that hold no picture, such as a report or the disc index. */
  notImage: number
  /**
   * The modalities of those non-image files, e.g. "SR" for a structured
   * report. Lets the page say what was found instead of just "no images".
   */
  notImageModalities: string[]
  /** DICOM files we could not read. */
  unreadable: number
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** DICOM writes names as "Family^Given^Middle^Prefix^Suffix". */
export function formatPersonName(raw: string | undefined): string {
  if (!raw) return ''
  const [family = '', given = '', middle = '', prefix = '', suffix = ''] =
    raw.split('^')
  const parts = [prefix, given, middle, family, suffix]
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.join(' ') || raw.trim()
}

/** DICOM writes dates as YYYYMMDD. Show something a human can read. */
export function formatDicomDate(raw: string | undefined): string {
  if (!raw) return ''
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(raw.trim())
  if (!match) return raw.trim()
  const [, year, month, day] = match
  const name = MONTHS[Number(month) - 1]
  if (!name) return raw.trim()
  return `${Number(day)} ${name} ${year}`
}

/** The label shown for a series in the list on the left. */
export function seriesLabel(series: DicomSeries): string {
  const described = series.seriesDescription || series.modality || 'Images'
  return series.seriesNumber === null
    ? described
    : `${series.seriesNumber}. ${described}`
}

// ---------------------------------------------------------------------------
// Brightness and contrast
// ---------------------------------------------------------------------------

/**
 * A brightness/contrast setting. Radiologists call these "window centre" and
 * "window width"; the presets below are the standard CT values.
 */
export type WindowPreset = {
  label: string
  center: number
  width: number
}

export const CT_WINDOW_PRESETS: WindowPreset[] = [
  { label: 'Soft tissue', center: 50, width: 400 },
  { label: 'Lung', center: -600, width: 1500 },
  { label: 'Bone', center: 400, width: 1800 },
  { label: 'Brain', center: 40, width: 80 },
  { label: 'Liver', center: 60, width: 160 },
]

export type VoiRange = { lower: number; upper: number }

/** Turn a centre/width pair into the low/high pair Cornerstone wants. */
export function toVoiRange(center: number, width: number): VoiRange {
  return { lower: center - width / 2, upper: center + width / 2 }
}

/** And back again, for showing the current setting on screen. */
export function fromVoiRange(range: VoiRange): {
  center: number
  width: number
} {
  return {
    center: Math.round((range.upper + range.lower) / 2),
    width: Math.round(range.upper - range.lower),
  }
}

/** What the DICOM modality codes mean, for the kinds that hold no picture. */
const NON_IMAGE_MODALITIES: Record<string, string> = {
  SR: 'structured reports',
  KO: 'key object notes',
  PR: 'presentation states',
  GSPS: 'presentation states',
  DOC: 'embedded documents',
  SEG: 'segmentations',
  REG: 'registrations',
  RTSTRUCT: 'radiotherapy structure sets',
  RTPLAN: 'radiotherapy plans',
  RTDOSE: 'radiotherapy dose maps',
}

/** A plain-language phrase for the non-image files that turned up. */
export function describeNonImages(modalities: string[]): string {
  const named = modalities.map(
    (code) => NON_IMAGE_MODALITIES[code] ?? `${code} files`,
  )
  if (named.length === 0) return 'files with no picture in them'
  if (named.length === 1) return named[0]
  return `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`
}

/**
 * What to tell the clinician when nothing could be shown. The useful thing
 * is *why*: a folder of reports is a different problem from a folder of
 * holiday photos, and only one of them means they picked the wrong folder.
 */
export function emptyResultMessage(report: LoadReport): string {
  if (report.notImage > 0) {
    const what = describeNonImages(report.notImageModalities)
    return report.notImage === 1
      ? `That is a valid DICOM file, but it holds no picture: it is one of the kinds that carry text and measurements instead (${what}). There is nothing for a viewer to show \u2014 open a folder of scan images instead.`
      : `Those are ${report.notImage} valid DICOM files, but none of them holds a picture: they are ${what}, which carry text and measurements rather than images. Open a folder of scan images instead.`
  }
  if (report.unreadable > 0 && report.notDicom === 0) {
    return 'Those files look like DICOM but could not be read. They may be damaged, or only partly copied from the disc.'
  }
  return 'No DICOM images were found in those files. On a hospital CD the images usually sit in a folder called DICOM or IMAGES, often without a file extension \u2014 try opening the whole disc or folder.'
}

// ---------------------------------------------------------------------------
// Picking files up off the disk
// ---------------------------------------------------------------------------

function entryToFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject))
}

function readDirectory(
  reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject))
}

async function collectEntry(
  entry: FileSystemEntry,
  into: File[],
): Promise<void> {
  if (entry.isFile) {
    into.push(await entryToFile(entry as FileSystemFileEntry))
    return
  }
  if (!entry.isDirectory) return
  const reader = (entry as FileSystemDirectoryEntry).createReader()
  // readEntries hands back at most a hundred entries per call, so keep asking
  // until it returns nothing.
  for (;;) {
    const batch = await readDirectory(reader)
    if (batch.length === 0) return
    for (const child of batch) await collectEntry(child, into)
  }
}

/**
 * Every file in whatever was dropped on the page, walking into folders.
 * Falls back to the plain file list on browsers that cannot walk folders.
 */
export async function filesFromDrop(transfer: DataTransfer): Promise<File[]> {
  const entries: FileSystemEntry[] = []
  for (const item of Array.from(transfer.items)) {
    if (item.kind !== 'file') continue
    const entry = item.webkitGetAsEntry?.()
    if (entry) entries.push(entry)
  }
  if (entries.length === 0) return Array.from(transfer.files)

  const files: File[] = []
  for (const entry of entries) {
    try {
      await collectEntry(entry, files)
    } catch {
      // A folder we are not allowed to read is simply left out.
    }
  }
  return files
}

// ---------------------------------------------------------------------------
// Reading the files
// ---------------------------------------------------------------------------

/**
 * True when the bytes carry the "DICM" marker every DICOM file starts with.
 * This is what lets us ignore the readme files and autorun programs that sit
 * alongside the images on a hospital CD.
 */
export function looksLikeDicom(bytes: Uint8Array): boolean {
  return (
    bytes.length > 132 &&
    bytes[128] === 0x44 &&
    bytes[129] === 0x49 &&
    bytes[130] === 0x43 &&
    bytes[131] === 0x4d
  )
}

async function readBytes(file: File, limit?: number): Promise<Uint8Array> {
  const blob = limit === undefined ? file : file.slice(0, limit)
  return new Uint8Array(await blob.arrayBuffer())
}

type Parser = typeof import('dicom-parser')

function parseHeader(parser: Parser, bytes: Uint8Array): DataSet | null {
  try {
    // Stop at the pixel data: we only want the description, not the picture.
    return parser.parseDicom(bytes, { untilTag: Tag.pixelData })
  } catch {
    return null
  }
}

/** One file's worth of description, before it is grouped into a series. */
type Instance = {
  imageIds: string[]
  order: number
  fileName: string
}

type Group = Omit<DicomSeries, 'imageIds'> & { instances: Instance[] }

function intOrNull(dataSet: DataSet, tag: string): number | null {
  const raw = dataSet.string(tag)
  if (!raw) return null
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) ? value : null
}

function text(dataSet: DataSet, tag: string): string {
  return (dataSet.string(tag) ?? '').trim()
}

// Files with no instance number sort last, then by name.
const NO_ORDER = Number.MAX_SAFE_INTEGER

/** What a single file on the disk turned out to be. */
type ReadResult =
  | { kind: 'image'; dataSet: DataSet }
  | { kind: 'notDicom' }
  | { kind: 'unreadable' }

/** Read one file far enough to know what it is and what is in it. */
async function readDataSet(parser: Parser, file: File): Promise<ReadResult> {
  try {
    const head = await readBytes(file, HEADER_BYTES)
    if (!looksLikeDicom(head)) return { kind: 'notDicom' }

    let dataSet = parseHeader(parser, head)
    if (!dataSet && file.size > HEADER_BYTES) {
      // An unusually long description; read the whole file and try again.
      dataSet = parseHeader(parser, await readBytes(file))
    }
    return dataSet ? { kind: 'image', dataSet } : { kind: 'unreadable' }
  } catch {
    return { kind: 'unreadable' }
  }
}

/**
 * Read a pile of files and sort them into series ready to display.
 * `onProgress` is called as it goes so the page can show how far along it is.
 */
export async function loadFiles(
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<LoadReport> {
  const { loader } = await getEngine()
  const parser = (await import('dicom-parser')).default

  const groups = new Map<string, Group>()
  let notDicom = 0
  let notImage = 0
  let unreadable = 0
  const notImageModalities = new Set<string>()

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const result = await readDataSet(parser, file)

    if (result.kind === 'notDicom') {
      notDicom++
      continue
    }
    if (result.kind === 'unreadable') {
      unreadable++
      continue
    }
    const { dataSet } = result

    const rows = dataSet.uint16(Tag.rows) ?? 0
    const columns = dataSet.uint16(Tag.columns) ?? 0
    if (!rows || !columns) {
      // A report, a disc index or a presentation state: no picture in it.
      notImage++
      const modality = text(dataSet, Tag.modality)
      if (modality) notImageModalities.add(modality)
      continue
    }

    const seriesNumber = intOrNull(dataSet, Tag.seriesNumber)
    const key =
      text(dataSet, Tag.seriesUid) ||
      `${text(dataSet, Tag.studyUid)}/${seriesNumber ?? 'x'}`

    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        modality: text(dataSet, Tag.modality),
        seriesNumber,
        seriesDescription: text(dataSet, Tag.seriesDescription),
        studyDescription: text(dataSet, Tag.studyDescription),
        studyDate: text(dataSet, Tag.studyDate),
        patientName: text(dataSet, Tag.patientName),
        patientId: text(dataSet, Tag.patientId),
        birthDate: text(dataSet, Tag.birthDate),
        sex: text(dataSet, Tag.sex),
        institution: text(dataSet, Tag.institution),
        rows,
        columns,
        instances: [],
      }
      groups.set(key, group)
    }

    // A single file can hold a whole loop, as ultrasound and angiography do.
    const frames = intOrNull(dataSet, Tag.frameCount) ?? 1
    const baseId = loader.wadouri.fileManager.add(file)
    const imageIds =
      frames > 1
        ? Array.from({ length: frames }, (_, f) => `${baseId}?frame=${f + 1}`)
        : [baseId]

    group.instances.push({
      imageIds,
      order: intOrNull(dataSet, Tag.instanceNumber) ?? NO_ORDER,
      fileName: file.name,
    })

    if (i % 10 === 0) onProgress?.(i + 1, files.length)
  }

  onProgress?.(files.length, files.length)

  const series = Array.from(groups.values())
    .map(({ instances, ...rest }) => {
      instances.sort(
        (a, b) =>
          a.order - b.order ||
          a.fileName.localeCompare(b.fileName, undefined, { numeric: true }),
      )
      return { ...rest, imageIds: instances.flatMap((i) => i.imageIds) }
    })
    .sort(
      (a, b) =>
        (a.seriesNumber ?? NO_ORDER) - (b.seriesNumber ?? NO_ORDER) ||
        a.key.localeCompare(b.key),
    )

  return {
    series,
    notDicom,
    notImage,
    unreadable,
    notImageModalities: Array.from(notImageModalities).sort(),
  }
}

// ---------------------------------------------------------------------------
// The Cornerstone engine
// ---------------------------------------------------------------------------

export type Engine = {
  core: typeof import('@cornerstonejs/core')
  tools: typeof import('@cornerstonejs/tools')
  loader: typeof import('@cornerstonejs/dicom-image-loader')
}

let engine: Promise<Engine> | null = null

/** Load and start Cornerstone once, however many times this is called. */
export function getEngine(): Promise<Engine> {
  engine ??= (async () => {
    // Loaded one after another, not in parallel: the tools and the loader
    // build on classes from the core, and starting them all at once leaves
    // those classes half-defined.
    const core = await import('@cornerstonejs/core')
    const tools = await import('@cornerstonejs/tools')
    const loader = await import('@cornerstonejs/dicom-image-loader')

    await core.init()
    loader.init()
    await tools.init()

    // Registering a tool twice warns, so it happens here and nowhere else.
    tools.addTool(tools.WindowLevelTool)
    tools.addTool(tools.PanTool)
    tools.addTool(tools.ZoomTool)
    tools.addTool(tools.StackScrollTool)

    return { core, tools, loader }
  })()
  return engine
}

/** Forget every file opened so far, so the browser can reclaim the memory. */
export async function forgetLoadedFiles(): Promise<void> {
  if (!engine) return
  const { core, loader } = await engine
  loader.wadouri.fileManager.purge()
  loader.wadouri.dataSetCacheManager.purge()
  core.cache.purgeCache()
}
