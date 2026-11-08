// Case 6 scaffold: a hand-made, non-empty clients/backend-horak-reality/ with no
// create-website state and no git trailer. The engine must stop with TARGET_EXISTS.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export default async function ({ run }) {
  const d = join(run, 'clients', 'backend-horak-reality')
  mkdirSync(join(d, 'src'), { recursive: true })
  writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'backend-horak-reality', private: true, scripts: { dev: 'next dev' } }, null, 2) + '\n')
  writeFileSync(join(d, 'POZNAMKY.txt'), 'Ruční pokus z minulého týdne – Martin chtěl jiné fotky. Nemazat, ještě se z toho bude brát.\n')
  writeFileSync(join(d, 'src', 'payload.config.ts'), '// hand-edited copy, not from the template\nexport default {}\n')
  return { handMade: 'clients/backend-horak-reality' }
}
