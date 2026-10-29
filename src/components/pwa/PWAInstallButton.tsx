import React, { useState } from 'react';
import { Download, Share2, X, Smartphone, Check } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSModal, setShowIOSModal] = useState(false);
  const [installSuccess, setInstallSuccess] = useState(false);

  // If already running installed in standalone mode, hide
  if (isInstalled) {
    return null;
  }

  const handleInstallClick = async () => {
    if (isInstallable) {
      const success = await install();
      if (success) {
        setInstallSuccess(true);
        setTimeout(() => setInstallSuccess(false), 4000);
      }
    } else if (isIOS) {
      setShowIOSModal(true);
    }
  };

  if (!isInstallable && !isIOS && !installSuccess) {
    return null;
  }

  if (installSuccess) {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg">
        <Check className="w-3.5 h-3.5 text-emerald-600" />
        <span className="hidden sm:inline">Installed Successfully</span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleInstallClick}
        title="Install KAMCH ERP on your device"
        className="inline-flex items-center justify-center gap-1.5 min-h-[34px] px-2.5 py-1 text-xs font-semibold rounded-lg text-[#4B2E2E] bg-[#FAF9F5] hover:bg-[#F2EFE9] border border-[#E8E2D7] shadow-2xs transition-all duration-200 ease-out active:scale-[0.98] cursor-pointer"
      >
        <Download className="w-3.5 h-3.5 text-[#4B2E2E]" />
        <span className="hidden sm:inline">Install App</span>
      </button>

      {/* iOS Installation Instruction Modal */}
      {showIOSModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 p-4 backdrop-blur-2xs">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl border border-stone-200 text-stone-800">
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-[#4B2E2E]" />
                <h3 className="text-sm font-bold text-[#4B2E2E]">Install on iPhone / iPad</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowIOSModal(false)}
                className="text-stone-400 hover:text-stone-600 p-1 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-3 text-xs text-stone-600 space-y-2.5">
              <p>To install KAMCH ERP on your home screen via Safari:</p>
              <div className="flex items-start gap-2 bg-stone-50 p-2.5 rounded-lg border border-stone-100">
                <Share2 className="w-4 h-4 text-[#4B2E2E] shrink-0 mt-0.5" />
                <span>
                  1. Tap the <strong>Share</strong> icon in the Safari bottom toolbar.
                </span>
              </div>
              <div className="flex items-start gap-2 bg-stone-50 p-2.5 rounded-lg border border-stone-100">
                <Download className="w-4 h-4 text-[#4B2E2E] shrink-0 mt-0.5" />
                <span>
                  2. Scroll down and tap <strong>Add to Home Screen</strong>.
                </span>
              </div>
              <div className="flex items-start gap-2 bg-stone-50 p-2.5 rounded-lg border border-stone-100">
                <Check className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                <span>
                  3. Tap <strong>Add</strong> in the top-right corner to complete.
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowIOSModal(false)}
              className="mt-4 w-full rounded-lg bg-[#4B2E2E] py-2 text-xs font-semibold text-[#FAF9F5] hover:bg-[#382222] transition"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
};
