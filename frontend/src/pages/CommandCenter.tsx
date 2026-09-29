import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Cpu, Camera, Navigation, Activity, ChevronRight } from 'lucide-react';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorAlert from '../components/ErrorAlert';
import { StatusBadge, PriorityBadge, ProvenanceBadge, StatusDot } from '../components/Badges';
import PotholeDonut from '../components/PotholeDonut';
import { getDashboard, getMonitoringStatus, getDashboardTrends } from '../services/api';
import { formatIST } from '../utils/date';
import type { DashboardStats, MonitoringStatus, DashboardTrends } from '../types';

const CommandCenter: React.FC = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [monitoring, setMonitoring] = useState<MonitoringStatus | null>(null);
  const [trends, setTrends] = useState<DashboardTrends | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, setLastRefreshed] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const [dashboard, mon, tr] = await Promise.all([
        getDashboard(),
        getMonitoringStatus().catch(() => null),
        getDashboardTrends().catch(() => null),
      ]);
      setStats(dashboard);
      setMonitoring(mon);
      setTrends(tr);
      setLastRefreshed(new Date());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard data from backend.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  function dotVariant(s?: string): 'online' | 'offline' | 'warning' | 'error' {
    if (!s) return 'offline';
    if (['ONLINE', 'LOCKED', 'STREAMING', 'CONNECTED'].includes(s)) return 'online';
    if (['SEARCHING', 'STANDBY', 'INITIALIZING'].includes(s)) return 'warning';
    return 'offline';
  }

  const activeEvents = stats?.recent_events.filter(e => e.status === 'ACTIVE') || [];
  const highPriorityCount = stats?.issues_by_priority?.HIGH || 0;
  const criticalPriorityCount = stats?.issues_by_priority?.CRITICAL || 0;
  const totalHighRisk = highPriorityCount + criticalPriorityCount;

  return (
    <div className="page-body">
      {loading && !stats && <LoadingSpinner message="Fetching dashboard data..." />}
      {error && <ErrorAlert message={error} onRetry={load} />}

      {stats && (
        <>
          {/* Today's Overview Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
            <div>
              <h1 className="page-title dashboard-greeting">Today's Overview</h1>
              <p className="page-subtitle">
                {monitoring?.is_active
                  ? `Monitoring active on ${monitoring.device_name || 'CPU'}`
                  : 'System in standby mode'}
              </p>
            </div>
            <div className="dashboard-alerts">
              <div className="alert-badge high-risk">
                <span className="alert-badge-count">{totalHighRisk}</span>
                <span>High-Risk Alerts</span>
              </div>
              <div className="alert-badge new-results">
                <span className="alert-badge-count">{stats.total_events}</span>
                <span>Total Events</span>
              </div>
              <div className="alert-badge today">
                <span className="alert-badge-count">{stats.active_issues}</span>
                <span>Active Issues</span>
              </div>
            </div>
          </div>

          {/* Main Dashboard Grid */}
          <div className="dashboard-row dashboard-row-3">
            {/* Quick Access Panel */}
            <div className="quick-access">
              <div className="quick-access-title">Quick Access</div>
              <div className="quick-access-item" onClick={() => navigate('/live')} role="button" tabIndex={0}>
                <span className="prefix">[+]</span>
                <span>Analyse New Clip</span>
              </div>
              <div className="quick-access-item" onClick={() => navigate('/issues')} role="button" tabIndex={0}>
                <span className="prefix">{'[>]'}</span>
                <span>All Events</span>
              </div>
              <div className="quick-access-item" onClick={() => navigate('/map')} role="button" tabIndex={0}>
                <span className="prefix">{'[>]'}</span>
                <span>View Map</span>
              </div>
              <div className="quick-access-item" onClick={() => navigate('/traffic')} role="button" tabIndex={0}>
                <span className="prefix">{'[>]'}</span>
                <span>Traffic Intelligence</span>
              </div>
            </div>

            {/* Active Events / Ready for Review */}
            <div className="card">
              <div className="card-header">
                <div className="card-title">Active Events</div>
                <span className="stat-value" style={{ fontSize: '1.5rem' }}>
                  {activeEvents.length.toString().padStart(2, '0')}
                </span>
              </div>
              {activeEvents.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', padding: '0.5rem 0' }}>
                  No active events
                </div>
              ) : (
                activeEvents.slice(0, 5).map((ev) => (
                  <div
                    key={ev.id}
                    onClick={() => navigate('/issues')}
                    role="button"
                    tabIndex={0}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.5rem 0',
                      borderBottom: '1px solid rgba(var(--border-default-rgb), 0.6)',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                      {ev.event_type}
                    </span>
                    <span style={{ color: 'var(--olive-light)', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem' }}>
                      [VIEW <ChevronRight size={10} style={{ display: 'inline' }} />]
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* High Priority Issues */}
            <div className="card">
              <div className="card-header">
                <div className="card-title">High Priority Issues</div>
                <span className="stat-value" style={{ fontSize: '1.5rem' }}>
                  {totalHighRisk.toString().padStart(2, '0')}
                </span>
              </div>
              {totalHighRisk === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', padding: '0.5rem 0' }}>
                  No high priority issues
                </div>
              ) : (
                <>
                  {Object.entries(stats.issues_by_priority).filter(([p]) => ['HIGH', 'CRITICAL'].includes(p)).map(([priority, count]) => (
                    <div key={priority} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.5rem 0',
                      borderBottom: '1px solid rgba(var(--border-default-rgb), 0.6)',
                      fontSize: '0.75rem'
                    }}>
                      <PriorityBadge priority={priority} />
                      <span style={{ color: 'var(--text-muted)' }}>{count} issues</span>
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* Detection Timeline Chart */}
            <div className="chart-container">
              <div className="chart-header">
                <div className="card-title">Detection Timeline</div>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Last 7 Days</span>
              </div>
              {(() => {
                const days = trends?.events_per_day ?? [];
                const peak = Math.max(1, ...days.map((d) => d.count));
                return (
                  <>
                    <div className="chart-bars">
                      {days.map((d) => (
                        <div
                          key={d.date}
                          className="chart-bar"
                          title={`${d.date}: ${d.count} event${d.count === 1 ? '' : 's'}`}
                          style={{
                            height: `${d.count === 0 ? 2 : Math.max(8, (d.count / peak) * 100)}%`,
                            opacity: d.count === 0 ? 0.35 : 1,
                          }}
                        />
                      ))}
                    </div>
                    <div className="chart-labels">
                      {days.map((d) => (
                        <span className="chart-label" key={d.date}>
                          {new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' })}
                        </span>
                      ))}
                    </div>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                      Peak {peak} / day &middot; {days.reduce((s, d) => s + d.count, 0)} total this week
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

          {/* Second Row: Schedule + Event Density + Results */}
          <div className="dashboard-row dashboard-row-2">
            {/* Monitoring Timeline / Today's Schedule */}
            <div className="card">
              <div className="card-header">
                <div className="card-title">Traffic Trend</div>
                <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>avg vehicles/frame</span>
              </div>
              {(() => {
                const pts = trends?.traffic_trend ?? [];
                if (pts.length === 0) {
                  return (
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', padding: '0.75rem 0' }}>
                      No traffic observations recorded yet.
                    </div>
                  );
                }
                const peak = Math.max(...pts.map((p) => p.avg_vehicles), 0.01);
                return (
                  <>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 90 }}>
                      {pts.map((p) => (
                        <div
                          key={p.bucket}
                          title={`${p.bucket} - ${p.avg_vehicles} avg (${p.observations} obs)`}
                          style={{
                            flex: 1,
                            minWidth: 2,
                            height: `${Math.max(3, (p.avg_vehicles / peak) * 100)}%`,
                            background: 'var(--olive)',
                            borderRadius: '2px 2px 0 0',
                            opacity: 0.85,
                          }}
                        />
                      ))}
                    </div>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                      {pts.length} buckets &middot; peak {peak.toFixed(2)} &middot; latest {pts[pts.length - 1].bucket.slice(-5)}
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Event Density Heatmap */}
            <div className="card">
              <div className="card-header">
                <div className="card-title">Event Density by Hour</div>
                <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>All recorded events</span>
              </div>
              {(() => {
                const hours = trends?.events_by_hour ?? [];
                const peak = Math.max(1, ...hours.map((h) => h.count));
                const rows = [0, 6, 12, 18];
                return (
                  <>
                    <div className="heatmap-grid">
                      {rows.map((start) => (
                        <React.Fragment key={start}>
                          <div className="heatmap-label">
                            {start === 0 ? '12am' : start === 12 ? '12pm' : start < 12 ? `${start}am` : `${start - 12}pm`}
                          </div>
                          {hours.slice(start, start + 6).map((h) => (
                            <div
                              key={h.hour}
                              className="heatmap-cell"
                              title={`${h.hour}:00 - ${h.count} event${h.count === 1 ? '' : 's'}`}
                              style={{
                                background: h.count === 0
                                  ? 'rgba(var(--border-default-rgb), 0.35)'
                                  : `rgba(var(--olive-rgb), ${(0.18 + 0.62 * (h.count / peak)).toFixed(2)})`,
                              }}
                            />
                          ))}
                        </React.Fragment>
                      ))}
                    </div>
                    <div className="heatmap-legend">
                      <div className="legend-item">
                        <div className="legend-swatch" style={{ background: 'rgba(var(--border-default-rgb), 0.35)' }} />
                        <span>None</span>
                      </div>
                      <div className="legend-item">
                        <div className="legend-swatch" style={{ background: 'rgba(var(--olive-rgb), 0.35)' }} />
                        <span>Low</span>
                      </div>
                      <div className="legend-item">
                        <div className="legend-swatch" style={{ background: 'rgba(var(--olive-rgb), 0.8)' }} />
                        <span>Peak ({peak})</span>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Detection Results */}
            <div className="card">
              <div className="card-header">
                <div className="card-title">Detection Results</div>
              </div>
              <div className="result-card caution">
                <span className="result-number">{stats.active_issues}</span>
                <span className="result-label" style={{ color: 'var(--amber)' }}>Caution</span>
              </div>
              <div className="result-card high-risk">
                <span className="result-number">{totalHighRisk}</span>
                <span className="result-label" style={{ color: 'var(--rose)' }}>High Risk</span>
              </div>
              <div className="result-card normal">
                <span className="result-number">{stats.resolved_issues}</span>
                <span className="result-label" style={{ color: 'var(--emerald)' }}>Normal</span>
              </div>
            </div>
          </div>

          {/* Pothole share by period */}
          <div className="card" style={{ marginTop: '1rem' }}>
            <div className="card-header">
              <div className="card-title">Potholes Detected</div>
              <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>rolling window</span>
            </div>
            <PotholeDonut periods={trends?.pothole_periods ?? []} />
          </div>

          {/* Recent Events Table */}
          <div className="card" style={{ marginTop: '1rem' }}>
            <div className="card-header">
              <div className="card-title">Recent Events</div>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Last 6</span>
            </div>
            {stats.recent_events.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', padding: '1rem 0', textAlign: 'center' }}>
                No events in database yet
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Confidence</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Source</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recent_events.map((ev) => (
                    <tr key={ev.id}>
                      <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{ev.event_type}</td>
                      <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>{(ev.confidence * 100).toFixed(0)}%</td>
                      <td><PriorityBadge priority={ev.priority} /></td>
                      <td><StatusBadge status={ev.status} /></td>
                      <td><ProvenanceBadge source={ev.source} is_demo_data={ev.is_demo_data} /></td>
                      <td style={{ fontSize: '0.65rem', fontFamily: 'JetBrains Mono, monospace' }}>{formatIST(ev.timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* System Status Bar */}
          <div className="card" style={{ marginTop: '1rem', borderLeft: `3px solid ${monitoring?.is_active ? 'var(--emerald)' : 'var(--amber)'}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Activity size={16} style={{ color: monitoring?.is_active ? 'var(--emerald)' : 'var(--amber)' }} />
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.8rem' }}>
                    {monitoring?.is_active ? 'MONITORING ACTIVE' : 'MONITORING STANDBY'}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                    {monitoring?.is_active
                      ? `Running on ${monitoring.device_name || 'CPU'}`
                      : 'Start monitoring in Live Feed to activate'}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.65rem' }}>
                  <Cpu size={11} style={{ color: 'var(--olive-light)' }} />
                  <StatusDot status={dotVariant(monitoring?.edge_ai_status)} />
                  {monitoring?.edge_ai_status || 'STANDBY'}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.65rem' }}>
                  <Camera size={11} style={{ color: 'var(--olive-light)' }} />
                  <StatusDot status={dotVariant(monitoring?.camera_status)} />
                  {monitoring?.camera_status || 'DISCONNECTED'}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.65rem' }}>
                  <Navigation size={11} style={{ color: 'var(--olive-light)' }} />
                  <StatusDot status={dotVariant(monitoring?.gps_status)} />
                  {monitoring?.gps_status || 'LOCKED'}
                </span>
                <button className="btn btn-ghost" onClick={load} disabled={loading} style={{ fontSize: '0.65rem', padding: '0.25rem 0.5rem' }}>
                  <RefreshCw size={10} />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default CommandCenter;
