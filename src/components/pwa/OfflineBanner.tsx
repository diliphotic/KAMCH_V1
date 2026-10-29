import React from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export const OfflineBanner: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) {
    return null;
  }

  return (
    <div
      role="alert"
      className="bg-amber-900 text-amber-100 text-xs px-3 sm:px-6 py-2 flex items-center justify-between gap-3 shadow-sm border-b border-amber-950 z-40 relative print:hidden"
    >
      <div className="flex items-center gap-2">
        <WifiOff className="w-4 h-4 text-amber-300 shrink-0" />
        <span className="font-medium">
          Offline Mode: You are disconnected from institutional servers. For security and integrity, live student records, marks, and financial data are not cached offline.
        </span>
      </div>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="shrink-0 inline-flex items-center gap-1 bg-amber-800 hover:bg-amber-700 text-amber-50 px-2 py-0.5 rounded text-[11px] font-semibold border border-amber-700 transition"
      >
        <RefreshCw className="w-3 h-3" />
        Reconnect
      </button>
    </div>
  );
};
