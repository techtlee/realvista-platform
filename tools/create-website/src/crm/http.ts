/** fetch-based Http (Ctx.http). Never throws on a status; throws on network errors/timeouts. */
import type { Http, HttpRequest, HttpResponse } from '../types.js'

export class FetchHttp implements Http {
  async request(r: HttpRequest): Promise<HttpResponse> {
    const res = await fetch(r.url, {
      method: r.method ?? 'GET',
      headers: r.headers ?? {},
      ...(r.body !== undefined ? { body: r.body } : {}),
      redirect: r.redirect ?? 'manual',
      signal: AbortSignal.timeout(r.timeoutMs ?? 15_000),
    })
    const headers: Record<string, string> = {}
    res.headers.forEach((v, k) => {
      headers[k] = v
    })
    return { status: res.status, headers, text: await res.text() }
  }
}
