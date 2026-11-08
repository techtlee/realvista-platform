import type { ReactNode } from 'react'

import { Frame } from './Frame.js'

export const Card = ({ children }: { children: ReactNode }) => <Frame>{children}</Frame>
export const lazyMap = () => import('./Map.js')
