/**
 * Redaction for everything that leaves the process: child stdout/stderr on
 * the way to logs or the console, log lines, error messages.
 *
 * Replaces every known secret value, plus shapes that are secrets whatever
 * their value (`PAYLOAD_SECRET=…`, `users API-Key …`, credentials inside a
 * postgres URL).
 */
export const REDACTED = '[REDACTED]'

/** Values shorter than this are not treated as secrets (a port or "1" would wreck every log). */
export const MIN_SECRET_LENGTH = 8

const PATTERNS: Array<[RegExp, string]> = [
  [/\b([A-Z0-9_]*(?:KEY|SECRET|PASSWORD|TOKEN|DATABASE_URL))=("[^"]*"|'[^']*'|\S+)/g, `$1=${REDACTED}`],
  [/(\b\w+ API-Key )\S+/gi, `$1${REDACTED}`],
  [/(Authorization:\s*(?:Bearer|JWT|Basic)\s+)\S+/gi, `$1${REDACTED}`],
  [/("(?:password|apiKey|token|secret)"\s*:\s*)"[^"]*"/gi, `$1"${REDACTED}"`],
  [/(postgres(?:ql)?:\/\/[^:/\s@]+:)[^@\s]+@/gi, `$1${REDACTED}@`],
]

export class Redactor {
  private values = new Set<string>()

  constructor(values: Iterable<string> = []) {
    for (const v of values) this.add(v)
  }

  add(value: string | undefined | null): void {
    if (typeof value === 'string' && value.length >= MIN_SECRET_LENGTH) this.values.add(value)
  }

  known(): string[] {
    return [...this.values]
  }

  redact(text: string): string {
    let out = text
    // longest first, so a value containing another is replaced whole
    for (const v of [...this.values].sort((a, b) => b.length - a.length)) {
      if (out.includes(v)) out = out.split(v).join(REDACTED)
    }
    for (const [re, rep] of PATTERNS) out = out.replace(re, rep)
    return out
  }
}

export function redact(text: string, values: Iterable<string> = []): string {
  return new Redactor(values).redact(text)
}
