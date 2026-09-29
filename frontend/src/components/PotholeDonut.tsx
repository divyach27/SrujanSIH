import React, { useState } from 'react';
import type { PeriodBreakdown } from '../types';

interface Props {
  periods: PeriodBreakdown[];
}

const SIZE = 132;
const STROKE = 14;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Pothole share of all logged events for a rolling window (Day/Week/Month).
 * Plain SVG rather than a chart library - one arc, no extra dependency.
 */
const PotholeDonut: React.FC<Props> = ({ periods }) => {
  const [active, setActive] = useState(1); // default to Week
  const period = periods[active] ?? periods[0];

  if (!period) {
    return (
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', padding: '0.75rem 0' }}>
        No event data yet.
      </div>
    );
  }

  const share = period.total > 0 ? period.potholes / period.total : 0;
  const dash = CIRCUMFERENCE * share;

  return (
    <>
      <div className="filter-tabs" style={{ marginBottom: '0.9rem', width: 'fit-content' }}>
        {periods.map((p, i) => (
          <button
            key={p.label}
            className={`filter-tab${i === active ? ' active' : ''}`}
            onClick={() => setActive(i)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1.1rem', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: SIZE, height: SIZE, flexShrink: 0 }}>
          <svg width={SIZE} height={SIZE} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
            <circle
              cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
              fill="none" stroke="var(--border-default)" strokeWidth={STROKE}
            />
            {period.potholes > 0 && (
              <circle
                cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
                fill="none" stroke="var(--rose)" strokeWidth={STROKE}
                strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                strokeLinecap={share >= 1 ? 'butt' : 'round'}
                style={{ transition: 'stroke-dasharray 0.4s ease' }}
              />
            )}
          </svg>
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{ fontSize: '1.9rem', fontWeight: 300, lineHeight: 1, color: 'var(--text-primary)' }}>
              {period.potholes}
            </div>
            <div style={{
              fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.08em',
              color: 'var(--text-muted)', marginTop: '0.2rem',
            }}>
              potholes
            </div>
          </div>
        </div>

        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.9 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--rose)', display: 'inline-block' }} />
            Potholes &amp; road damage: <strong style={{ color: 'var(--text-primary)' }}>{period.potholes}</strong>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--border-default)', display: 'inline-block' }} />
            Other events: <strong style={{ color: 'var(--text-primary)' }}>{period.other_events}</strong>
          </div>
          <div style={{ marginTop: '0.2rem' }}>
            {period.total > 0
              ? `${Math.round(share * 100)}% of ${period.total} event${period.total === 1 ? '' : 's'} this ${period.label.toLowerCase()}`
              : `No events logged this ${period.label.toLowerCase()}`}
          </div>
        </div>
      </div>
    </>
  );
};

export default PotholeDonut;
