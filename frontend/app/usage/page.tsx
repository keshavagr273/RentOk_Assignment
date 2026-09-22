'use client'

import { useState, useCallback, useEffect } from 'react'

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3000'

type UsageData = {
  key_name: string
  budget_type: string
  budget_limit: number
  budget_used: number
  remaining: number
  cache_hits: number
  cache_hit_rate: string
  total_requests: number
  recent_requests: RecentRequest[]
}

type RecentRequest = {
  created_at: string
  model: string
  provider: string
  tokens_in: number
  tokens_out: number
  cost_estimate_inr: number
  latency_ms: number
  status: string
  cache_hit: boolean
}

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  success:          { label: 'Success',    cls: 'badge-success' },
  fallback_used:    { label: 'Fallback',   cls: 'badge-warning' },
  rejected_budget:  { label: 'Rejected',   cls: 'badge-error' },
  error:            { label: 'Error',      cls: 'badge-error' },
}

const BUDGET_LABEL: Record<string, string> = {
  requests: 'Requests',
  tokens:   'Tokens',
  cost_inr: 'Cost (₹)',
}

function formatBudgetValue(type: string, val: number) {
  if (type === 'cost_inr') return `₹${val.toFixed(2)}`
  return val.toLocaleString()
}

function getBudgetPct(used: number, limit: number) {
  return Math.min(100, Math.round((used / limit) * 100))
}

