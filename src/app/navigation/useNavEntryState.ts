import { useCallback, useRef } from 'react'
import { useNav } from './NavigationProvider'

/** initial is captured once on mount (like useState); passing a different value between renders has no effect. */
export function useNavEntryState<T>(
  name: string,
  initial: T,
): [T, (value: T) => void] {
  const { current, updateEntry } = useNav()
  // `initial` is frozen in a ref: otherwise an unstable literal such as `{}`
  // would give `value` a new identity on every render and loop effects that
  // depend on it.
  const initialRef = useRef(initial)
  const value = (current.state[name] as T) ?? initialRef.current

  const setValue = useCallback(
    (value: T) => {
      updateEntry(current.key, {
        state: { ...current.state, [name]: value },
      })
    },
    [updateEntry, current],
  )

  return [value, setValue]
}
