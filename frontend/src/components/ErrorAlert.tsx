import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorAlertProps {
  message: string;
  onRetry?: () => void;
}

const ErrorAlert: React.FC<ErrorAlertProps> = ({ message, onRetry }) => (
  <div className="error-alert" role="alert">
    <AlertTriangle size={16} style={{ color: 'var(--rose)', flexShrink: 0, marginTop: 1 }} />
    <div style={{ flex: 1 }}>
      <div style={{ fontWeight: 600, marginBottom: 2, color: 'var(--rose)' }}>Error</div>
      <div>{message}</div>
    </div>
    {onRetry && (
      <button className="btn btn-ghost" onClick={onRetry} style={{ fontSize: '0.7rem', padding: '0.2rem 0.6rem' }}>
        <RefreshCw size={12} /> Retry
      </button>
    )}
  </div>
);

export default ErrorAlert;
