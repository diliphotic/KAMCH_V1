import { useState, useEffect, useCallback } from 'react';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export interface UsePushNotificationsResult {
  isSupported: boolean;
  permission: NotificationPermission;
  isSubscribed: boolean;
  isLoading: boolean;
  error: string | null;
  subscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<boolean>;
  sendTestNotification: () => Promise<{ success: boolean; message: string }>;
  refreshStatus: () => Promise<void>;
}

export function usePushNotifications(): UsePushNotificationsResult {
  const isSupported =
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window;

  const [permission, setPermission] = useState<NotificationPermission>(() => {
    return typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'default';
  });

  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkSubscription = useCallback(async () => {
    if (!isSupported) return;

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      setIsSubscribed(Boolean(subscription));

      if ('Notification' in window) {
        setPermission(Notification.permission);
      }
    } catch (err) {
      console.warn('[Push Notifications] Could not inspect subscription:', err);
    }
  }, [isSupported]);

  useEffect(() => {
    void checkSubscription();
  }, [checkSubscription]);

  const subscribe = async (): Promise<boolean> => {
    if (!isSupported) {
      setError('Push notifications are not supported by this browser.');
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      // 1. Explicit user permission request (Requirement 4)
      const permResult = await Notification.requestPermission();
      setPermission(permResult);

      if (permResult !== 'granted') {
        setError('Notification permission was denied. Please allow notifications in browser settings.');
        setIsLoading(false);
        return false;
      }

      // 2. Fetch VAPID public key from backend
      const keyRes = await fetch('/api/notifications/push/public-key', {
        headers: { 'Accept': 'application/json' },
      });
      if (!keyRes.ok) {
        throw new Error('Failed to retrieve push server public key');
      }
      const keyData = await keyRes.json();
      const applicationServerKey = urlBase64ToUint8Array(keyData.publicKey);

      // 3. Register push subscription with browser service worker
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey as unknown as BufferSource,
        });
      }

      // 4. Send subscription to institutional backend
      const subRes = await fetch('/api/notifications/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ subscription }),
      });

      if (!subRes.ok) {
        const errJson = await subRes.json().catch(() => ({}));
        throw new Error(errJson.error || 'Backend failed to save push subscription');
      }

      setIsSubscribed(true);
      return true;
    } catch (err: any) {
      const msg = err?.message || 'Could not enable push notifications';
      setError(msg);
      console.error('[Push Notifications] Subscribe failed:', err);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const unsubscribe = async (): Promise<boolean> => {
    if (!isSupported) return false;

    setIsLoading(true);
    setError(null);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();

        // Notify backend to deactivate subscription
        await fetch('/api/notifications/push/unsubscribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({ endpoint }),
        });
      }

      setIsSubscribed(false);
      return true;
    } catch (err: any) {
      const msg = err?.message || 'Failed to unsubscribe';
      setError(msg);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const sendTestNotification = async (): Promise<{ success: boolean; message: string }> => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/notifications/push/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || 'Failed to dispatch test notification');
      }

      return {
        success: true,
        message: data.message || 'Test notification dispatched successfully!',
      };
    } catch (err: any) {
      const msg = err?.message || 'Failed to send test push notification';
      setError(msg);
      return { success: false, message: msg };
    } finally {
      setIsLoading(false);
    }
  };

  return {
    isSupported,
    permission,
    isSubscribed,
    isLoading,
    error,
    subscribe,
    unsubscribe,
    sendTestNotification,
    refreshStatus: checkSubscription,
  };
}
