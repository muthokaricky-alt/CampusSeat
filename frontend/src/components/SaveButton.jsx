import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

/** Save / unsave an event. Flips at once (optimistic) and rolls back if the server says no. */
export default function SaveButton({ event, onChange, variant = 'icon' }) {
  const { user } = useAuth();
  const toast = useToast();
  const [saved, setSaved] = useState(!!event.my_saved);
  const [busy, setBusy] = useState(false);
  const label = saved ? `Remove ${event.title} from saved events` : `Save ${event.title} for later`;
  if (!user) {
    return variant === 'icon' ? null
      : <Link className="btn secondary" to="/login" state={{ from: `/events/${event.event_id}` }}><Bookmark size={18} aria-hidden />Log in to save</Link>;
  }
  const toggle = async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (busy) return;
    const next = !saved;
    setSaved(next); setBusy(true);
    try {
      await (next ? api.put(`/events/${event.event_id}/save`) : api.del(`/events/${event.event_id}/save`));
      onChange?.(next);
      if (variant !== 'icon') toast.ok(next ? 'Saved. Find it under Saved on the events page.' : 'Removed from saved events.');
    } catch (err) { setSaved(!next); toast.error(err.message); } finally { setBusy(false); }
  };
  const Icon = saved ? BookmarkCheck : Bookmark;
  return variant === 'icon' ? (
    <button type="button" className={`save-btn ${saved ? 'on' : ''}`} onClick={toggle} aria-pressed={saved} aria-label={label} title={saved ? 'Saved' : 'Save for later'}>
      <Icon size={18} aria-hidden />
    </button>
  ) : (
    <button type="button" className={`btn secondary ${saved ? 'is-saved' : ''}`} onClick={toggle} aria-pressed={saved}>
      <Icon size={18} aria-hidden />{saved ? 'Saved' : 'Save for later'}
    </button>
  );
}
