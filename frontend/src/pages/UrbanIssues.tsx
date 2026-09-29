import React, { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, CheckCircle, RefreshCw, Search, HardHat } from 'lucide-react';
import Header from '../components/Header';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorAlert from '../components/ErrorAlert';
import EmptyState from '../components/EmptyState';
import { StatusBadge, PriorityBadge, ProvenanceBadge } from '../components/Badges';
import ContractorNoticeModal from '../components/ContractorNoticeModal';
import { getEvents, updateEventStatus } from '../services/api';
import { formatIST } from '../utils/date';
import type { UrbanEvent, EventStatus } from '../types';

// Road-surface defects a repair contractor is dispatched for. Mirrors
// CONTRACTOR_ELIGIBLE_TYPES on the backend, which rejects anything else.
const CONTRACTOR_ELIGIBLE_TYPES = ['POTHOLE', 'ROAD_DAMAGE'];

type FilterStatus = 'ALL' | 'ACTIVE' | 'RESOLVED' | 'INVESTIGATING' | 'ASSIGNED';
type FilterSource = 'ALL' | 'AI_DETECTION' | 'SEED';

const UrbanIssues: React.FC = () => {
  const [events, setEvents] = useState<UrbanEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('ALL');
  const [sourceFilter, setSourceFilter] = useState<FilterSource>('ALL');
  const [resolving, setResolving] = useState<number | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [contractorEvent, setContractorEvent] = useState<UrbanEvent | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getEvents(statusFilter, sourceFilter);
      setEvents(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load events from backend.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, sourceFilter]);

  useEffect(() => { load(); }, [load]);

  const handleStatusChange = async (id: number, status: EventStatus) => {
    setResolving(id);
    setResolveError(null);
    try {
      await updateEventStatus(id, status);
      // Refetch so UI reflects actual DB state
      await load();
    } catch (e: unknown) {
      setResolveError(e instanceof Error ? e.message : 'Failed to update event status.');
    } finally {
      setResolving(null);
    }
  };

  const STATUS_FILTERS: FilterStatus[] = ['ALL', 'ACTIVE', 'INVESTIGATING', 'ASSIGNED', 'RESOLVED'];
  const SOURCE_FILTERS: { label: string; value: FilterSource }[] = [
    { label: 'All Sources', value: 'ALL' },
    { label: 'AI Detection', value: 'AI_DETECTION' },
    { label: 'Demo Data', value: 'SEED' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Header title="Urban Issues" subtitle="Real events from database - log an action to update backend status" />
      <div className="page-body">
        {/* Filters & Actions */}
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="filter-tabs">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f}
                className={`filter-tab${statusFilter === f ? ' active' : ''}`}
                onClick={() => setStatusFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="filter-tabs">
            {SOURCE_FILTERS.map(({ label, value }) => (
              <button
                key={value}
                className={`filter-tab${sourceFilter === value ? ' active' : ''}`}
                onClick={() => setSourceFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <button className="btn btn-ghost" onClick={load} disabled={loading} style={{ marginLeft: 'auto' }}>
            <RefreshCw size={11} /> Refresh
          </button>
        </div>

        {resolveError && (
          <div style={{ marginBottom: '1rem' }}>
            <ErrorAlert message={resolveError} />
          </div>
        )}

        {toast && (
          <div style={{
            marginBottom: '1rem', fontSize: '0.75rem', lineHeight: 1.5,
            background: 'color-mix(in srgb, var(--emerald) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--emerald) 30%, transparent)',
            borderRadius: '0.5rem', padding: '0.7rem 0.9rem',
            display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start',
          }}>
            <span style={{ color: 'var(--text-secondary)' }}>{toast}</span>
            <button
              onClick={() => setToast(null)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.7rem' }}
            >
              Dismiss
            </button>
          </div>
        )}

        {loading && !events.length && <LoadingSpinner message="Fetching events from backend..." />}
        {error && <ErrorAlert message={error} onRetry={load} />}

        {!loading && !error && events.length === 0 && (
          <EmptyState
            icon={AlertTriangle}
            title="No urban events found"
            message={`No events match the selected filters (Status: ${statusFilter}, Source: ${sourceFilter}). Events appear here when detected by the AI pipeline.`}
          />
        )}

        {events.length > 0 && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '0.875rem 1.25rem', borderBottom: '1px solid var(--border-default)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="card-title">{events.length} Events</div>
              <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
                Actions write to the database &middot; contractor dispatch on road-surface defects
              </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Type</th>
                    <th>Confidence</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Source</th>
                    <th>Location</th>
                    <th>Time</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => (
                    <tr key={ev.id}>
                      <td style={{ color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.65rem' }}>#{ev.id}</td>
                      <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{ev.event_type}</td>
                      <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                        {(ev.confidence * 100).toFixed(0)}%
                      </td>
                      <td><PriorityBadge priority={ev.priority} /></td>
                      <td><StatusBadge status={ev.status} /></td>
                      <td><ProvenanceBadge source={ev.source} is_demo_data={ev.is_demo_data} /></td>
                      <td style={{ fontSize: '0.6rem', fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)' }}>
                        {ev.latitude.toFixed(4)}, {ev.longitude.toFixed(4)}
                      </td>
                      <td style={{ fontSize: '0.6rem', whiteSpace: 'nowrap', fontFamily: 'JetBrains Mono, monospace' }}>
                        {formatIST(ev.timestamp)}
                      </td>

                      <td>
                        {ev.status === 'RESOLVED' ? (
                          <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>Closed</span>
                        ) : (
                          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                            {ev.status !== 'INVESTIGATING' && (
                              <button
                                className="btn btn-ghost"
                                style={{ fontSize: '0.6rem', padding: '0.25rem 0.5rem' }}
                                onClick={() => handleStatusChange(ev.id, 'INVESTIGATING')}
                                disabled={resolving === ev.id}
                                id={`btn-investigating-${ev.id}`}
                              >
                                <Search size={10} /> Investigating
                              </button>
                            )}
                            <button
                              className="btn btn-resolve"
                              onClick={() => handleStatusChange(ev.id, 'RESOLVED')}
                              disabled={resolving === ev.id}
                              id={`btn-solved-${ev.id}`}
                            >
                              <CheckCircle size={10} />
                              {resolving === ev.id ? 'Updating...' : 'Solved'}
                            </button>
                            {CONTRACTOR_ELIGIBLE_TYPES.includes((ev.event_type || '').toUpperCase()) && (
                              <button
                                className="btn btn-primary"
                                style={{ fontSize: '0.6rem', padding: '0.25rem 0.5rem' }}
                                onClick={() => setContractorEvent(ev)}
                                disabled={resolving === ev.id}
                                id={`btn-contractor-${ev.id}`}
                              >
                                <HardHat size={10} /> Send to Contractor
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {contractorEvent && (
        <ContractorNoticeModal
          event={contractorEvent}
          onClose={() => setContractorEvent(null)}
          onSent={async (result) => {
            setContractorEvent(null);
            setToast(result.message);
            await load();
          }}
        />
      )}
    </div>
  );
};

export default UrbanIssues;
