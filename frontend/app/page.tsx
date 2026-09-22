'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3000'

// Mock data for when the backend isn't connected yet
const MOCK_STATS = {
  total_requests_today: 847,
  total_cost_today_inr: 12.43,
  cache_hit_rate: 23.4,
  active_keys: 6,
  requests_delta: '+12%',
  cost_delta: '-3%',
  cache_delta: '+5%',
  keys_delta: '+1',
}

const MOCK_RECENT = [
  { ts: '09:41:02', key: 'app-prod', model: 'llama3-8b', provider: 'groq', tokens: '12/143', cost: '₹0.009', latency: '312ms', status: 'success', cache: false },
  { ts: '09:40:55', key: 'staging', model: 'llama3-8b', provider: 'groq', tokens: '88/420', cost: '₹0.031', latency: '580ms', status: 'success', cache: true },
  { ts: '09:40:48', key: 'app-prod', model: 'gemini-flash', provider: 'gemini', tokens: '24/95', cost: '₹0.006', latency: '1243ms', status: 'fallback_used', cache: false },
  { ts: '09:40:31', key: 'test-key', model: 'llama3-8b', provider: 'groq', tokens: '0/0', cost: '—', latency: '2ms', status: 'rejected_budget', cache: false },
  { ts: '09:40:19', key: 'app-prod', model: 'llama3-8b', provider: 'groq', tokens: '16/230', cost: '₹0.015', latency: '418ms', status: 'success', cache: true },
  { ts: '09:40:07', key: 'mobile-v2', model: 'llama3-70b', provider: 'groq', tokens: '45/512', cost: '₹0.048', latency: '920ms', status: 'success', cache: false },
  { ts: '09:39:52', key: 'app-prod', model: 'llama3-8b', provider: 'groq', tokens: '9/87', cost: '₹0.006', latency: '291ms', status: 'success', cache: true },
  { ts: '09:39:38', key: 'staging', model: 'llama3-8b', provider: 'groq', tokens: '32/198', cost: '₹0.014', latency: '470ms', status: 'error', cache: false },
]

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  success:         { label: 'Success',     cls: 'badge-success' },
  fallback_used:   { label: 'Fallback',    cls: 'badge-warning' },
  rejected_budget: { label: 'Rejected',    cls: 'badge-error' },
  error:           { label: 'Error',       cls: 'badge-error' },
  cache_hit:       { label: 'Cache Hit',   cls: 'badge-info' },
}

// Simple sparkline using CSS bars — no chart library needed
function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(...data)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '32px' }}>
      {data.map((v, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: `${Math.round((v / max) * 100)}%`,
            background: 'var(--text-tertiary)',
            borderRadius: '1px',
            minHeight: '2px',
          }}
        />
      ))}
    </div>
  )
}

