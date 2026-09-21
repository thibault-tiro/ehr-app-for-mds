import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Contrast,
  Eye,
  EyeOff,
  FolderOpen,
  Maximize2,
  MonitorPlay,
  Upload,
} from 'lucide-react'
import { appConfig } from '@/app.config'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { DicomViewport, type ViewportHandle } from '@/components/dicom-viewport'
import {
  CT_WINDOW_PRESETS,
  type DicomSeries,
  type LoadReport,
  emptyResultMessage,
  filesFromDrop,
  forgetLoadedFiles,
  formatDicomDate,
  formatPersonName,
  loadFiles,
  seriesLabel,
} from '@/lib/dicom'

type Phase = 'empty' | 'reading' | 'viewing'

const HIDDEN = '•••••'

export function ViewerPage() {
  const [phase, setPhase] = useState<Phase>('empty')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [report, setReport] = useState<LoadReport | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [invert, setInvert] = useState(false)
  const [windowInfo, setWindowInfo] = useState<{
    center: number
    width: number
  } | null>(null)
  const [hideIdentity, setHideIdentity] = useState(false)
  const [dragging, setDragging] = useState(false)

  const viewportRef = useRef<ViewportHandle>(null)
  const filesInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)

  // Only some browsers can be asked for a whole folder, and only through an
  // attribute React does not know about.
  useEffect(() => {
    folderInput.current?.setAttribute('webkitdirectory', '')
  }, [])

  const allSeries = useMemo(() => report?.series ?? [], [report])
  const selected = useMemo(
    () => allSeries.find((s) => s.key === selectedKey) ?? null,
    [allSeries, selectedKey],
  )

  const open = useCallback(async (files: File[]) => {
    if (files.length === 0) return
    setPhase('reading')
    setMessage(null)
    setProgress({ done: 0, total: files.length })

    try {
      await forgetLoadedFiles()
      const result = await loadFiles(files, (done, total) =>
        setProgress({ done, total }),
      )
      setReport(result)
      setInvert(false)
      setIndex(0)
      setWindowInfo(null)

      if (result.series.length === 0) {
        setSelectedKey(null)
        setPhase('empty')
        setMessage(emptyResultMessage(result))
        return
      }

      setSelectedKey(result.series[0].key)
      setPhase('viewing')
    } catch (error) {
      console.error('Scan Viewer could not read the files', error)
      setPhase('empty')
      setMessage('Something went wrong while reading those files.')
    }
  }, [])

  const openFromInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    // Let the same folder be chosen twice in a row.
    event.target.value = ''
    void open(files)
  }

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault()
    setDragging(false)
    void filesFromDrop(event.dataTransfer).then(open)
  }

  const chooseSeries = (series: DicomSeries) => {
    setSelectedKey(series.key)
    setIndex(0)
    setInvert(false)
  }

  const step = useCallback(
    (by: number) => {
      if (!selected) return
      setIndex((current) =>
        Math.min(Math.max(current + by, 0), selected.imageIds.length - 1),
      )
    },
    [selected],
  )

  // Arrow keys move through the slices, as they do in every viewer.
  useEffect(() => {
    if (phase !== 'viewing') return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault()
        step(1)
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault()
        step(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, step])

  const toggleInvert = () => {
    const next = !invert
    setInvert(next)
    viewportRef.current?.setInvert(next)
  }

  const shown = (value: string) => (hideIdentity ? HIDDEN : value || '—')

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <input
        ref={filesInput}
        type="file"
        multiple
        className="hidden"
        onChange={openFromInput}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        className="hidden"
        onChange={openFromInput}
      />

      {phase === 'viewing' && selected ? (
        <Viewing
          series={allSeries}
          selected={selected}
          onSelect={chooseSeries}
          index={index}
          setIndex={setIndex}
          step={step}
          viewportRef={viewportRef}
          invert={invert}
          toggleInvert={toggleInvert}
          windowInfo={windowInfo}
          setWindowInfo={setWindowInfo}
          hideIdentity={hideIdentity}
          setHideIdentity={setHideIdentity}
          shown={shown}
          report={report}
          message={message}
          setMessage={setMessage}
          onOpenFiles={() => filesInput.current?.click()}
          onOpenFolder={() => folderInput.current?.click()}
        />
      ) : (
        <Welcome
          phase={phase}
          progress={progress}
          message={message}
          dragging={dragging}
          onOpenFiles={() => filesInput.current?.click()}
          onOpenFolder={() => folderInput.current?.click()}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function Welcome({
  phase,
  progress,
  message,
  dragging,
  onOpenFiles,
  onOpenFolder,
}: {
  phase: Phase
  progress: { done: number; total: number }
  message: string | null
  dragging: boolean
  onOpenFiles: () => void
  onOpenFolder: () => void
}) {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 py-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          {appConfig.name}
        </h1>
        <p className="mt-2 text-muted-foreground">{appConfig.tagline}</p>
      </div>

      <div
        className={`rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
          dragging
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25'
        }`}
      >
        {phase === 'reading' ? (
          <div className="space-y-3">
            <p className="font-medium">Reading the images…</p>
            <p className="text-sm text-muted-foreground">
              {progress.done} of {progress.total} files
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <Upload className="mx-auto size-8 text-muted-foreground" />
            <div className="space-y-1">
              <p className="font-medium">Drag a folder or files here</p>
              <p className="text-sm text-muted-foreground">
                A whole CD, the DICOM folder from it, or single files.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={onOpenFolder}>
                <FolderOpen className="size-4" />
                Open a folder
              </Button>
              <Button variant="outline" onClick={onOpenFiles}>
                <Upload className="size-4" />
                Open files
              </Button>
            </div>
          </div>
        )}
      </div>

      {message && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          {message}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Before you start</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            The images are read straight from your disk and shown here. Nothing
            is uploaded and nothing is saved — close the tab and it is gone.
          </p>
          <p>
            This is a viewer for having a look yourself: for review, teaching
            and second opinions. It is not a certified diagnostic workstation,
            so formal reporting belongs on your hospital system.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------

function Viewing({
  series,
  selected,
  onSelect,
  index,
  setIndex,
  step,
  viewportRef,
  invert,
  toggleInvert,
  windowInfo,
  setWindowInfo,
  hideIdentity,
  setHideIdentity,
  shown,
  report,
  message,
  setMessage,
  onOpenFiles,
  onOpenFolder,
}: {
  series: DicomSeries[]
  selected: DicomSeries
  onSelect: (series: DicomSeries) => void
  index: number
  setIndex: (index: number) => void
  step: (by: number) => void
  viewportRef: React.RefObject<ViewportHandle | null>
  invert: boolean
  toggleInvert: () => void
  windowInfo: { center: number; width: number } | null
  setWindowInfo: (info: { center: number; width: number } | null) => void
  hideIdentity: boolean
  setHideIdentity: (hide: boolean) => void
  shown: (value: string) => string
  report: LoadReport | null
  message: string | null
  setMessage: (message: string | null) => void
  onOpenFiles: () => void
  onOpenFolder: () => void
}) {
  const total = selected.imageIds.length
  const isCt = selected.modality === 'CT'
  const ignored =
    (report?.notDicom ?? 0) +
    (report?.notImage ?? 0) +
    (report?.unreadable ?? 0)

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto pb-2">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">
            {appConfig.name}
          </h1>
          <div className="flex gap-2">
            <Button size="sm" onClick={onOpenFolder}>
              <FolderOpen className="size-4" />
              Folder
            </Button>
            <Button size="sm" variant="outline" onClick={onOpenFiles}>
              <Upload className="size-4" />
              Files
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Patient and study</CardTitle>
            <CardAction>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setHideIdentity(!hideIdentity)}
                title={
                  hideIdentity
                    ? 'Show the patient details'
                    : 'Hide the patient details, for sharing your screen'
                }
              >
                {hideIdentity ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Detail
              label="Name"
              value={shown(formatPersonName(selected.patientName))}
            />
            <Detail label="ID" value={shown(selected.patientId)} />
            <Detail
              label="Born"
              value={shown(formatDicomDate(selected.birthDate))}
            />
            <Detail label="Sex" value={shown(selected.sex)} />
            <Separator />
            <Detail label="Study" value={selected.studyDescription || '—'} />
            <Detail
              label="Date"
              value={formatDicomDate(selected.studyDate) || '—'}
            />
            <Detail label="From" value={selected.institution || '—'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Series ({series.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {series.map((item) => {
              const active = item.key === selected.key
              return (
                <button
                  key={item.key}
                  onClick={() => onSelect(item)}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    active
                      ? 'border-primary bg-primary/10'
                      : 'border-transparent hover:bg-muted'
                  }`}
                >
                  <span className="block truncate font-medium">
                    {seriesLabel(item)}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {item.modality || 'Image'} · {item.imageIds.length}{' '}
                    {item.imageIds.length === 1 ? 'image' : 'images'} ·{' '}
                    {item.columns}×{item.rows}
                  </span>
                </button>
              )
            })}
          </CardContent>
        </Card>

        {ignored > 0 && (
          <p className="text-xs text-muted-foreground">
            {ignored} other {ignored === 1 ? 'file was' : 'files were'} ignored:
            they were not DICOM images.
          </p>
        )}
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            <Contrast className="mr-1 inline size-3.5" />
            Brightness
          </span>
          {/* The preset windows are in Hounsfield units, which only CT has. */}
          {isCt &&
            CT_WINDOW_PRESETS.map((preset) => (
              <Button
                key={preset.label}
                size="sm"
                variant="outline"
                onClick={() =>
                  viewportRef.current?.setWindow(preset.center, preset.width)
                }
              >
                {preset.label}
              </Button>
            ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() => viewportRef.current?.resetWindow()}
          >
            As stored
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <Button
            size="sm"
            variant={invert ? 'default' : 'outline'}
            onClick={toggleInvert}
          >
            <MonitorPlay className="size-4" />
            Invert
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => viewportRef.current?.fit()}
          >
            <Maximize2 className="size-4" />
            Fit
          </Button>
        </div>

        {message && (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <span>{message}</span>
            <button
              onClick={() => setMessage(null)}
              className="shrink-0 text-xs underline"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-black">
          <DicomViewport
            key={selected.key}
            ref={viewportRef}
            imageIds={selected.imageIds}
            index={index}
            onIndexChange={setIndex}
            onWindowChange={setWindowInfo}
            onError={setMessage}
          />
          <div className="pointer-events-none absolute inset-0 p-3 font-mono text-[11px] text-white/70">
            <div className="absolute left-3 top-3">
              {shown(formatPersonName(selected.patientName))}
            </div>
            <div className="absolute right-3 top-3 text-right">
              {seriesLabel(selected)}
              <br />
              {index + 1} / {total}
            </div>
            <div className="absolute bottom-3 left-3">
              {windowInfo
                ? `C ${windowInfo.center}  W ${windowInfo.width}`
                : ''}
            </div>
            <div className="absolute bottom-3 right-3">Not for diagnosis</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => step(-1)}
            disabled={index === 0}
            aria-label="Previous image"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <input
            type="range"
            min={0}
            max={Math.max(total - 1, 0)}
            value={index}
            onChange={(event) => setIndex(Number(event.target.value))}
            disabled={total <= 1}
            aria-label="Image"
            className="min-w-0 flex-1 accent-primary"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => step(1)}
            disabled={index >= total - 1}
            aria-label="Next image"
          >
            <ChevronRight className="size-4" />
          </Button>
          <span className="w-24 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
            {index + 1} / {total}
          </span>
        </div>

        <p className="text-xs text-muted-foreground">
          Scroll wheel moves through the images · drag with the left button to
          change brightness · right button to zoom · middle button to move ·
          arrow keys also work.
        </p>
      </section>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate text-right font-medium" title={value}>
        {value}
      </span>
    </div>
  )
}
