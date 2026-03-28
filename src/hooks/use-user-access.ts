'use client'

import { useState, useEffect, useCallback } from 'react'
import { hasPageAccess } from '@/lib/auth/page-access'
import type { UserRole } from '@/types/database'

interface UserAccess {
  role: UserRole | null
  allowedPages: string[] | null
  isOwner: boolean
  canAccess: (page: string) => boolean
  loading: boolean
}

export function useUserAccess(): UserAccess {
  const [role, setRole] = useState<UserRole | null>(null)
  const [allowedPages, setAllowedPages] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/me')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (cancelled || !data) return
        setRole(data.role)
        setAllowedPages(data.allowed_pages)
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const canAccess = useCallback(
    (page: string) => hasPageAccess(allowedPages, page),
    [allowedPages]
  )

  return {
    role,
    allowedPages,
    isOwner: role === 'owner',
    canAccess,
    loading,
  }
}
