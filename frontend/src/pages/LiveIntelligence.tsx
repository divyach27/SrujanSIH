import React, { useCallback, useRef, useState } from 'react';
import {
  Upload, Video, AlertTriangle, RotateCcw, Clock, MapPin,
  Car, Bike, Bus as BusIcon, Truck, Footprints, Droplets,
} from 'lucide-react';
import Header from '../components/Header';
import ErrorAlert from '../components/ErrorAlert';
import { analyzeHazardClip, ApiError } from '../services/api';
import { useGeolocation } from '../hooks/useGeolocation';
import type { DetectionItem, HazardAnalysisResponse } from '../types';

const MAX_CLIENT_DURATION_SECONDS = 65;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

type ViewState = 'idle' | 'analyzing' | 'result' | 'error';

function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const videoEl = document.createElement('video');
    videoEl.preload = 'metadata';
    videoEl.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(videoEl.duration);
    };
    videoEl.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read video metadata.'));
    };
    videoEl.src = url;
  });
}

const LocationBanner: React.FC<{ geo: ReturnType<typeof useGeolocation> }> = ({ geo }) => {
  const { status, location } = geo;
  if (status === 'idle' || status === 'unavailable') return null;

  let text = 'Locating device...';
  if (status === 'denied') text = 'Location unavailable (permission denied)';
  else if (status === 'success' && location) {
    text = location.placeName
      ? location.placeName
      : `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.7rem',
      color: 'var(--text-muted)', marginBottom: '0.75rem',
    }}>
      <MapPin size={12} style={{ flexShrink: 0 }} />
      <span>Analyzed near: {text}</span>
    </div>
  );
};

const DetectionCategoryCard: React.FC<{
  title: string;
  icon: React.ReactNode;
  count: number;
  items: DetectionItem[];
  accentColor: string;
  emptyLabel: string;
  experimental?: boolean;
}> = ({ title, icon, count, items, accentColor, emptyLabel, experimental }) => (
  <div className="card" style={{ marginBottom: '1rem' }}>
    <div className="card-header">
      <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        {icon}
        <span>{title}</span>
        {experimental && (
          <span
            className="badge"
            style={{
              background: 'rgba(var(--amber-rgb), 0.15)', color: 'var(--amber)',
              borderColor: 'rgba(var(--amber-rgb), 0.3)',
            }}
          >
            Experimental
          </span>
        )}
      </div>
      <span style={{ fontSize: '1.25rem', fontWeight: 300, color: accentColor }}>{count}</span>
    </div>
    {items.length === 0 ? (
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0.5rem 0' }}>{emptyLabel}</div>
    ) : (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.6rem' }}>
        {items.map((item) => (
          <div
            key={item.track_id}
            style={{
              border: '1px solid var(--border-default)', borderRadius: '0.5rem',
              overflow: 'hidden', background: 'var(--bg-surface)',
            }}
          >
            {item.thumbnail_base64 ? (
              <img
                src={`data:image/jpeg;base64,${item.thumbnail_base64}`}
                alt={`${title} #${item.track_id}`}
                style={{ width: '100%', height: 85, objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <div style={{
                width: '100%', height: 85, display: 'flex',
                alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)',
              }}>
                <AlertTriangle size={18} />
              </div>
            )}
            <div style={{ padding: '0.4rem 0.5rem' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                #{item.track_id}
              </div>
              <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)' }}>
                {Math.round(item.confidence * 100)}% &middot; at {item.first_seen_seconds.toFixed(1)}s
              </div>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);

const VehicleTile: React.FC<{ icon: React.ReactNode; label: string; avg: number; peak: number; color: string }> = (
  { icon, label, avg, peak, color }
) => (
  <div style={{
    background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
    borderRadius: '0.5rem', padding: '0.6rem', textAlign: 'center',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', color, fontSize: '0.65rem', marginBottom: '0.3rem' }}>
      {icon} {label}
    </div>
    <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>
      {avg.toFixed(2)}
    </div>
    <div style={{ fontSize: '0.55rem', color: 'var(--text-muted)' }}>avg/frame &middot; peak {peak}</div>
  </div>
);

const LiveIntelligence: React.FC = () => {
  const [state, setState] = useState<ViewState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HazardAnalysisResponse | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPhoto, setIsPhoto] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const geo = useGeolocation();

  const reset = useCallback(() => {
    setState('idle');
    setError(null);
    setResult(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setError(null);

    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) {
      setError('Please choose a video clip or a photo.');
      setState('error');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`File too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Max size is 100MB.`);
      setState('error');
      return;
    }
    setIsPhoto(isImage);

    // Duration only applies to clips; a photo is a single frame.
    if (isVideo) {
      try {
        const duration = await readVideoDuration(file);
        if (Number.isFinite(duration) && duration > MAX_CLIENT_DURATION_SECONDS) {
          setError(
            `Clip is ${duration.toFixed(1)}s long. Please upload a clip up to about a minute long ` +
            `(max ${MAX_CLIENT_DURATION_SECONDS}s).`
          );
          setState('error');
          return;
        }
      } catch {
        // If duration can't be read client-side, let the server be the source of truth.
      }
    }

    setPreviewUrl(URL.createObjectURL(file));
    setState('analyzing');
    // Resolve location first so confirmed hazards can be stored as located
    // events; if it's denied or unavailable the analysis still runs.
    const loc = await geo.request();
    try {
      const res = await analyzeHazardClip(file, loc);
      setResult(res);
      setState('result');
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'Failed to analyze video.');
      setState('error');
    }
    // geo intentionally omitted: request() is stable and re-invoking this
    // effect on geo state changes would cancel/restart location lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Header title="Live Intelligence" subtitle="Upload a road clip or photo for AI pothole, crosswalk & water clogging analysis" />
      <div className="page-body">
        {state === 'idle' && (
          <div
            className="card"
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              textAlign: 'center',
              padding: '3rem 1.5rem',
              border: `2px dashed ${isDragging ? 'var(--olive)' : 'var(--border-default)'}`,
              background: isDragging ? 'var(--bg-elevated)' : 'var(--bg-card)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <Upload size={36} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }} />
            <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>
              Upload a road video or photo
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', maxWidth: 460, margin: '0 auto 1rem' }}>
              Drag and drop a clip (up to about a minute) or a still photo of a road, street, or
              path &mdash; or click to choose a file. On mobile, this opens your camera directly.
              We'll ask for your location too, so results can be tagged with where they were found.
            </div>
            <button
              className="btn btn-primary"
              onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
            >
              <Video size={14} /> Choose Video or Photo
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,image/*"
              capture="environment"
              onChange={onFileInputChange}
              style={{ display: 'none' }}
            />
          </div>
        )}

        {state === 'analyzing' && (
          <div className="card" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
            <div className="spinner" style={{ margin: '0 auto 1rem' }} />
            <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>
              {isPhoto ? 'Analyzing photo for road hazards...' : 'Analyzing clip for road hazards...'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {isPhoto
                ? 'Running pothole, crosswalk, water clogging, and vehicle detection on the image.'
                : 'Running pothole, crosswalk, water clogging, and vehicle detection across sampled '
                  + 'frames. This can take up to a couple of minutes for longer clips.'}
            </div>
          </div>
        )}

        {state === 'error' && (
          <>
            <ErrorAlert message={error || 'Something went wrong.'} onRetry={reset} />
            <div style={{ marginTop: '1rem' }}>
              <button className="btn btn-ghost" onClick={reset}>
                <RotateCcw size={12} /> Try again
              </button>
            </div>
          </>
        )}

        {state === 'result' && result && (
          !result.pothole_model_loaded ? (
            <ErrorAlert
              message={result.message || 'The road hazard detection model is unavailable.'}
              onRetry={reset}
            />
          ) : (
            <>
              <LocationBanner geo={geo} />

              <div className="grid-3" style={{ marginBottom: '0.75rem' }}>
                <div className="card" style={{ textAlign: 'center', padding: '1.25rem 1rem' }}>
                  <div className="stat-label">Potholes</div>
                  <div style={{ fontSize: '2.25rem', fontWeight: 300, color: result.pothole_count > 0 ? 'var(--rose)' : 'var(--emerald)' }}>
                    {result.pothole_count}
                  </div>
                </div>
                <div className="card" style={{ textAlign: 'center', padding: '1.25rem 1rem' }}>
                  <div className="stat-label">Crosswalks</div>
                  <div style={{ fontSize: '2.25rem', fontWeight: 300, color: 'var(--blue)' }}>
                    {result.crosswalk_count}
                  </div>
                </div>
                <div className="card" style={{ textAlign: 'center', padding: '1.25rem 1rem' }}>
                  <div className="stat-label">Water Clogging</div>
                  <div style={{ fontSize: '2.25rem', fontWeight: 300, color: result.water_clogging_count > 0 ? 'var(--amber)' : 'var(--emerald)' }}>
                    {result.water_clogging_count}
                  </div>
                </div>
              </div>

              <div style={{
                fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '1rem',
                display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap',
              }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <Clock size={11} />
                  {isPhoto ? 'single photo' : `${result.video_duration_seconds.toFixed(1)}s clip`}
                </span>
                <span>
                  {isPhoto ? '1 frame analyzed' : `${result.frames_analyzed} frames analyzed`}
                </span>
                <span style={{ color: result.events_saved > 0 ? 'var(--emerald)' : 'var(--text-muted)' }}>
                  {result.events_saved > 0
                    ? `${result.events_saved} event${result.events_saved === 1 ? '' : 's'} saved to dashboard`
                    : 'not saved (location unavailable)'}
                </span>
              </div>

              {previewUrl && (
                <div className="card" style={{ marginBottom: '1rem', padding: '0.75rem' }}>
                  {isPhoto ? (
                    <img
                      src={previewUrl}
                      alt="Analysed photo"
                      style={{ width: '100%', maxHeight: 320, objectFit: 'contain', borderRadius: '0.5rem', display: 'block' }}
                    />
                  ) : (
                    <video
                      src={previewUrl}
                      controls
                      style={{ width: '100%', maxHeight: 320, borderRadius: '0.5rem', display: 'block' }}
                    />
                  )}
                </div>
              )}

              <div className="card" style={{ marginBottom: '1rem' }}>
                <div className="card-header">
                  <div className="card-title">Vehicle Density (avg per analyzed frame)</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
                  <VehicleTile icon={<Car size={12} />} label="Cars" color="var(--blue)"
                    avg={result.vehicles_avg_per_frame.car} peak={result.vehicles_peak_in_frame.car} />
                  <VehicleTile icon={<Bike size={12} />} label="Bikes" color="var(--olive-light)"
                    avg={result.vehicles_avg_per_frame.motorcycle} peak={result.vehicles_peak_in_frame.motorcycle} />
                  <VehicleTile icon={<BusIcon size={12} />} label="Buses" color="var(--amber)"
                    avg={result.vehicles_avg_per_frame.bus} peak={result.vehicles_peak_in_frame.bus} />
                  <VehicleTile icon={<Truck size={12} />} label="Trucks" color="var(--rose)"
                    avg={result.vehicles_avg_per_frame.truck} peak={result.vehicles_peak_in_frame.truck} />
                </div>
              </div>

              <DetectionCategoryCard
                title="Potholes"
                icon={<AlertTriangle size={14} style={{ color: 'var(--rose)' }} />}
                count={result.pothole_count}
                items={result.potholes}
                accentColor="var(--rose)"
                emptyLabel="No potholes detected in this clip."
              />

              <DetectionCategoryCard
                title="Crosswalks"
                icon={<Footprints size={14} style={{ color: 'var(--blue)' }} />}
                count={result.crosswalk_count}
                items={result.crosswalks}
                accentColor="var(--blue)"
                emptyLabel="No marked crosswalks detected in this clip."
              />

              <DetectionCategoryCard
                title="Water Clogging"
                icon={<Droplets size={14} style={{ color: 'var(--amber)' }} />}
                count={result.water_clogging_count}
                items={result.water_clogging}
                accentColor="var(--amber)"
                emptyLabel="No standing water detected in this clip."
                experimental
              />

              <div style={{ marginTop: '0.25rem' }}>
                <button className="btn btn-primary" onClick={reset}>
                  <Upload size={13} /> Analyze Another Clip
                </button>
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
};

export default LiveIntelligence;
