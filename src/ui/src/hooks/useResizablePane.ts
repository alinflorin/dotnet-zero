import { useCallback, useEffect, useRef, useState } from "react"

type Axis = "horizontal" | "vertical"

interface UseResizablePaneOptions {
  axis: Axis
  initialSize: number
  min: number
  max: number
  /** When true, dragging in the negative axis direction grows the size (e.g. a handle on the pane's far edge). */
  invert?: boolean
}

export function useResizablePane({ axis, initialSize, min, max, invert = false }: UseResizablePaneOptions) {
  const [size, setSize] = useState(initialSize)
  const [resizing, setResizing] = useState(false)
  const startRef = useRef<{ pos: number; size: number } | null>(null)

  const pointerPos = useCallback((event: { clientX: number; clientY: number }) => (axis === "horizontal" ? event.clientX : event.clientY), [axis])

  const handleResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      startRef.current = { pos: pointerPos(event), size }
      setResizing(true)
    },
    [pointerPos, size],
  )

  useEffect(() => {
    if (!resizing) return

    const handleMove = (event: PointerEvent) => {
      const start = startRef.current
      if (!start) return
      const delta = pointerPos(event) - start.pos
      const next = start.size + (invert ? -delta : delta)
      setSize(Math.min(max, Math.max(min, next)))
    }
    const handleUp = () => {
      startRef.current = null
      setResizing(false)
    }

    window.addEventListener("pointermove", handleMove)
    window.addEventListener("pointerup", handleUp)
    return () => {
      window.removeEventListener("pointermove", handleMove)
      window.removeEventListener("pointerup", handleUp)
    }
  }, [resizing, invert, min, max, pointerPos])

  return { size, resizing, handleResizeStart }
}
