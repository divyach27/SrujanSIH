import React from 'react';
import type { EventSource, EventStatus, EventPriority } from '../types';

// ========================================
// ProvenanceBadge: Shows SEED vs AI_DETECTION vs MANUAL_TEST
// ========================================
interface ProvenanceBadgeProps {
  source: EventSource;
  is_demo_data: boolean;
}

export const ProvenanceBadge: React.FC<ProvenanceBadgeProps> = ({ source, is_demo_data }) => {
  if (source === 'AI_DETECTION' && !is_demo_data) {
    return <span className="badge badge-ai">AI Detection</span>;
  }
  if (source === 'SEED' || is_demo_data) {
    return <span className="badge badge-seed">Demo Data</span>;
  }
  if (source === 'MANUAL_TEST') {
    return <span className="badge" style={{ background: 'rgba(var(--amber-rgb), 0.15)', color: 'var(--amber)', borderColor: 'rgba(var(--amber-rgb), 0.35)' }}>Manual Test</span>;
  }
  return <span className="badge badge-seed">{source}</span>;
};

// ========================================
// StatusBadge: For event status
// ========================================
interface StatusBadgeProps {
  status: EventStatus | string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const cls: Record<string, string> = {
    ACTIVE: 'badge-active',
    RESOLVED: 'badge-resolved',
    INVESTIGATING: 'badge-investigating',
    ASSIGNED: 'badge-assigned',
  };
  return <span className={`badge ${cls[status?.toUpperCase()] || 'badge-resolved'}`}>{status}</span>;
};

// ========================================
// PriorityBadge: For event priority
// ========================================
interface PriorityBadgeProps {
  priority: EventPriority | string;
}

export const PriorityBadge: React.FC<PriorityBadgeProps> = ({ priority }) => {
  const cls: Record<string, string> = {
    LOW: 'badge-low',
    MEDIUM: 'badge-medium',
    HIGH: 'badge-high',
    CRITICAL: 'badge-critical',
  };
  return <span className={`badge ${cls[priority?.toUpperCase()] || 'badge-low'}`}>{priority}</span>;
};

// ========================================
// StatusDot: Inline animated dot
// ========================================
interface StatusDotProps {
  status: 'online' | 'offline' | 'warning' | 'error';
}

export const StatusDot: React.FC<StatusDotProps> = ({ status }) => (
  <span className={`status-dot ${status}`} />
);
