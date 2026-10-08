'use client'

import { useEffect, useState } from 'react'

/**
 * Floating variant switcher.
 *
 * A preview affordance, not a site feature: it exists so a theme can be
 * reviewed in every colourway without editing config and restarting. Gated
 * behind NEXT_PUBLIC_VARIANT_PREVIEW so a real client site never renders it —
 * a visitor restyling a realtor's brand would be absurd.
 *
 * The list arrives from the theme's manifest rather than being spelled out
 * here. It used to be a local copy of REALVISTA's four colourways, which meant
 * a second layout would have previewed in the wrong palette names, and a
 * colourway added to a theme would silently not appear.
 *
 * It also honours `?varianta=` on load, which makes each colourway a shareable
 * URL — the storefront gallery will want exactly that.
 */

export interface SwitcherVariant {
  value: string
  label: { cs: string }
  swatch: string
}

export function VariantSwitcher({
  initial,
  variants,
}: {
  initial: string
  variants: readonly SwitcherVariant[]
}) {
  const [active, setActive] = useState<string>(initial)

  // Apply `?varianta=` on first paint so a shared link opens in that colourway.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('varianta')
    if (fromUrl && variants.some((v) => v.value === fromUrl)) {
      document.documentElement.setAttribute('data-variant', fromUrl)
      setActive(fromUrl)
    }
  }, [variants])

  function pick(v: string) {
    document.documentElement.setAttribute('data-variant', v)
    setActive(v)

    // Keep the URL in step without a navigation, so a reload or a shared link
    // lands on the same colourway.
    const url = new URL(window.location.href)
    url.searchParams.set('varianta', v)
    window.history.replaceState({}, '', url)
  }

  if (variants.length < 2) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: 6,
        borderRadius: 999,
        background: 'rgba(255,255,255,0.92)',
        boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
        backdropFilter: 'blur(8px)',
        fontFamily: 'var(--rv-font-sans, system-ui)',
      }}
    >
      <span style={{ padding: '0 8px', fontSize: 12, color: '#555' }}>Vzhled</span>
      {variants.map((v) => {
        const on = active === v.value
        return (
          <button
            key={v.value}
            type="button"
            onClick={() => pick(v.value)}
            aria-pressed={on}
            title={v.label.cs}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px 6px 8px',
              borderRadius: 999,
              border: on ? '1px solid #111' : '1px solid transparent',
              background: on ? '#f2f2f2' : 'transparent',
              cursor: 'pointer',
              fontSize: 12,
              color: '#111',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 14,
                height: 14,
                borderRadius: 999,
                background: v.swatch,
                boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15)',
              }}
            />
            {v.label.cs}
          </button>
        )
      })}
    </div>
  )
}