export default function DashboardPage() {
  const [stats] = useState(MOCK_STATS)
  const [reqs] = useState(MOCK_RECENT)

  // Simulated hourly request data for sparklines
  const reqData = [42, 68, 95, 71, 110, 88, 123, 99, 140, 87, 103, 115]
  const costData = [0.3, 0.5, 0.7, 0.5, 0.8, 0.6, 0.9, 0.7, 1.0, 0.6, 0.7, 0.8]

  return (
    <>
      {/* Header */}
      <div className="page-header">
        <div className="page-header-left">
          <span className="page-title">Dashboard</span>
          <span className="page-breadcrumb">Today</span>
        </div>
        <div className="page-header-right">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            <div className="status-dot green" />
            Live
          </div>
          <Link href="/keys">
            <button className="btn btn-primary btn-sm">+ New Key</button>
          </Link>
        </div>
      </div>

      <div className="page-body">
        {/* Metric Cards */}
        <div className="metric-grid">
          <div className="metric-card">
            <div className="metric-label">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1L11 10H1L6 1Z" stroke="currentColor" strokeWidth="1.2" fill="none"/></svg>
              Requests Today
            </div>
            <div className="metric-value">{stats.total_requests_today.toLocaleString()}</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="metric-sub">last 24h</span>
              <span className="metric-delta up">{stats.requests_delta}</span>
            </div>
            <Sparkline data={reqData} />
          </div>

          <div className="metric-card">
            <div className="metric-label">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><path d="M4 6H8M6 4V8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
              Total Cost Today
            </div>
            <div className="metric-value">₹{stats.total_cost_today_inr.toFixed(2)}</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="metric-sub">estimated</span>
              <span className="metric-delta down">{stats.cost_delta}</span>
            </div>
            <Sparkline data={costData} />
          </div>

          <div className="metric-card">
            <div className="metric-label">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Cache Hit Rate
            </div>
            <div className="metric-value">{stats.cache_hit_rate}%</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="metric-sub">semantic cache</span>
              <span className="metric-delta up">{stats.cache_delta}</span>
            </div>
            <div className="budget-bar-track" style={{ marginTop: '12px' }}>
              <div className="budget-bar-fill safe" style={{ width: `${stats.cache_hit_rate}%` }} />
            </div>
          </div>

          <div className="metric-card">
            <div className="metric-label">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="4" r="2.5" stroke="currentColor" strokeWidth="1.2"/><path d="M1 11C1 9.067 3.239 7.5 6 7.5S11 9.067 11 11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
              Active Keys
            </div>
            <div className="metric-value">{stats.active_keys}</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="metric-sub">virtual keys</span>
              <span className="metric-delta up">{stats.keys_delta}</span>
            </div>
            <Link href="/keys" style={{ display: 'block', marginTop: '12px' }}>
              <button className="btn btn-ghost btn-sm" style={{ width: '100%' }}>Manage keys →</button>
            </Link>
          </div>
        </div>

        {/* Recent Requests Table */}
        <div className="table-wrapper">
          <div className="table-header">
            <div>
              <div className="table-title">Recent Requests</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="table-count">{reqs.length} shown</span>
              <Link href="/usage">
                <button className="btn btn-ghost btn-sm">View all →</button>
              </Link>
            </div>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Key</th>
                <th>Model</th>
                <th>Provider</th>
                <th>Tokens In / Out</th>
                <th>Cost</th>
                <th>Latency</th>
                <th>Status</th>
                <th>Cache</th>
              </tr>
            </thead>
            <tbody>
              {reqs.map((r, i) => {
                const s = STATUS_CONFIG[r.status] ?? { label: r.status, cls: 'badge-neutral' }
                return (
                  <tr key={i}>
                    <td className="mono">{r.ts}</td>
                    <td>
                      <span className="hash">{r.key}</span>
                    </td>
                    <td className="mono">{r.model}</td>
                    <td>
                      <span className="badge badge-neutral">
                        <span className="badge-dot" />
                        {r.provider}
                      </span>
                    </td>
                    <td className="mono">{r.tokens}</td>
                    <td className="mono">{r.cost}</td>
                    <td className="mono">{r.latency}</td>
                    <td>
                      <span className={`badge ${s.cls}`}>
                        <span className="badge-dot" />
                        {s.label}
                      </span>
                    </td>
                    <td>
                      {r.cache ? (
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
        </div>

        {/* Bottom row */}
        <div className="grid-2" style={{ marginTop: '16px' }}>
          {/* Provider breakdown */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Provider Breakdown</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {[
                { name: 'Groq (primary)', count: 712, pct: 84 },
                { name: 'Gemini (fallback)', count: 89, pct: 11 },
                { name: 'Cache (served)', count: 46, pct: 5 },
              ].map((p) => (
                <div key={p.name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{p.name}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-tertiary)' }}>{p.count} req · {p.pct}%</span>
                  </div>
                  <div className="budget-bar-track">
                    <div className="budget-bar-fill safe" style={{ width: `${p.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Status breakdown */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Status Breakdown</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { label: 'Success', count: 712, cls: 'badge-success' },
                { label: 'Fallback Used', count: 89, cls: 'badge-warning' },
                { label: 'Cache Hit', count: 46, cls: 'badge-info' },
                { label: 'Budget Rejected', count: 0, cls: 'badge-error' },
                { label: 'Error', count: 0, cls: 'badge-error' },
              ].map((s) => (
                <div key={s.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span className={`badge ${s.cls}`}>
                    <span className="badge-dot" />
                    {s.label}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--text-primary)', fontWeight: 500 }}>
                    {s.count.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
