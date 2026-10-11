'use client';

import type { NotificationPrefs } from '@paras/shared';
import { useState } from 'react';
import { api } from '@/lib/api';

const FREQ: NotificationPrefs['frequency'][] = ['instant', 'daily', 'weekly', 'off'];

export function NotificationPrefsForm({ initial }: { initial: NotificationPrefs }) {
  const [prefs, setPrefs] = useState(initial);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const save = async () => {
    setStatus('saving');
    try {
      setPrefs(await api.updateNotificationPrefs({ body: prefs }));
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };
  return (
    <form
      className="flex max-w-md flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={prefs.inApp}
          onChange={(e) => setPrefs({ ...prefs, inApp: e.target.checked })}
        />
        In-app
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={prefs.email}
          onChange={(e) => setPrefs({ ...prefs, email: e.target.checked })}
        />
        Email
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Frequency
        <select
          value={prefs.frequency}
          onChange={(e) =>
            setPrefs({ ...prefs, frequency: e.target.value as NotificationPrefs['frequency'] })
          }
          className="rounded-lg border border-border bg-surface p-2"
        >
          {FREQ.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted">
        Off mutes alerts and the weekly digest. Intent updates always arrive.
      </p>
      <div className="flex items-center gap-3">
        <button
          disabled={status === 'saving'}
          className="rounded-lg bg-accent px-4 py-2 text-sm text-accent-fg disabled:opacity-50"
        >
          Save
        </button>
        <span role="status" className="text-sm text-muted">
          {status === 'saved' && 'Saved.'}
          {status === 'error' && 'Could not save.'}
        </span>
      </div>
    </form>
  );
}
