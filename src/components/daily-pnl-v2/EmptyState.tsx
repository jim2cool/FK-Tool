'use client'
import Link from 'next/link'
import { Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function EmptyState() {
  return (
    <div className="border rounded-lg p-12 text-center space-y-4">
      <Building2 className="h-12 w-12 mx-auto text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-lg font-medium">No Flipkart accounts yet</p>
        <p className="text-sm text-muted-foreground">
          Each Seller Hub login is one account in FK-Tool. Add an account in Settings to start using the Daily P&amp;L Estimator.
        </p>
      </div>
      <Button asChild><Link href="/settings">Open Settings →</Link></Button>
    </div>
  )
}
