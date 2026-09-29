import React, { useEffect, useState, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import Header from '../components/Header';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorAlert from '../components/ErrorAlert';
import { StatusBadge, PriorityBadge, ProvenanceBadge } from '../components/Badges';
import { getBusLocation, getEvents, getBusRoute } from '../services/api';
import type { Bus, UrbanEvent, BusRoute } from '../types';

// Fix leaflet default icon path issue with Vite
delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Bus icon (brand blue)
const busIcon = L.divIcon({
  html: `<div style="
    background:var(--blue);
    border:2px solid #fff;
    border-radius:50% 50% 50% 0;
    width:24px;height:24px;
    transform:rotate(-45deg);
    box-shadow:0 0 12px rgba(var(--blue-rgb),0.6);
  "></div>`,
  className: '',
  iconSize: [24, 24],
  iconAnchor: [12, 24],
});

// NOTE: literal hex (not CSS var()) - these feed Leaflet's SVG/Canvas
// path rendering (via string interpolation with an alpha suffix below),
// which cannot resolve CSS custom properties.
function priorityColor(priority: string): string {
  switch (priority?.toUpperCase()) {
    case 'HIGH': return '#b8463a';
    case 'MEDIUM': return '#b9790f';
    case 'CRITICAL': return '#ff2244';
    default: return '#64748b';
  }
}

const eventIcon = (priority: string) => L.divIcon({
  html: `<div style="
    background:${priorityColor(priority)};
    border:2px solid rgba(255,255,255,0.5);
    border-radius:50%;
    width:14px;height:14px;
    box-shadow:0 0 8px ${priorityColor(priority)}80;
  "></div>`,
  className: '',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

// Component to recenter the map when bus location changes
const MapController: React.FC<{ lat: number; lng: number }> = ({ lat, lng }) => {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom());
  }, [lat, lng, map]);
  return null;
};

