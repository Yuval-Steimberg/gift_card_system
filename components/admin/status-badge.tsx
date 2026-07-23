import { Badge } from '@/components/ui/badge'
import { STATUS_LABEL_HE } from '@/lib/gift-cards/status'
import type { GiftCardStatus } from '@/lib/gift-cards/types'

const VARIANT: Record<GiftCardStatus, React.ComponentProps<typeof Badge>['variant']> = {
  draft: 'muted',
  awaiting_payment: 'warning',
  payment_processing: 'warning',
  active: 'success',
  partially_redeemed: 'primary',
  fully_redeemed: 'muted',
  expired: 'muted',
  suspended: 'warning',
  cancelled: 'destructive',
  refunded: 'destructive',
  reissued: 'muted',
  failed: 'destructive',
}

export function StatusBadge({ status }: { status: GiftCardStatus }) {
  return <Badge variant={VARIANT[status]}>{STATUS_LABEL_HE[status]}</Badge>
}
