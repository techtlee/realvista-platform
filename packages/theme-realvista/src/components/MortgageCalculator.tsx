'use client'

import type { Property } from '@makleri/core/content'
import { formatPrice } from '@makleri/core/format'
import { useId, useState } from 'react'

/**
 * Orientační hypoteční kalkulačka for a listing's detail page.
 *
 * The one client component in the theme: the sliders recompute the payment as
 * they move. Server rendering still prints the default result, so the card is
 * meaningful before hydration and in the conformance render.
 *
 * Defaults are Josef's decision (2026-11-08): 4.9 % p.a., 30 years, 20 % own
 * funds. They are an illustration, and the card says so.
 */

export const MORTGAGE_DEFAULTS = { rate: 4.9, years: 30, downPayment: 20 } as const

/** Amounts in CZK through core's formatter, so every theme prints "1 234 Kč" alike. */
const czk = (amount: number) =>
  formatPrice({ price: { amount }, transactionType: 'prodej' } as Property)

const percent = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 2 })

/** Annuity: the fixed monthly payment that repays `loan` over `years` at `rate` % p.a. */
export function monthlyPayment(loan: number, rate: number, years: number): number {
  const n = years * 12
  if (loan <= 0 || n <= 0) return 0
  const r = rate / 100 / 12
  if (r === 0) return Math.round(loan / n)
  return Math.round((loan * r) / (1 - Math.pow(1 + r, -n)))
}

const yearsLabel = (y: number) => (y === 1 ? '1 rok' : y < 5 ? `${y} roky` : `${y} let`)

export function MortgageCalculator({ price }: { price: number }) {
  const [downPayment, setDownPayment] = useState<number>(MORTGAGE_DEFAULTS.downPayment)
  const [years, setYears] = useState<number>(MORTGAGE_DEFAULTS.years)
  const [rate, setRate] = useState<number>(MORTGAGE_DEFAULTS.rate)
  const id = useId()

  const loan = Math.round(price * (1 - downPayment / 100))
  const payment = monthlyPayment(loan, rate, years)

  const sliders = [
    { key: 'down', label: 'Vlastní zdroje', shown: `${downPayment} %`, value: downPayment, min: 10, max: 50, step: 5, set: setDownPayment },
    { key: 'years', label: 'Doba splácení', shown: yearsLabel(years), value: years, min: 5, max: 30, step: 1, set: setYears },
    { key: 'rate', label: 'Úroková sazba', shown: `${percent.format(rate)} %`, value: rate, min: 1, max: 10, step: 0.1, set: setRate },
  ]

  return (
    <section data-rv-calculator="" aria-labelledby={`${id}-title`} className="rounded-btn bg-card p-[40px] shadow-card">
      <h2 id={`${id}-title`} className="text-[30px] font-medium leading-[39px] text-brand">
        Hypoteční kalkulačka
      </h2>

      <p className="mt-3 text-[14px] leading-[18px] text-muted">Cena nemovitosti {czk(price)}</p>

      {sliders.map((s) => (
        <label key={s.key} className="mt-6 block">
          <span className="flex justify-between text-[16px] leading-[21px] text-muted">
            {s.label} <strong className="font-medium text-brand">{s.shown}</strong>
          </span>
          <input
            type="range"
            min={s.min}
            max={s.max}
            step={s.step}
            value={s.value}
            onChange={(e) => s.set(Number(e.target.value))}
            className="mt-3 w-full accent-[var(--rv-brand)]"
          />
        </label>
      ))}

      <div className="mt-8 border-t border-accent pt-6" aria-live="polite">
        <p className="text-[14px] leading-[18px] text-muted">Orientační měsíční splátka</p>
        <p className="mt-2 text-[30px] font-bold leading-[39px] text-brand">{czk(payment)}</p>
        <p className="mt-1 text-[14px] leading-[18px] text-muted">Výše úvěru {czk(loan)}</p>
        <p className="mt-4 text-[12px] leading-[16px] text-muted">
          Výpočet je pouze orientační a nejde o nabídku úvěru.
        </p>
      </div>
    </section>
  )
}
