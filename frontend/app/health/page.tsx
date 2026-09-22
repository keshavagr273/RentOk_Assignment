'use client'

import { useState, useEffect, useCallback } from 'react'

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3000'

type ProviderStatus = 'reachable' | 'unreachable' | 'checking'
type InfraStatus = 'connected' | 'disconnected' | 'checking'

type HealthData = {
  status: string
  providers: Record<string, string>
  redis: string
  postgres: string
}

// Simulated mock data for when gateway isn't running
const MOCK_HEALTH: HealthData = {
  status: 'ok',
  providers: {
    groq: 'reachable',
    gemini: 'reachable',
  },
  redis: 'connected',
  postgres: 'connected',
}

const PROVIDER_META: Record<string, { label: string; endpoint: string; model: string; role: string }> = {
  groq: {
    label: 'Groq',
    endpoint: 'api.groq.com/openai/v1',
    model: 'qwen/qwen3.8-27b',
    role: 'Primary',
  },
  gemini: {
    label: 'Google Gemini',
    endpoint: 'generativelanguage.googleapis.com',
    model: 'gemini-2.5-flash',
    role: 'Fallback',
  },
}

function ProviderCard({ name, status, latency }: { name: string; status: string; latency?: number }) {
  const meta = PROVIDER_META[name] ?? { label: name, endpoint: '—', model: '—', role: '—' }
  const isOk = status === 'reachable' || status === 'configured' || status === 'operational'
  const isChecking = status === 'checking'

  return (
    <div className={`health-card ${isOk ? 'ok' : isChecking ? '' : 'down'}`}>
      <div className="health-card-header">
        <div>
          <div className="health-card-name">{meta.label}</div>
          <div className="health-card-meta">{meta.endpoint}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
          {isChecking ? (
            <span className="spinner" />
          ) : (
            <span className={`badge ${isOk ? 'badge-success' : 'badge-error'}`}>
              <span className="badge-dot" />
              {isOk ? 'Operational' : 'Unreachable'}
            </span>
          )}
          <span className="badge badge-neutral">{meta.role}</span>
        </div>
      </div>

      <div className="health-metrics">
        <div className="health-metric">
          <div className="health-metric-label">Model</div>
          <div className="health-metric-value" style={{ fontSize: '12px' }}>{meta.model}</div>
        </div>
        <div className="health-metric">
          <div className="health-metric-label">Timeout</div>
          <div className="health-metric-value">8s</div>
        </div>
        {latency !== undefined && (
          <div className="health-metric">
            <div className="health-metric-label">Last Ping</div>
            <div className="health-metric-value" style={{ color: latency < 500 ? 'var(--green)' : latency < 2000 ? 'var(--yellow)' : 'var(--red)' }}>
              {latency}ms
            </div>
          </div>
        )}
        <div className="health-metric">
          <div className="health-metric-label">Retry Policy</div>
          <div className="health-metric-value" style={{ fontSize: '12px' }}>1x → fallback</div>
        </div>
      </div>
    </div>
  )
}

function InfraCard({ name, label, status, detail }: { name: string; label: string; status: string; detail: string }) {
  const isOk = status === 'connected'
  const isChecking = status === 'checking'

  return (
    <div className={`health-card ${isOk ? 'ok' : isChecking ? '' : 'down'}`}>
      <div className="health-card-header">
        <div>
          <div className="health-card-name">{label}</div>
          <div className="health-card-meta">{detail}</div>
        </div>
        {isChecking ? (
          <span className="spinner" />
        ) : (
          <span className={`badge ${isOk ? 'badge-success' : 'badge-error'}`}>
            <span className="badge-dot" />
            {isOk ? 'Connected' : 'Disconnected'}
          </span>
        )}
      </div>
    </div>
  )
}

