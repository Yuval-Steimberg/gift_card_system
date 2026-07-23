import { NextResponse } from 'next/server'
import { getStore } from '@/lib/data'
import { serverEnv } from '@/lib/env'
import { generateGiftCardPdf } from '@/lib/gift-cards/pdf'
import { rateLimit, clientKeyFromHeaders } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: { token: string } }) {
  const rl = rateLimit(clientKeyFromHeaders(request.headers, 'pdf'), 30, 60_000)
  if (!rl.allowed) return new NextResponse('Too many requests', { status: 429 })

  const store = getStore()
  const card = await store.getGiftCardByToken(params.token)
  if (!card) return new NextResponse('Not found', { status: 404 })
  const template = await store.getTemplate(card.templateId)
  if (!template) return new NextResponse('Template missing', { status: 500 })

  const pdf = await generateGiftCardPdf(card, template, serverEnv().APP_BASE_URL)
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="gift-card-${card.code}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
