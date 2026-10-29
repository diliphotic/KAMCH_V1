import React, { useState } from 'react';
import { Lock, User, AlertCircle, X, Loader2, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../ui/Button';
import { CollegeLogo } from '../ui/CollegeLogo';

export const LoginModal: React.FC = () => {
  const { isLoginModalOpen, closeLoginModal, login, sessionNotice, clearSessionNotice } = useAuth();
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLockedState, setIsLockedState] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isLoginModalOpen) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    clearSessionNotice();
    setIsLockedState(false);

    if (!usernameOrEmail.trim() || !password) {
      setErrorMessage('Please enter your username/email and password.');
      return;
    }

    setIsSubmitting(true);
    const result = await login(usernameOrEmail.trim(), password);
    setIsSubmitting(false);

    if (!result.success) {
      setErrorMessage(result.error || 'Authentication failed');
      if (result.code === 'ACCOUNT_LOCKED') {
        setIsLockedState(true);
      }
    } else {
      setUsernameOrEmail('');
      setPassword('');
      setErrorMessage(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-modal-title"
    >
      <div className="relative w-full max-w-md bg-white rounded-2xl border border-stone-200 shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95 duration-200 ease-out">
        {/* Top Gold Accent Hairline */}
        <div className="h-1 bg-[#D4AF37] w-full shrink-0" />

        {/* Modal Header */}
        <div className="p-4 sm:p-5 bg-[#FAF9F5] border-b border-stone-200 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-white p-0.5 flex items-center justify-center shrink-0 border border-[#D4AF37]/30 shadow-xs">
                <CollegeLogo size="sm" className="w-full h-full" />
              </div>
              <div>
                <h3
                  id="login-modal-title"
                  className="font-serif text-base font-bold text-stone-900 leading-tight"
                >
                  Institutional Sign In
                </h3>
                <span className="text-[11px] text-stone-500 font-sans">
                  Krishna Ayurvedic Medical College
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={closeLoginModal}
              disabled={isSubmitting}
              className="text-stone-400 hover:text-stone-700 p-1.5 rounded-lg hover:bg-stone-200/60 transition-all duration-200 ease-out cursor-pointer"
              aria-label="Close login dialog"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
          {/* Remote Session Invalidation Notice */}
          {sessionNotice && !errorMessage && (
            <div
              className="p-3 rounded-lg text-xs leading-relaxed flex items-start gap-2.5 bg-amber-50 border border-amber-300 text-amber-900 animate-in fade-in duration-200"
              role="alert"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
              <div>
                <span className="font-semibold block mb-0.5">
                  Single Session Policy
                </span>
                <span>{sessionNotice}</span>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <div
              className={`p-3 rounded-lg text-xs leading-relaxed flex items-start gap-2.5 ${
                isLockedState
                  ? 'bg-rose-50 border border-rose-300 text-rose-900'
                  : 'bg-amber-50 border border-amber-300 text-amber-900'
              }`}
              role="alert"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
              <div>
                <span className="font-semibold block mb-0.5">
                  {isLockedState ? 'Security Account Lockout' : 'Authentication Notice'}
                </span>
                <span>{errorMessage}</span>
              </div>
            </div>
          )}

          {/* Username / Email Field */}
          <div>
            <label
              htmlFor="login-username"
              className="block text-xs font-semibold text-stone-800 mb-1"
            >
              Username or Institutional Email <span className="text-rose-700">*</span>
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-400">
                <User className="w-4 h-4" />
              </span>
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                required
                value={usernameOrEmail}
                onChange={(e) => setUsernameOrEmail(e.target.value)}
                disabled={isSubmitting}
                placeholder="superadmin or user@kamch.ac.in"
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-[#4B2E2E] transition-all duration-200 ease-out"
              />
            </div>
          </div>

          {/* Password Field */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="login-password"
                className="block text-xs font-semibold text-stone-800"
              >
                Password <span className="text-rose-700">*</span>
              </label>
            </div>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-400">
                <Lock className="w-4 h-4" />
              </span>
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isSubmitting}
                placeholder="••••••••••••"
                className="w-full pl-9 pr-10 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-[#4B2E2E] transition-all duration-200 ease-out"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-stone-400 hover:text-stone-600 cursor-pointer"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-2 sm:gap-2.5 pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={closeLoginModal}
              disabled={isSubmitting}
              className="w-full sm:w-auto justify-center"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              isLoading={isSubmitting}
              icon={<Lock className="w-3.5 h-3.5" />}
              className="w-full sm:w-auto justify-center"
            >
              Sign In
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
