import { act, render, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  NavigationProvider,
  useNav,
} from './NavigationProvider'
import { initialStack, type StackState } from './stack'

describe('NavigationProvider', () => {
  it('exposes current view and navigate actions', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <NavigationProvider>{children}</NavigationProvider>
    )
    const { result } = renderHook(() => useNav(), { wrapper })
    expect(result.current.current.view).toBe('home')
    expect(result.current.canGoBack).toBe(false)
    act(() => result.current.push('detail', { listingId: 'x' }))
    expect(result.current.current.view).toBe('detail')
    expect(result.current.current.params).toEqual({ listingId: 'x' })
    expect(result.current.canGoBack).toBe(true)
    act(() => result.current.back())
    expect(result.current.current.view).toBe('home')
  })

  it('sets history.scrollRestoration to manual on mount', () => {
    Object.defineProperty(history, 'scrollRestoration', {
      value: 'auto',
      writable: true,
      configurable: true,
    })
    const spy = vi.spyOn(history, 'scrollRestoration', 'set')
    render(
      <NavigationProvider>
        <div />
      </NavigationProvider>,
    )
    expect(spy).toHaveBeenCalledWith('manual')
    spy.mockRestore()
  })

  it('accepts an initial stack for tests', () => {
    const seeded: StackState = initialStack('home')
    seeded.entries[0] = { ...seeded.entries[0], scrollY: 123 }
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <NavigationProvider initial={seeded}>{children}</NavigationProvider>
    )
    const { result } = renderHook(() => useNav(), { wrapper })
    expect(result.current.current.scrollY).toBe(123)
  })

  it('keeps navigate actions referentially stable across state changes', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <NavigationProvider>{children}</NavigationProvider>
    )
    const { result } = renderHook(() => useNav(), { wrapper })
    const pushBefore = result.current.push
    const resetBefore = result.current.reset
    act(() => pushBefore('mine'))
    expect(result.current.current.view).toBe('mine')
    expect(result.current.push).toBe(pushBefore)
    expect(result.current.reset).toBe(resetBefore)
  })

  it('reset clears preserved entry state and rotates the entry key', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <NavigationProvider>{children}</NavigationProvider>
    )
    const { result } = renderHook(() => useNav(), { wrapper })
    const keyBefore = result.current.current.key
    act(() =>
      result.current.updateEntry(result.current.current.key, {
        state: { feedFilters: { city: 'Москва' } },
      }),
    )
    expect(result.current.current.state).toEqual({
      feedFilters: { city: 'Москва' },
    })
    act(() => result.current.reset())
    expect(result.current.current.key).not.toBe(keyBefore)
    expect(result.current.current.state).toEqual({})
  })
})
