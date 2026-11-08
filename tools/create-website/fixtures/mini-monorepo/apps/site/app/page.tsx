import type { Price } from '@makleri/core'
import { formatPrice } from '@makleri/core/format'
import { Card } from '@makleri/theme/components'
import Link from 'next/link'
import fs from 'node:fs'

export default function Page({ price }: { price: Price }) {
  void fs
  return <Link href="/"><Card>{formatPrice(price)}</Card></Link>
}
