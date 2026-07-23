import { NextResponse } from 'next/server'
import { assertPermission, AuthorizationError } from '@/lib/auth/guards'
import { getStore } from '@/lib/data'
import { toMajor } from '@/lib/money'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function csvCell(v: unknown): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * CSV export of gift cards. Financial export is permission-gated
 * (export:financial) and enforced server-side.
 */
export async function GET() {
  try {
    await assertPermission('export:financial')
  } catch (e) {
    if (e instanceof AuthorizationError) return new NextResponse('Forbidden', { status: 403 })
    throw e
  }
  const { items } = await getStore().listGiftCards({ limit: 100000 })
  const header = [
    'code',
    'status',
    'currency',
    'initial_amount',
    'balance',
    'recipient_name',
    'recipient_email',
    'buyer_name',
    'buyer_email',
    'issued_at',
    'expires_at',
    'created_at',
  ]
  const rows = items.map((c) =>
    [
      c.code,
      c.status,
      c.currency,
      toMajor(c.initialAmountMinor, c.currency),
      toMajor(c.balanceMinor, c.currency),
      c.recipientName,
      c.recipientEmail,
      c.isAnonymous ? '' : (c.buyerName ?? ''),
      c.buyerEmail,
      c.issuedAt ?? '',
      c.expiresAt ?? '',
      c.createdAt,
    ]
      .map(csvCell)
      .join(','),
  )
  // BOM for Excel Hebrew compatibility.
  const csv = '﻿' + [header.join(','), ...rows].join('\n')
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="gift-cards-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
