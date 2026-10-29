import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Bell, Check, Inbox, Send, ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePushNotifications } from '../../hooks/usePushNotifications';

export interface NotificationItem {
  id: number;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  created_at: string;
}

export const NotificationDropdown: React.FC = () => {
  const { user, csrfToken } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [testFeedback, setTestFeedback] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const {
    isSupported: isPushSupported,
    permission: pushPermission,
    isSubscribed,
    isLoading: pushLoading,
    error: pushError,
    subscribe,
    unsubscribe,
    sendTestNotification,
  } = usePushNotifications();

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/notifications');
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
      }
      const countRes = await fetch('/api/notifications/unread-count');
      if (countRes.ok) {
        const countData = await countRes.json();
        setUnreadCount(countData.count || 0);
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  }, [user]);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 15000); // poll every 15s
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const markAsRead = async (id: number) => {
    if (!csrfToken) return;
    try {
      const res = await fetch(`/api/notifications/${id}/read`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrfToken },
      });
      if (res.ok) {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (err) {
      console.error('Failed to mark notification read:', err);
    }
  };

  const handleTestPush = async () => {
    setTestFeedback('Sending test notification...');
    const res = await sendTestNotification();
    setTestFeedback(res.message);
    setTimeout(() => setTestFeedback(null), 5000);
  };

  if (!user) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) fetchNotifications();
        }}
        className="relative p-2 text-stone-700 hover:text-stone-900 rounded-lg hover:bg-stone-100 transition-all duration-200 cursor-pointer"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 bg-red-600 text-white font-bold text-[10px] w-4 h-4 rounded-full flex items-center justify-center shadow-xs">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-stone-200 rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in duration-200">
          <div className="px-4 py-3 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
            <span className="font-semibold text-xs text-stone-900 uppercase tracking-wide">
              Notifications {unreadCount > 0 && `(${unreadCount} unread)`}
            </span>
            <button
              type="button"
              onClick={fetchNotifications}
              className="text-[11px] text-[#4B2E2E] hover:underline font-medium"
            >
              Refresh
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto divide-y divide-stone-100">
            {notifications.length === 0 ? (
              <div className="py-10 flex flex-col items-center justify-center text-stone-400 text-xs gap-1.5">
                <Inbox className="w-8 h-8 text-stone-300" />
                <span>No notifications yet</span>
              </div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  className={`p-3.5 transition-colors text-left flex flex-col gap-1 ${
                    n.is_read ? 'bg-white opacity-75' : 'bg-amber-50/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-xs text-stone-900">{n.title}</span>
                    <span className="text-[10px] text-stone-400 shrink-0 font-mono">
                      {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-xs text-stone-600 leading-relaxed">{n.message}</p>
                  {!n.is_read && (
                    <div className="flex justify-end mt-1">
                      <button
                        type="button"
                        onClick={() => markAsRead(n.id)}
                        className="inline-flex items-center gap-1 text-[11px] text-[#4B2E2E] hover:underline font-medium"
                      >
                        <Check className="w-3 h-3" /> Mark as Read
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Web Push Notification Infrastructure Control Panel (Requirement 4) */}
          <div className="p-3 bg-stone-50/90 border-t border-stone-200 text-xs">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="font-semibold text-[11px] text-stone-700 flex items-center gap-1">
                <Bell className="w-3.5 h-3.5 text-[#4B2E2E]" />
                Device Push Notifications
              </span>
              <span className="text-[10px] text-stone-500 font-mono">
                {isSubscribed ? (
                  <span className="text-emerald-700 font-semibold inline-flex items-center gap-0.5">
                    <ShieldCheck className="w-3 h-3" /> Active
                  </span>
                ) : pushPermission === 'denied' ? (
                  <span className="text-red-600">Blocked in Browser</span>
                ) : (
                  <span>Inactive</span>
                )}
              </span>
            </div>

            {isPushSupported ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={pushLoading || pushPermission === 'denied'}
                    onClick={() => {
                      if (isSubscribed) {
                        void unsubscribe();
                      } else {
                        void subscribe();
                      }
                    }}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-md border transition cursor-pointer flex items-center gap-1 ${
                      isSubscribed
                        ? 'bg-stone-100 text-stone-700 border-stone-300 hover:bg-stone-200'
                        : 'bg-[#4B2E2E] text-white border-[#3B2424] hover:bg-[#3B2424]'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {pushLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                    <span>{isSubscribed ? 'Disable on Device' : 'Enable Device Push'}</span>
                  </button>

                  {isSubscribed && (
                    <button
                      type="button"
                      disabled={pushLoading}
                      onClick={handleTestPush}
                      className="px-2.5 py-1 text-[11px] font-medium text-[#4B2E2E] bg-white border border-[#4B2E2E]/30 rounded-md hover:bg-amber-50/50 transition cursor-pointer flex items-center gap-1"
                    >
                      <Send className="w-3 h-3" />
                      <span>Send Test Push</span>
                    </button>
                  )}
                </div>

                {testFeedback && (
                  <p className="text-[11px] text-[#4B2E2E] font-medium bg-amber-50 p-1.5 rounded border border-amber-200/60 animate-in fade-in">
                    {testFeedback}
                  </p>
                )}

                {pushError && (
                  <p className="text-[11px] text-red-600 flex items-center gap-1 mt-1">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    <span>{pushError}</span>
                  </p>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-stone-500 italic">
                Web Push is not supported by your current browser.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
