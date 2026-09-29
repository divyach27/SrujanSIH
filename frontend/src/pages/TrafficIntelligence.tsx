import React, { useEffect, useState, useCallback } from 'react';
import { Car, Bike, Bus as BusIcon, Truck, BarChart3, RefreshCw } from 'lucide-react';
import Header from '../components/Header';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorAlert from '../components/ErrorAlert';
import { ProvenanceBadge } from '../components/Badges';
import { getCurrentTraffic } from '../services/api';
import { formatIST } from '../utils/date';
import type { TrafficObservation } from '../types';

function trafficLevelStyle(level: string) {
  switch (level?.toUpperCase()) {
    case 'LOW': return { color: 'var(--emerald)', barClass: 'low' };
    case 'MODERATE': return { color: 'var(--amber)', barClass: 'moderate' };
    case 'HEAVY': return { color: 'var(--olive)', barClass: 'heavy' };
    case 'CONGESTED': return { color: 'var(--rose)', barClass: 'congested' };
    default: return { color: 'var(--text-muted)', barClass: 'low' };
  }
}

interface VehicleStatProps {
  icon: React.ReactNode;
  label: string;
  count: number;
  total: number;
  color: string;
}

const VehicleStat: React.FC<VehicleStatProps> = ({ icon, label, count, total, color }) => {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="card" style={{ borderLeft: `3px solid ${color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 600 }}>
          <span style={{ color }}>{icon}</span>
          {label}
        </div>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>{count}</span>
      </div>
      <div className="traffic-bar-bg">
        <div className="traffic-bar-fill" style={{ background: color, width: `${Math.min(pct, 100)}%` }} />
      </div>
      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{pct}% of total</div>
    </div>
  );
};

const TrafficIntelligence: React.FC = () => {
  const [traffic, setTraffic] = useState<TrafficObservation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getCurrentTraffic();
      setTraffic(data);
      setLastRefreshed(new Date());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to fetch traffic data from backend.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Poll every 3 seconds for live demo responsiveness
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [load]);

  const levelStyle = traffic ? trafficLevelStyle(traffic.traffic_level) : { color: 'var(--text-muted)', barClass: 'low' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Header title="Traffic Intelligence" subtitle="Real-time vehicle aggregation & traffic flow from Edge AI pipeline" />
      <div className="page-body">
        {loading && !traffic && <LoadingSpinner message="Fetching traffic data from backend..." />}
        {error && <ErrorAlert message={error} onRetry={load} />}

        {!loading && !error && traffic === null && (
          <div className="card" style={{ padding: '1.5rem', textAlign: 'center', border: '1px dashed var(--border-default)' }}>
            <BarChart3 size={24} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }} />
            <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
              Waiting for live traffic observation...
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 480, margin: '0 auto' }}>
              Start monitoring and process a video with detectable vehicles. Genuine YOLO frame counts are
              aggregated over a short window and posted to <code>/api/traffic</code>; the latest observation
              appears here. If the video contains no vehicles, the counts honestly show zero.
            </div>
          </div>
        )}

        {traffic && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <ProvenanceBadge source={traffic.source} is_demo_data={traffic.is_demo_data} />
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  Recorded: {formatIST(traffic.timestamp)}
                </span>
              </div>
              <button className="btn btn-ghost" onClick={load} disabled={loading} style={{ fontSize: '0.65rem', padding: '0.3rem 0.6rem' }}>
                <RefreshCw size={10} /> Refresh
              </button>
            </div>

            {/* Hero: Traffic Level */}
            <div className="card" style={{ marginBottom: '1rem', borderLeft: `3px solid ${levelStyle.color}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', flexWrap: 'wrap' }}>
                <div>
                  <div className="stat-label">Traffic Level</div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 300, color: levelStyle.color, letterSpacing: '-0.02em' }}>
                    {traffic.traffic_level}
                  </div>
                  <div className="traffic-bar-bg" style={{ width: 180, marginTop: '0.5rem' }}>
                    <div className={`traffic-bar-fill ${levelStyle.barClass}`} />
                  </div>
                </div>
                <div style={{ borderLeft: '1px solid var(--border-default)', paddingLeft: '2rem' }}>
                  <div className="stat-label">Total Vehicles Detected</div>
                  <div className="stat-value">{traffic.vehicle_count}</div>
                  <div className="stat-sub">Mumbai Corridor ({traffic.latitude.toFixed(4)}, {traffic.longitude.toFixed(4)})</div>
                </div>
              </div>
            </div>

            {/* Vehicle Breakdown */}
            <div style={{ marginBottom: '0.75rem' }}>
              <div className="card-title" style={{ marginBottom: '0.75rem', color: 'var(--text-muted)' }}>Vehicle Breakdown (YOLO Counts)</div>
              <div className="grid-2">
                <VehicleStat
                  icon={<Car size={14} />}
                  label="Cars"
                  count={traffic.car_count}
                  total={traffic.vehicle_count}
                  color="var(--blue)"
                />
                <VehicleStat
                  icon={<Bike size={14} />}
                  label="Motorcycles / Bikes"
                  count={traffic.motorcycle_count}
                  total={traffic.vehicle_count}
                  color="var(--olive-light)"
                />
                <VehicleStat
                  icon={<BusIcon size={14} />}
                  label="Buses"
                  count={traffic.bus_count}
                  total={traffic.vehicle_count}
                  color="var(--amber)"
                />
                <VehicleStat
                  icon={<Truck size={14} />}
                  label="Trucks"
                  count={traffic.truck_count}
                  total={traffic.vehicle_count}
                  color="var(--rose)"
                />
              </div>
            </div>

            {/* Observation metadata */}
            <div className="card">
              <div className="card-title" style={{ marginBottom: '0.75rem' }}>Observation Provenance & Telemetry</div>
              <div className="info-row">
                <span className="info-row-label">Observation ID</span>
                <span className="info-row-value">#{traffic.id}</span>
              </div>
              <div className="info-row">
                <span className="info-row-label">Recorded At (IST)</span>
                <span className="info-row-value" style={{ fontSize: '0.65rem', fontFamily: 'JetBrains Mono, monospace' }}>{formatIST(traffic.timestamp)}</span>
              </div>
              <div className="info-row">
                <span className="info-row-label">GPS Coordinates</span>
                <span className="info-row-value">{traffic.latitude.toFixed(5)}, {traffic.longitude.toFixed(5)}</span>
              </div>
              <div className="info-row">
                <span className="info-row-label">Bus Unit</span>
                <span className="info-row-value">BUS_01 (ID: {traffic.bus_id})</span>
              </div>
              <div className="info-row">
                <span className="info-row-label">Last Polled</span>
                <span className="info-row-value" style={{ fontSize: '0.65rem' }}>{lastRefreshed ? formatIST(lastRefreshed) : '--'}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default TrafficIntelligence;
