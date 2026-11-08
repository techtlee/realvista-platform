import { z } from 'zod'

import type { Price } from '../types.js'

export const formatPrice = (p: Price) => `${z.number().parse(p.amount)} Kč`
