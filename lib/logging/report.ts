import 'server-only'

/**
 * Structured error reporting. Always logs a structured line; when SENTRY_DSN is
 * configured it also forwards the event to Sentry's ingest API (no SDK
 * dependency). Never throws — reporting must not break the request it reports on.
 */
export async function reportError(error: unknown, context: Record<string, unknown> = {}): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : undefined
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ level: 'error', message, ...context }))

  const dsn = process.env.SENTRY_DSN
  if (!dsn) return
  try {
    // DSN: https://<publicKey>@<host>/<projectId>
    const m = dsn.match(/^https:\/\/([^@]+)@([^/]+)\/(.+)$/)
    if (!m) return
    const [, publicKey, host, projectId] = m
    const body = {
      timestamp: Date.now() / 1000,
      platform: 'node',
      level: 'error',
      logger: 'gift_card_system',
      exception: { values: [{ type: 'Error', value: message, stacktrace: stack ? { frames: [] } : undefined }] },
      extra: context,
    }
    await fetch(`https://${host}/api/${projectId}/store/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=gcs/1.0, sentry_key=${publicKey}`,
      },
      body: JSON.stringify(body),
    })
  } catch {
    /* reporting is best-effort */
  }
}
