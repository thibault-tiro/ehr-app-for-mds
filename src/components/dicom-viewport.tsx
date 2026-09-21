import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Ref } from 'react'
import type { Types } from '@cornerstonejs/core'
import { fromVoiRange, getEngine, toVoiRange } from '@/lib/dicom'

/** What the buttons above the image can ask the viewport to do. */
export type ViewportHandle = {
  /** Apply a brightness/contrast setting. */
  setWindow: (center: number, width: number) => void
  /** Go back to the setting stored in the image itself. */
  resetWindow: () => void
  /** Centre the image and fit it to the box. */
  fit: () => void
  /** Swap black and white. */
  setInvert: (invert: boolean) => void
}

type Props = {
  imageIds: string[]
  /** Which image in the series is on screen. */
  index: number
  onIndexChange: (index: number) => void
  /** Reports the brightness/contrast whenever it changes, for the readout. */
  onWindowChange: (window: { center: number; width: number } | null) => void
  onError: (message: string) => void
  ref?: Ref<ViewportHandle>
}

const VIEWPORT_ID = 'scan-viewer-viewport'

let instanceCount = 0

export function DicomViewport({
  imageIds,
  index,
  onIndexChange,
  onWindowChange,
  onError,
  ref,
}: Props) {
  const elementRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<Types.IStackViewport | null>(null)
  const [ready, setReady] = useState(false)

  // Callbacks change on every render; keeping them in a box lets the set-up
  // effect below run exactly once.
  const callbacks = useRef({ onIndexChange, onWindowChange, onError })
  useEffect(() => {
    callbacks.current = { onIndexChange, onWindowChange, onError }
  })

  // Start the rendering engine and wire up the mouse. Runs once.
  useEffect(() => {
    const element = elementRef.current
    if (!element) return

    let cancelled = false
    let renderingEngine: Types.IRenderingEngine | null = null
    let cleanupListeners: (() => void) | null = null
    let stopResizing: (() => void) | null = null
    let destroyToolGroup: (() => void) | null = null

    const start = async () => {
      let engine
      try {
        engine = await getEngine()
      } catch {
        if (!cancelled) {
          callbacks.current.onError(
            'The image viewer could not start in this browser. Chrome, Edge, Firefox and Safari all work; a very old version may not.',
          )
        }
        return
      }
      if (cancelled) return

      const { core, tools } = engine
      const engineId = `scan-viewer-engine-${instanceCount++}`
      const toolGroupId = `${engineId}-tools`

      try {
        renderingEngine = new core.RenderingEngine(engineId)
        renderingEngine.enableElement({
          viewportId: VIEWPORT_ID,
          type: core.Enums.ViewportType.STACK,
          element,
          defaultOptions: { background: [0, 0, 0] as Types.Point3 },
        })

        const viewport = renderingEngine.getViewport(
          VIEWPORT_ID,
        ) as Types.IStackViewport
        viewportRef.current = viewport

        const toolGroup = tools.ToolGroupManager.createToolGroup(toolGroupId)
        if (toolGroup) {
          const { MouseBindings } = tools.Enums
          toolGroup.addTool(tools.WindowLevelTool.toolName)
          toolGroup.addTool(tools.PanTool.toolName)
          toolGroup.addTool(tools.ZoomTool.toolName)
          toolGroup.addTool(tools.StackScrollTool.toolName)
          // Left drag adjusts brightness, middle pans, right zooms and the
          // wheel moves through the slices: what every viewer does.
          toolGroup.setToolActive(tools.WindowLevelTool.toolName, {
            bindings: [{ mouseButton: MouseBindings.Primary }],
          })
          toolGroup.setToolActive(tools.PanTool.toolName, {
            bindings: [{ mouseButton: MouseBindings.Auxiliary }],
          })
          toolGroup.setToolActive(tools.ZoomTool.toolName, {
            bindings: [{ mouseButton: MouseBindings.Secondary }],
          })
          toolGroup.setToolActive(tools.StackScrollTool.toolName, {
            bindings: [{ mouseButton: MouseBindings.Wheel }],
          })
          toolGroup.addViewport(VIEWPORT_ID, engineId)
          destroyToolGroup = () =>
            tools.ToolGroupManager.destroyToolGroup(toolGroupId)
        }

        const reportIndex = () => {
          const current = viewportRef.current
          if (current)
            callbacks.current.onIndexChange(current.getCurrentImageIdIndex())
        }
        const reportWindow = () => {
          const current = viewportRef.current
          if (!current) return
          const range = current.getProperties().voiRange
          callbacks.current.onWindowChange(range ? fromVoiRange(range) : null)
        }

        const { Events } = core.Enums
        element.addEventListener(Events.STACK_NEW_IMAGE, reportIndex)
        element.addEventListener(Events.VOI_MODIFIED, reportWindow)
        element.addEventListener(Events.IMAGE_RENDERED, reportWindow)
        cleanupListeners = () => {
          element.removeEventListener(Events.STACK_NEW_IMAGE, reportIndex)
          element.removeEventListener(Events.VOI_MODIFIED, reportWindow)
          element.removeEventListener(Events.IMAGE_RENDERED, reportWindow)
        }

        // Keep the picture filling the box when the window changes size.
        const observer = new ResizeObserver(() =>
          renderingEngine?.resize(true, true),
        )
        observer.observe(element)
        stopResizing = () => observer.disconnect()

        setReady(true)
      } catch {
        if (!cancelled) {
          callbacks.current.onError(
            'The image viewer could not start. Your browser may not support the graphics it needs.',
          )
        }
      }
    }

    void start()

    return () => {
      cancelled = true
      stopResizing?.()
      cleanupListeners?.()
      destroyToolGroup?.()
      viewportRef.current = null
      renderingEngine?.destroy()
    }
  }, [])

  // Show the chosen series.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!ready || !viewport || imageIds.length === 0) return

    let cancelled = false
    const show = async () => {
      try {
        await viewport.setStack(imageIds, 0)
        if (cancelled) return
        viewport.resetCamera()
        viewport.render()
      } catch {
        if (!cancelled) {
          callbacks.current.onError(
            'These images could not be displayed. They may use a format this viewer does not read, or the files may be incomplete.',
          )
        }
      }
    }
    void show()
    return () => {
      cancelled = true
    }
    // The index deliberately does not restart the series.
  }, [imageIds, ready])

  // Follow the slider and the arrow keys.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!ready || !viewport) return
    if (viewport.getCurrentImageIdIndex() === index) return
    viewport.setImageIdIndex(index).catch(() => {
      // Asking for a slice that is still loading is not worth reporting.
    })
  }, [index, ready])

  useImperativeHandle(
    ref,
    () => ({
      setWindow: (center, width) => {
        const viewport = viewportRef.current
        if (!viewport) return
        viewport.setProperties({ voiRange: toVoiRange(center, width) })
        viewport.render()
      },
      resetWindow: () => {
        const viewport = viewportRef.current
        if (!viewport) return
        viewport.resetProperties()
        viewport.render()
      },
      fit: () => {
        const viewport = viewportRef.current
        if (!viewport) return
        viewport.resetCamera()
        viewport.render()
      },
      setInvert: (invert) => {
        const viewport = viewportRef.current
        if (!viewport) return
        viewport.setProperties({ invert })
        viewport.render()
      },
    }),
    [],
  )

  return (
    <div
      ref={elementRef}
      // Cornerstone draws its own context menu behaviour on right-drag.
      onContextMenu={(event) => event.preventDefault()}
      className="h-full w-full bg-black"
      data-testid="dicom-viewport"
    />
  )
}
