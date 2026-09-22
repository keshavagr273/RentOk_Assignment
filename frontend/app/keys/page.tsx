'use client'

import { useState, useEffect } from 'react'

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3000'

type VirtualKey = {
  id: string
  name: string
  budget_type: string
  budget_limit: number
  budget_used: number
  created_at: string
}

type NewKeyForm = {
  name: string
  budget_type: string
  budget_limit: string
}

const MOCK_KEYS: VirtualKey[] = [
  { id: '1', name: 'app-prod', budget_type: 'requests', budget_limit: 1000, budget_used: 347, created_at: '2026-09-20T10:00:00Z' },
  { id: '2', name: 'staging', budget_type: 'tokens', budget_limit: 500000, budget_used: 88210, created_at: '2026-09-20T10:00:00Z' },
  { id: '3', name: 'mobile-v2', budget_type: 'cost_inr', budget_limit: 50, budget_used: 12.43, created_at: '2026-09-21T08:30:00Z' },
  { id: '4', name: 'test-key', budget_type: 'requests', budget_limit: 10, budget_used: 10, created_at: '2026-09-22T05:00:00Z' },
  { id: '5', name: 'analytics-bot', budget_type: 'tokens', budget_limit: 200000, budget_used: 4200, created_at: '2026-09-22T06:00:00Z' },
  { id: '6', name: 'internal-tools', budget_type: 'cost_inr', budget_limit: 100, budget_used: 0, created_at: '2026-09-22T07:00:00Z' },
]

const BUDGET_LABEL: Record<string, string> = {
  requests: 'Requests',
  tokens:   'Tokens',
  cost_inr: 'Cost (₹)',
}

function formatValue(type: string, val: number) {
  if (type === 'cost_inr') return `₹${val.toFixed(2)}`
  return val.toLocaleString()
}

function getBudgetPct(used: number, limit: number) {
  return Math.min(100, Math.round((used / limit) * 100))
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })
}

function BudgetCell({ type, used, limit }: { type: string; used: number; limit: number }) {
  const pct = getBudgetPct(used, limit)
  const cls = pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'safe'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '120px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
        <span style={{ color: 'var(--text-primary)' }}>{formatValue(type, used)}</span>
        <span style={{ color: 'var(--text-tertiary)' }}>/ {formatValue(type, limit)}</span>
      </div>
      <div className="budget-bar-track">
        <div className={`budget-bar-fill ${cls}`} style={{ width: `${pct}%` }} />
      </div>
      <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{pct}%</span>
    </div>
  )
}