const UrbanMap: React.FC = () => {
  const [bus, setBus] = useState<Bus | null>(null);
  const [events, setEvents] = useState<UrbanEvent[]>([]);
  const [routeData, setRouteData] = useState<BusRoute | null>(null);
  const [travelled, setTravelled] = useState<[number, number][]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [busData, eventsData, routeResp] = await Promise.all([
        getBusLocation(),
        getEvents(),
        getBusRoute(),
      ]);
      setBus(busData);
      setEvents(eventsData);
      setRouteData((prev) => prev ?? routeResp);
      // Accumulate the travelled path from successive bus positions (latest-frame style).
      setTravelled((prev) => {
        const pos: [number, number] = [busData.latitude, busData.longitude];
        const last = prev[prev.length - 1];
        if (last && last[0] === pos[0] && last[1] === pos[1]) return prev;
        return [...prev, pos].slice(-400);
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load map data from backend.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  const center: [number, number] = bus ? [bus.latitude, bus.longitude] : [19.1197, 72.9050];


  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Header title="Urban Map" subtitle="Real-time event markers and BUS_01 location from database" />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {loading && !bus && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <LoadingSpinner message="Loading map data from backend…" />
          </div>
        )}
        {error && (
          <div style={{ padding: '1.5rem' }}>
            <ErrorAlert message={error} onRetry={load} />
          </div>
        )}

        {(bus || !loading) && (
          <>
            {/* Map Legend */}
            <div style={{
              padding: '0.5rem 1.25rem',
              background: 'var(--bg-surface)',
              borderBottom: '1px solid var(--border-default)',
              display: 'flex',
              gap: '1.25rem',
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
              flexShrink: 0,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontWeight: 600 }}>
                <span style={{
                  background: 'var(--blue)', borderRadius: '50% 50% 50% 0',
                  width: 10, height: 10, display: 'inline-block',
                  transform: 'rotate(-45deg)', border: '1.5px solid #fff'
                }} />
                🚌 BUS POSITION (BUS_01)
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <span style={{ background: 'var(--text-muted)', borderRadius: '2px', width: 14, height: 4, display: 'inline-block', borderTop: '1px dashed #94a3b8' }} />
                PLANNED ROUTE
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <span style={{ background: 'var(--blue)', borderRadius: '2px', width: 14, height: 4, display: 'inline-block' }} />
                TRAVELLED PATH
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <span style={{ background: 'var(--rose)', borderRadius: '50%', width: 8, height: 8, display: 'inline-block', boxShadow: '0 0 6px var(--rose)' }} />
                ⚠ ROAD HAZARD · HIGH
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <span style={{ background: 'var(--amber)', borderRadius: '50%', width: 8, height: 8, display: 'inline-block' }} />
                ⚠ MEDIUM
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <span style={{ background: 'var(--text-muted)', borderRadius: '50%', width: 8, height: 8, display: 'inline-block' }} />
                📍 SIMULATED GPS (other events)
              </span>
              <span style={{ marginLeft: 'auto', fontWeight: 600, color: 'var(--amber)' }}>
                GPS: SIMULATED MUMBAI ROAD ROUTE
              </span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                {events.length} events · BUS @ {bus?.latitude.toFixed(4)}, {bus?.longitude.toFixed(4)}
              </span>
            </div>

            <div style={{ flex: 1, position: 'relative' }}>
              <MapContainer
                center={center}
                zoom={15}
                style={{ height: '100%', width: '100%' }}
                zoomControl={true}
              >
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                />
                {bus && <MapController lat={bus.latitude} lng={bus.longitude} />}

                {/* Planned road route polyline (grey dashed) */}
                {routeData && routeData.route.length >= 2 && (
                  <Polyline
                    positions={routeData.route.map((p) => [p.lat, p.lon])}
                    pathOptions={{
                      color: '#64748b',
                      weight: 3,
                      dashArray: '6 6',
                      opacity: 0.9,
                      lineCap: 'round',
                    }}
                  />
                )}

                {/* Travelled path (brand blue solid) */}
                {travelled.length >= 2 && (
                  <Polyline
                    positions={travelled}
                    pathOptions={{
                      color: '#3457b2',
                      weight: 3,
                      opacity: 0.85,
                      lineCap: 'round',
                    }}
                  />
                )}

                {/* BUS_01 Marker (moves along the simulated Mumbai route) */}
                {bus && (
                  <Marker position={[bus.latitude, bus.longitude]} icon={busIcon}>
                    <Popup>
                      <div style={{ padding: '0.75rem', minWidth: 180 }}>
                        <div style={{ fontWeight: 700, color: 'var(--cyan)', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                          🚌 {bus.bus_code}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'grid', gap: '0.25rem' }}>
                          <div>Status: <strong style={{ color: 'var(--emerald)' }}>{bus.status}</strong></div>
                          <div>Speed: {bus.speed.toFixed(1)} km/h</div>
                          <div>GPS: {bus.gps_status}</div>
                          <div>Edge AI: {bus.edge_ai_status}</div>
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                            {bus.latitude.toFixed(5)}, {bus.longitude.toFixed(5)}
                          </div>
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                )}

                {/* Event Markers */}
                {events.map((ev) => (
                  <Marker
                    key={ev.id}
                    position={[ev.latitude, ev.longitude]}
                    icon={eventIcon(ev.priority)}
                  >
                    <Popup>
                      <div style={{ padding: '0.75rem', minWidth: 200 }}>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                          {ev.event_type}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'grid', gap: '0.3rem' }}>
                          <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                            <StatusBadge status={ev.status} />
                            <PriorityBadge priority={ev.priority} />
                          </div>
                          <div>Confidence: {(ev.confidence * 100).toFixed(0)}%</div>
                          <div>Time: {new Date(ev.timestamp).toLocaleString()}</div>
                          <div style={{ marginTop: '0.25rem' }}>
                            <ProvenanceBadge source={ev.source} is_demo_data={ev.is_demo_data} />
                          </div>
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default UrbanMap;
