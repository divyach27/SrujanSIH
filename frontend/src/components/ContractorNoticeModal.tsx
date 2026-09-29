import React, { useState } from 'react';
import { X, Send, HardHat } from 'lucide-react';
import { sendContractorNotice, ApiError } from '../services/api';
import type { ContractorNoticeResult, UrbanEvent } from '../types';

interface Props {
  event: UrbanEvent;
  onClose: () => void;
  onSent: (result: ContractorNoticeResult) => void;
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.65rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontWeight: 600,
  color: 'var(--text-muted)',
  marginBottom: '0.3rem',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.65rem',
  fontSize: '0.8rem',
  borderRadius: '0.4rem',
  border: '1px solid var(--border-default)',
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
  outline: 'none',
};

const ContractorNoticeModal: React.FC<Props> = ({ event, onClose, onSent }) => {
  const [contractorName, setContractorName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [warranty, setWarranty] = useState('');
  const [notes, setNotes] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = contractorName.trim() && phone.trim() && email.trim() && !sending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSending(true);
    setError(null);
    try {
      const result = await sendContractorNotice(event.id, {
        contractor_name: contractorName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        warranty_remaining: warranty.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      onSent(result);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : 'Failed to record the notice.');
      setSending(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(20, 15, 10, 0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Send notice to contractor"
        className="card"
        style={{ width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div className="card-header">
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <HardHat size={14} style={{ color: 'var(--olive)' }} />
            <span>Send to Contractor</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', display: 'flex', padding: 2,
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{
          fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.9rem',
          paddingBottom: '0.6rem', borderBottom: '1px solid var(--border-default)',
        }}>
          Issue <strong style={{ color: 'var(--text-primary)' }}>#{event.id} &middot; {event.event_type}</strong>
          {' '}&middot; {event.priority} priority &middot; {event.latitude.toFixed(4)}, {event.longitude.toFixed(4)}
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '0.7rem' }}>
            <label style={labelStyle} htmlFor="cn-name">Contractor Name *</label>
            <input id="cn-name" style={inputStyle} value={contractorName} required
              onChange={(e) => setContractorName(e.target.value)} placeholder="e.g. Sharma Roadworks Pvt Ltd" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '0.7rem' }}>
            <div>
              <label style={labelStyle} htmlFor="cn-phone">Phone No. *</label>
              <input id="cn-phone" style={inputStyle} value={phone} required type="tel"
                onChange={(e) => setPhone(e.target.value)} placeholder="+91 98200 12345" />
            </div>
            <div>
              <label style={labelStyle} htmlFor="cn-email">Email *</label>
              <input id="cn-email" style={inputStyle} value={email} required type="email"
                onChange={(e) => setEmail(e.target.value)} placeholder="ops@contractor.in" />
            </div>
          </div>

          <div style={{ marginBottom: '0.7rem' }}>
            <label style={labelStyle} htmlFor="cn-warranty">Warranty Period Remaining</label>
            <input id="cn-warranty" style={inputStyle} value={warranty}
              onChange={(e) => setWarranty(e.target.value)} placeholder="e.g. 8 months" />
          </div>

          <div style={{ marginBottom: '0.9rem' }}>
            <label style={labelStyle} htmlFor="cn-notes">Notes</label>
            <textarea id="cn-notes" rows={2} style={{ ...inputStyle, resize: 'vertical' }} value={notes}
              onChange={(e) => setNotes(e.target.value)} placeholder="Location details, access instructions..." />
          </div>

          {error && (
            <div style={{
              fontSize: '0.7rem', color: 'var(--rose)', marginBottom: '0.7rem',
              background: 'color-mix(in srgb, var(--rose) 8%, transparent)',
              border: '1px solid color-mix(in srgb, var(--rose) 25%, transparent)',
              borderRadius: '0.4rem', padding: '0.5rem 0.6rem',
            }}>
              {error}
            </div>
          )}

          <div style={{
            fontSize: '0.6rem', color: 'var(--text-muted)', marginBottom: '0.7rem', lineHeight: 1.5,
          }}>
            This records the dispatch against the issue and marks it ASSIGNED. Email/SMS delivery
            is not configured on this server, so no message is actually transmitted.
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={sending}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
              <Send size={12} /> {sending ? 'Sending...' : 'Send Notice'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ContractorNoticeModal;
