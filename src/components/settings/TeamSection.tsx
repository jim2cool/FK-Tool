'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { InfoTooltip } from '@/components/ui/info-tooltip'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import {
  ALL_PAGES,
  PAGE_LABELS,
  ROLE_PRESETS,
  type PageSlug,
} from '@/lib/auth/page-access'
import type { UserRole } from '@/types/database'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TeamMember {
  id: string
  email: string
  role: UserRole
  allowed_pages: string[] | null
  created_at: string
}

// ── Preset detection helper ───────────────────────────────────────────────────

function detectPreset(pages: string[] | null): string {
  if (pages === null) return 'Full Access'
  for (const [name, preset] of Object.entries(ROLE_PRESETS)) {
    if (preset.length === pages.length && preset.every(p => pages.includes(p))) {
      return name
    }
  }
  return 'Custom'
}

const ROLE_BADGE_COLORS: Record<string, string> = {
  owner: 'bg-amber-100 text-amber-800 border-amber-200',
  admin: 'bg-purple-100 text-purple-800 border-purple-200',
  manager: 'bg-blue-100 text-blue-800 border-blue-200',
  staff: 'bg-gray-100 text-gray-800 border-gray-200',
  member: 'bg-gray-100 text-gray-800 border-gray-200',
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TeamSection() {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)

  // Add member dialog
  const [addOpen, setAddOpen] = useState(false)
  const [addEmail, setAddEmail] = useState('')
  const [addPassword, setAddPassword] = useState('')
  const [addRole, setAddRole] = useState<string>('staff')
  const [addPreset, setAddPreset] = useState('Warehouse Staff')
  const [addPages, setAddPages] = useState<string[]>(ROLE_PRESETS['Warehouse Staff'])
  const [addSaving, setAddSaving] = useState(false)

  // Edit member dialog
  const [editOpen, setEditOpen] = useState(false)
  const [editMember, setEditMember] = useState<TeamMember | null>(null)
  const [editRole, setEditRole] = useState<string>('staff')
  const [editPreset, setEditPreset] = useState('Custom')
  const [editPages, setEditPages] = useState<string[]>([])
  const [editSaving, setEditSaving] = useState(false)

  // Remove confirmation
  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null)
  const [removeSaving, setRemoveSaving] = useState(false)

  const loadMembers = useCallback(async () => {
    const res = await fetch('/api/team')
    if (res.ok) {
      setMembers(await res.json())
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadMembers() }, [loadMembers])

  // ── Add member ──────────────────────────────────────────────────────────────

  function openAdd() {
    setAddEmail('')
    setAddPassword('')
    setAddRole('staff')
    setAddPreset('Warehouse Staff')
    setAddPages([...ROLE_PRESETS['Warehouse Staff']])
    setAddOpen(true)
  }

  function handleAddPresetChange(preset: string) {
    setAddPreset(preset)
    if (preset !== 'Custom' && ROLE_PRESETS[preset]) {
      setAddPages([...ROLE_PRESETS[preset]])
    }
  }

  function handleAddPageToggle(page: string, checked: boolean) {
    const next = checked ? [...addPages, page] : addPages.filter(p => p !== page)
    setAddPages(next)
    setAddPreset(detectPreset(next))
  }

  async function handleAdd() {
    if (!addEmail || !addPassword) {
      toast.error('Email and password are required')
      return
    }
    setAddSaving(true)
    try {
      const res = await fetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: addEmail,
          password: addPassword,
          role: addRole,
          allowed_pages: addPreset === 'Full Access' ? null : addPages,
        }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        toast.error(error)
      } else {
        toast.success(`${addEmail} added to team`)
        setAddOpen(false)
        loadMembers()
      }
    } catch {
      toast.error('Network error')
    }
    setAddSaving(false)
  }

  // ── Edit member ─────────────────────────────────────────────────────────────

  function openEdit(member: TeamMember) {
    setEditMember(member)
    setEditRole(member.role)
    const pages = member.allowed_pages ?? [...ALL_PAGES]
    setEditPages(pages)
    setEditPreset(detectPreset(member.allowed_pages))
    setEditOpen(true)
  }

  function handleEditPresetChange(preset: string) {
    setEditPreset(preset)
    if (preset !== 'Custom' && ROLE_PRESETS[preset]) {
      setEditPages([...ROLE_PRESETS[preset]])
    }
  }

  function handleEditPageToggle(page: string, checked: boolean) {
    const next = checked ? [...editPages, page] : editPages.filter(p => p !== page)
    setEditPages(next)
    setEditPreset(detectPreset(next))
  }

  async function handleEdit() {
    if (!editMember) return
    setEditSaving(true)
    try {
      const res = await fetch('/api/team', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: editMember.id,
          role: editRole,
          allowed_pages: editPreset === 'Full Access' ? null : editPages,
        }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        toast.error(error)
      } else {
        toast.success('Member updated')
        setEditOpen(false)
        loadMembers()
      }
    } catch {
      toast.error('Network error')
    }
    setEditSaving(false)
  }

  // ── Remove member ───────────────────────────────────────────────────────────

  async function handleRemove() {
    if (!removeTarget) return
    setRemoveSaving(true)
    try {
      const res = await fetch('/api/team', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: removeTarget.id }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        toast.error(error)
      } else {
        toast.success('Member removed')
        setRemoveTarget(null)
        loadMembers()
      }
    } catch {
      toast.error('Network error')
    }
    setRemoveSaving(false)
  }

  // ── Page checkboxes grid ────────────────────────────────────────────────────

  function renderPageCheckboxes(
    pages: string[],
    onToggle: (page: string, checked: boolean) => void
  ) {
    return (
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        {ALL_PAGES.filter(p => p !== 'dashboard').map(page => (
          <label key={page} className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={pages.includes(page)}
              onCheckedChange={(checked) => onToggle(page, !!checked)}
            />
            {PAGE_LABELS[page as PageSlug]}
          </label>
        ))}
      </div>
    )
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return <p className="text-sm text-muted-foreground py-4">Loading team...</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">
            Manage who can access your workspace and what they can see
          </p>
          <InfoTooltip content="Add team members with specific page access. Each member gets their own login and only sees the pages you allow." />
        </div>
        <Button onClick={openAdd}>
          <Plus className="h-4 w-4 mr-2" />
          Add Member
        </Button>
      </div>

      {/* Members table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Page Access</TableHead>
            <TableHead className="w-[100px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map(member => {
            const preset = detectPreset(member.allowed_pages)
            return (
              <TableRow key={member.id}>
                <TableCell className="text-sm">{member.email}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={ROLE_BADGE_COLORS[member.role] ?? ''}>
                    {member.role}
                  </Badge>
                </TableCell>
                <TableCell>
                  {member.allowed_pages === null ? (
                    <Badge variant="secondary">All pages</Badge>
                  ) : (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="outline" className="text-xs">{preset}</Badge>
                      <span className="text-xs text-muted-foreground">
                        ({member.allowed_pages.length} page{member.allowed_pages.length !== 1 ? 's' : ''})
                      </span>
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  {member.role !== 'owner' && (
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7"
                        onClick={() => openEdit(member)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                        onClick={() => setRemoveTarget(member)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      {/* ── Add Member Dialog ──────────────────────────────────────────────── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Team Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Email</Label>
                <Input type="email" value={addEmail}
                  onChange={e => setAddEmail(e.target.value)}
                  placeholder="staff@company.com" />
              </div>
              <div className="space-y-1">
                <Label>Password</Label>
                <Input type="password" value={addPassword}
                  onChange={e => setAddPassword(e.target.value)}
                  placeholder="Initial password" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Role</Label>
                <Select value={addRole} onValueChange={setAddRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="staff">Staff</SelectItem>
                    <SelectItem value="member">Member</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Preset</Label>
                <Select value={addPreset} onValueChange={handleAddPresetChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.keys(ROLE_PRESETS).map(name => (
                      <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                    <SelectItem value="Custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                Page Access
                <InfoTooltip content="Dashboard is always accessible. Toggle which other pages this member can see." />
              </Label>
              <p className="text-xs text-muted-foreground">Dashboard is always included.</p>
              {renderPageCheckboxes(addPages, handleAddPageToggle)}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={addSaving}>
              {addSaving ? 'Adding...' : 'Add Member'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Member Dialog ─────────────────────────────────────────────── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit {editMember?.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Role</Label>
                <Select value={editRole} onValueChange={setEditRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="staff">Staff</SelectItem>
                    <SelectItem value="member">Member</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Preset</Label>
                <Select value={editPreset} onValueChange={handleEditPresetChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.keys(ROLE_PRESETS).map(name => (
                      <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                    <SelectItem value="Custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Page Access</Label>
              <p className="text-xs text-muted-foreground">Dashboard is always included.</p>
              {renderPageCheckboxes(editPages, handleEditPageToggle)}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={editSaving}>
              {editSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Remove Confirmation Dialog ─────────────────────────────────────── */}
      <Dialog open={!!removeTarget} onOpenChange={() => setRemoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removeTarget?.email}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            This will permanently delete their account and remove all access to this workspace.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleRemove} disabled={removeSaving}>
              {removeSaving ? 'Removing...' : 'Remove Member'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