function getBudgetClass(pct: number) {
  if (pct >= 90) return 'danger'
  if (pct >= 70) return 'warn'
  return 'safe'
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

export default function UsagePage() {
  const [key, setKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<UsageData | null>(null)
  const [searched, setSearched] = useState(false)

  const lookup = useCallback(async (targetKey?: string) => {
    const keyToSearch = (targetKey ?? key).trim()
    if (!keyToSearch) return
    setLoading(true)
    setError(null)
    setSearched(true)

    try {
      const res = await fetch(`${GATEWAY}/usage?key=${encodeURIComponent(keyToSearch)}`)
      if (res.status === 404) {
        setError('Key not found. Check that you entered the correct virtual key or ID.')
        setData(null)
      } else if (!res.ok) {
        setError(`Gateway error (${res.status}): ${res.statusText}`)
        setData(null)
      } else {
        const json = await res.json()
        setData(json)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError(`Could not reach gateway at ${GATEWAY}. Is it running?\n${message}`)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [key])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const q = params.get('key') || params.get('id')
      if (q) {
        setKey(q)
        lookup(q)
      }
    }
  }, [lookup])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') lookup()
  }

  const pct = data ? getBudgetPct(data.budget_used, data.budget_limit) : 0

  return (
    <>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-left">
          <span className="page-title">Usage Lookup</span>
          <span className="page-breadcrumb">Inspect a virtual key</span>
        </div>
      </div>

      <div className="page-body">
        {/* Search bar */}
        <div className="card" style={{ marginBottom: '20px' }}>
          <div style={{ marginBottom: '12px' }}>
            <div className="section-title">Look up a virtual key</div>
            <div className="section-sub">Enter the raw virtual key to see its budget and usage history</div>
          </div>
          <div className="form-row">
            <div className="form-group" style={{ flex: 1 }}>
              <input
                className="form-input form-input-mono"
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="gw_xxxxxxxxxxxxxxxxxxxxxxxx"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <button
              className="btn btn-primary"
              onClick={() => lookup()}
              disabled={loading || !key.trim()}
              style={{ height: '38px' }}
            >
              {loading ? <span className="spinner" /> : null}
              {loading ? 'Looking up…' : 'Look up'}
            </button>
          </div>
          <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
            The raw key is hashed server-side and never stored in plain text. This endpoint reads only from the hash lookup.
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="error-banner" style={{ marginBottom: '20px' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2"/><path d="M7 4V7.5M7 10H7.01" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
            <pre style={{ fontFamily: 'inherit', whiteSpace: 'pre-wrap', margin: 0 }}>{error}</pre>
          </div>
        )}

        {/* Key not found, searched but nothing */}
        {searched && !loading && !error && !data && (
          <div className="table-wrapper">
            <div className="empty-state">
              <svg className="empty-state-icon" width="32" height="32" viewBox="0 0 32 32" fill="none"><circle cx="14" cy="14" r="10" stroke="currentColor" strokeWidth="1.5"/><path d="M22 22L28 28" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              <div className="empty-state-title">No key found</div>
              <div className="empty-state-sub">The key you entered doesn&apos;t match any virtual key in the gateway.</div>
            </div>
          </div>
        )}

        {/* Results */}
        {data && (
          <div className="key-detail">
            {/* Key header */}
            <div className="card">
              <div className="key-detail-header">
                <div>
                  <div className="key-detail-name">{data.key_name}</div>
                  <div className="key-detail-id">
                    Budget type: <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{BUDGET_LABEL[data.budget_type] ?? data.budget_type}</span>
                  </div>
                </div>
                <span className={`badge ${pct >= 90 ? 'badge-error' : pct >= 70 ? 'badge-warning' : 'badge-success'}`}>
                  <span className="badge-dot" />
                  {pct >= 90 ? 'Critical' : pct >= 70 ? 'Near limit' : 'Healthy'}
                </span>
              </div>

              {/* Stats row */}
              <div className="key-stats-row">
                <div className="key-stat">
                  <div className="key-stat-label">Limit</div>
                  <div className="key-stat-value">{formatBudgetValue(data.budget_type, data.budget_limit)}</div>
                </div>
                <div className="key-stat">
                  <div className="key-stat-label">Used</div>
                  <div className="key-stat-value">{formatBudgetValue(data.budget_type, data.budget_used)}</div>
                </div>
                <div className="key-stat">
                  <div className="key-stat-label">Remaining</div>
                  <div className="key-stat-value" style={{ color: pct >= 90 ? 'var(--red)' : pct >= 70 ? 'var(--yellow)' : 'var(--green)' }}>
                    {formatBudgetValue(data.budget_type, data.remaining)}
                  </div>
                </div>
              </div>

              {/* Budget bar */}
              <div className="budget-bar-wrap" style={{ marginTop: '16px' }}>
                <div className="budget-bar-labels">
                  <span>{pct}% used</span>
                  <span>{formatBudgetValue(data.budget_type, data.remaining)} remaining</span>
                </div>
                <div className="budget-bar-track">
                  <div className={`budget-bar-fill ${getBudgetClass(pct)}`} style={{ width: `${pct}%` }} />
                </div>
              </div>

              {/* Cache info */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Total Requests</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '2px' }}>{data.total_requests.toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Cache Hits</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '18px', fontWeight: 600, color: 'var(--blue)', marginTop: '2px' }}>{data.cache_hits}</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Cache Hit Rate</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '2px' }}>{data.cache_hit_rate}</div>
                </div>
              </div>
            </div>

            {/* Recent requests */}
            <div className="table-wrapper">
              <div className="table-header">
                <div className="table-title">Recent Requests</div>
                <span className="table-count">{data.recent_requests.length} of {data.total_requests}</span>
              </div>
              {data.recent_requests.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="none"><rect x="4" y="6" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.3"/><path d="M9 11H19M9 15H15" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                  </div>
                  <div className="empty-state-title">No requests yet</div>
                  <div className="empty-state-sub">This key hasn&apos;t made any requests yet.</div>
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Model</th>
                      <th>Provider</th>
                      <th>Tokens In</th>
                      <th>Tokens Out</th>
                      <th>Cost</th>
                      <th>Latency</th>
                      <th>Status</th>
                      <th>Cache</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_requests.map((r, i) => {
                      const s = STATUS_CONFIG[r.status] ?? { label: r.status, cls: 'badge-neutral' }
                      return (
                        <tr key={i}>
                          <td className="mono">{formatDate(r.created_at)}</td>
                          <td className="mono">{r.model}</td>
                          <td>
                            <span className="badge badge-neutral">
                              <span className="badge-dot" />
                              {r.provider}
                            </span>
                          </td>
                          <td className="mono">{r.tokens_in?.toLocaleString() ?? '—'}</td>
                          <td className="mono">{r.tokens_out?.toLocaleString() ?? '—'}</td>
                          <td className="mono">{r.cost_estimate_inr != null ? `₹${r.cost_estimate_inr.toFixed(4)}` : '—'}</td>
                          <td className="mono">{r.latency_ms}ms</td>
                          <td>
                            <span className={`badge ${s.cls}`}>
                              <span className="badge-dot" />
                              {s.label}
                            </span>
                          </td>
                          <td>
                            {r.cache_hit ? (
                              <span className="badge badge-info" style={{ fontSize: '10px', padding: '1px 6px' }}>HIT</span>
                            ) : (
                              <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Initial empty state */}
        {!searched && !loading && (
          <div className="table-wrapper">
            <div className="empty-state">
              <svg className="empty-state-icon" width="36" height="36" viewBox="0 0 36 36" fill="none"><circle cx="15" cy="15" r="8" stroke="currentColor" strokeWidth="1.4"/><path d="M21 21L29 29" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M11 15H15M15 11V19" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
              <div className="empty-state-title">Enter a virtual key above</div>
              <div className="empty-state-sub">Paste a gateway key (starting with <span className="inline-code">gw_</span>) to see its budget and request history.</div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
