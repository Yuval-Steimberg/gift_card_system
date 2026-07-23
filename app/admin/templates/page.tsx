import { requireRole } from '@/lib/auth/guards'
import { getStore } from '@/lib/data'
import { TemplateManager } from '@/components/admin/template-manager'

export const dynamic = 'force-dynamic'

export default async function TemplatesPage() {
  await requireRole(['owner', 'admin'], '/employee/login')
  const templates = await getStore().listTemplates(true)
  return (
    <div>
      <h1 className="mb-6 text-2xl">עיצובי שוברים</h1>
      <TemplateManager templates={templates} />
    </div>
  )
}
