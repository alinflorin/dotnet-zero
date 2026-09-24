import { useCallback, useEffect, useRef } from "react"

export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void | Promise<void>,
  delayMs: number,
) {
  const callbackRef = useRef(callback)
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingArgsRef = useRef<Args | null>(null)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  const debounced = useCallback(
    (...args: Args) => {
      pendingArgsRef.current = args
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null
        const pending = pendingArgsRef.current
        pendingArgsRef.current = null
        if (pending) void callbackRef.current(...pending)
      }, delayMs)
    },
    [delayMs],
  )

  const flush = useCallback(async () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    const pending = pendingArgsRef.current
    pendingArgsRef.current = null
    if (pending) await callbackRef.current(...pending)
  }, [])

  return [debounced, flush] as const
}