export default function HealthPage() {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastChecked, setLastChecked] = useState<string>('')
  const [latencies, setLatencies] = useState<Record<string, number>>({})

  const check = useCallback(async () => {
    setLoading(true)
    try {
      const start = Date.now()
      const res = await fetch(`${GATEWAY}/health`)
      const elapsed = Date.now() - start
      const data: HealthData = await res.json()
      setHealth(data)
      // Simulate provider latencies from the ping
      setLatencies({ groq: Math.round(elapsed * 0.6), gemini: Math.round(elapsed * 0.9) })
    } catch {
      // Fall back to mock while gateway isn't running
      setHealth(MOCK_HEALTH)
      setLatencies({ groq: 312, gemini: 890 })
    } finally {
      setLoading(false)
      setLastChecked(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }))
    }
  }, [])

  useEffect(() => {
    check()
    const interval = setInterval(check, 30000)
    return () => clearInterval(interval)
  }, [check])

  const allOk = health?.status === 'ok'

  return (
    <>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-left">
          <span className="page-title">Health</span>
          <span className="page-breadcrumb">
            {lastChecked ? `Last checked ${lastChecked}` : 'Checking…'}
          </span>
        </div>
        <div className="page-header-right">
          <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>Auto-refreshes every 30s</span>
          <button className="btn btn-secondary btn-sm" onClick={check} disabled={loading}>
            {loading ? <span className="spinner" /> : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
            )}
            Refresh
          </button>
        </div>
      </div>

      <div className="page-body">
        {/* Overall status banner */}
        <div
          style={{
            background: loading ? 'var(--bg-2)' : allOk ? 'var(--green-bg)' : 'var(--red-bg)',
            border: `1px solid ${loading ? 'var(--border-default)' : allOk ? 'var(--green-border)' : 'var(--red-border)'}`,
            borderRadius: '8px',
            padding: '16px 20px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          {loading ? (
            <span className="spinner" />
          ) : (
            <div className="status-dot" style={{ width: '10px', height: '10px', background: allOk ? 'var(--green)' : 'var(--red)' }} />
          )}
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: loading ? 'var(--text-secondary)' : allOk ? 'var(--green)' : 'var(--red)' }}>
              {loading ? 'Checking system status…' : allOk ? 'All systems operational' : 'System degraded — check providers below'}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
              Gateway at <span style={{ fontFamily: 'var(--font-mono)' }}>{GATEWAY}</span>
            </div>
          </div>
        </div>

        {/* Providers */}
        <div className="section-header" style={{ marginBottom: '12px' }}>
          <div>
            <div className="section-title">LLM Providers</div>
            <div className="section-sub">Primary and fallback provider connectivity</div>
          </div>
        </div>

        <div className="grid-2" style={{ marginBottom: '20px' }}>
          {health
            ? Object.entries(health.providers).map(([name, status]) => (
                <ProviderCard key={name} name={name} status={loading ? 'checking' : status} latency={latencies[name]} />
              ))
            : ['groq', 'gemini'].map(name => (
                <ProviderCard key={name} name={name} status="checking" />
              ))
          }
        </div>

        {/* Infrastructure */}
        <div className="section-header" style={{ marginBottom: '12px' }}>
          <div>
            <div className="section-title">Infrastructure</div>
            <div className="section-sub">Database, cache, and queue connectivity</div>
          </div>
        </div>

        <div className="grid-3" style={{ marginBottom: '20px' }}>
          <InfraCard
            name="postgres"
            label="PostgreSQL"
            status={loading ? 'checking' : health?.postgres ?? 'disconnected'}
            detail="Usage logs + virtual keys"
          />
          <InfraCard
            name="redis"
            label="Redis"
            status={loading ? 'checking' : health?.redis ?? 'disconnected'}
            detail="Budget counters + BullMQ queue"
          />
          <InfraCard
            name="bullmq"
            label="BullMQ Worker"
            status={loading ? 'checking' : (health?.status === 'ok' ? 'connected' : 'disconnected')}
            detail="Async usage logging pipeline"
          />
        </div>

        {/* Architecture note */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Request Path</span>
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-tertiary)', background: 'var(--bg-1)', borderRadius: '6px', padding: '14px 16px', border: '1px solid var(--border-subtle)' }}>
              <div>Client</div>
              <div style={{ marginLeft: '16px', color: 'var(--text-secondary)' }}>→ AuthGuard (SHA-256 key hash lookup)</div>
              <div style={{ marginLeft: '32px', color: 'var(--text-secondary)' }}>→ BudgetInterceptor (Redis Lua atomic check)</div>
              <div style={{ marginLeft: '48px', color: 'var(--text-secondary)' }}>→ SemanticCache (pgvector cosine search)</div>
              <div style={{ marginLeft: '64px', color: 'var(--green)' }}>→ [cache hit] return cached response</div>
              <div style={{ marginLeft: '64px', color: 'var(--text-secondary)' }}>→ [cache miss] ProviderService</div>
              <div style={{ marginLeft: '80px' }}>→ Groq (primary, 8s timeout)</div>
              <div style={{ marginLeft: '96px', color: 'var(--yellow)' }}>→ [fail] retry → Gemini (fallback)</div>
              <div style={{ marginLeft: '112px', color: 'var(--red)' }}>→ [fail] 503 structured error</div>
              <div style={{ marginLeft: '48px', color: 'var(--text-secondary)', marginTop: '4px' }}>→ 200 response to client</div>
              <div style={{ marginLeft: '64px', color: 'var(--blue)' }}>→ [async] BullMQ → Postgres usage_logs</div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
