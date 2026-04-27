'use client'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Building2 } from 'lucide-react'

export function EmptyAccountsState({ onClose }: { onClose: () => void }) {
  return (
    <div className="text-center py-8 space-y-4">
      <Building2 className="h-12 w-12 mx-auto text-muted-foreground" />
      <div className="space-y-1">
        <h3 className="font-medium">Set up an account first</h3>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          You need at least one Flipkart marketplace account before you can bulk-import reports.
          Each Seller Hub login is one &quot;account&quot; in FK-Tool.
        </p>
      </div>
      <div className="flex justify-center gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button asChild>
          <Link href="/settings">Open Settings →</Link>
        </Button>
      </div>
    </div>
  )
}