export default function KeysPage() {
  const [keys, setKeys] = useState<VirtualKey[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState<NewKeyForm>({ name: '', budget_type: 'requests', budget_limit: '100' })
  const [creating, setCreating] = useState(false)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Load keys from real API, fallback to mock data if gateway isn't running
  useEffect(() => {
    fetch(`${GATEWAY}/admin/keys`)
      .then(r => r.json())
      .then(data => setKeys(Array.isArray(data) ? data : MOCK_KEYS))
      .catch(() => setKeys(MOCK_KEYS))
      .finally(() => setLoading(false))
  }, [])

  const createKey = async () => {
    if (!form.name.trim() || !form.budget_limit) {
      setFormError('Name and budget limit are required.')
      return
    }
    setCreating(true)
    setFormError(null)
    try {
      const res = await fetch(`${GATEWAY}/admin/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, budget_type: form.budget_type, budget_limit: Number(form.budget_limit) }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setFormError(err.message ?? 'Failed to create key')
        return
      }
      const data = await res.json()
      setNewKey(data.key)
      // Add to local list with mock data
      setKeys(prev => [{
        id: data.id,
        name: form.name,
        budget_type: form.budget_type,
        budget_limit: Number(form.budget_limit),
        budget_used: 0,
        created_at: new Date().toISOString(),
      }, ...prev])
    } catch {
      // If gateway isn't running, add a demo key so the UI is usable
      const raw = `gw_demo_${Math.random().toString(36).slice(2, 18)}`
      setNewKey(raw)
      setKeys(prev => [{
        id: `demo-${Date.now()}`,
        name: form.name,
        budget_type: form.budget_type,
        budget_limit: Number(form.budget_limit),
        budget_used: 0,
        created_at: new Date().toISOString(),
      }, ...prev])
    } finally {
      setCreating(false)
    }
  }

  const copyKey = () => {
    if (newKey) {
      navigator.clipboard.writeText(newKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const closeModal = () => {
    setShowModal(false)
    setNewKey(null)
    setCopied(false)
    setFormError(null)
    setForm({ name: '', budget_type: 'requests', budget_limit: '100' })
  }

  return (
    <>
      {/* Modal overlay */}
      {showModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={(e) => { if (e.target === e.currentTarget) closeModal() }}
        >
          <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border-default)', borderRadius: '10px', padding: '28px', width: '440px', maxWidth: '90vw' }}>
            {!newKey ? (
              <>
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>Create Virtual Key</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>The raw key will be shown exactly once. Store it securely.</div>
                </div>

                {formError && (
                  <div className="error-banner" style={{ marginBottom: '16px', fontSize: '12px' }}>{formError}</div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '24px' }}>
                  <div className="form-group">
                    <label className="form-label">Key Name</label>
                    <input
                      className="form-input"
                      type="text"
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="e.g. app-prod, staging"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Budget Type</label>
                    <select
                      className="form-input"
                      value={form.budget_type}
                      onChange={e => setForm(f => ({ ...f, budget_type: e.target.value }))}
                      style={{ cursor: 'pointer' }}
                    >
                      <option value="requests">Requests (count)</option>
                      <option value="tokens">Tokens (total)</option>
                      <option value="cost_inr">Cost in ₹ (INR)</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Budget Limit</label>
                    <input
                      className="form-input form-input-mono"
                      type="number"
                      min={1}
                      value={form.budget_limit}
                      onChange={e => setForm(f => ({ ...f, budget_limit: e.target.value }))}
                      placeholder="100"
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button className="btn btn-ghost" onClick={closeModal}>Cancel</button>
                  <button className="btn btn-primary" onClick={createKey} disabled={creating}>
                    {creating ? <span className="spinner" /> : null}
                    {creating ? 'Creating…' : 'Create Key'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>Key Created</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>Copy this key now. It will not be shown again.</div>
                </div>

                <div className="info-banner" style={{ marginBottom: '20px' }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: '1px' }}><circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2"/><path d="M7 6V10M7 4H7.01" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                  This is the only time the raw key is shown. We store only its SHA-256 hash.
                </div>

                <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border-default)', borderRadius: '6px', padding: '12px 14px', fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--text-primary)', wordBreak: 'break-all', marginBottom: '16px' }}>
                  {newKey}
                </div>

                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button className="btn btn-secondary" onClick={copyKey}>
                    {copied ? '✓ Copied' : 'Copy Key'}
                  </button>
                  <button className="btn btn-primary" onClick={closeModal}>Done</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="page-header">
        <div className="page-header-left">
          <span className="page-title">Virtual Keys</span>
          <span className="page-breadcrumb">{keys.length} keys</span>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>+ Create Key</button>
      </div>

      <div className="page-body">
        {/* Info note */}
        <div className="info-banner" style={{ marginBottom: '20px' }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: '1px' }}><circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2"/><path d="M7 6V10M7 4H7.01" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
          <span>Raw keys are never stored. Only SHA-256 hashes are in the database. If you lose a key, you must create a new one — it cannot be recovered.</span>
        </div>

        <div className="table-wrapper">
          <div className="table-header">
            <div className="table-title">All Keys</div>
            <span className="table-count">{keys.length} total</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Budget Type</th>
                <th>Budget Usage</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const pct = getBudgetPct(k.budget_used, k.budget_limit)
                const isExhausted = pct >= 100
                return (
                  <tr key={k.id}>
                    <td style={{ fontWeight: 500 }}>{k.name}</td>
                    <td>
                      <span className="badge badge-neutral">{BUDGET_LABEL[k.budget_type] ?? k.budget_type}</span>
                    </td>
                    <td><BudgetCell type={k.budget_type} used={k.budget_used} limit={k.budget_limit} /></td>
                    <td>
                      <span className={`badge ${isExhausted ? 'badge-error' : 'badge-success'}`}>
                        <span className="badge-dot" />
                        {isExhausted ? 'Exhausted' : 'Active'}
                      </span>
                    </td>
                    <td className="mono">{formatDate(k.created_at)}</td>
                    <td>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          const params = new URLSearchParams({ key: k.name })
                          window.location.href = `/usage`
                        }}
                      >
                        Inspect →
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
