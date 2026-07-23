import { requireRole } from '@/lib/auth/guards'
import { getSettings } from '@/lib/gift-cards/service'
import { SettingsForm } from '@/components/admin/settings-form'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  await requireRole(['owner', 'admin'], '/employee/login')
  const settings = await getSettings()
  return (
    <div>
      <h1 className="mb-6 text-2xl">הגדרות מערכת</h1>
      <SettingsForm settings={settings} />
    </div>
  )
}
