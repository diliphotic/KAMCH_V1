import React, { useState } from 'react';
import { ShieldAlert, KeyRound, AlertCircle, CheckCircle2, Lock, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../ui/Button';

export const ChangePasswordModal: React.FC = () => {
  const { user, isPasswordModalOpen, closePasswordModal, changePassword, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isMandatory = Boolean(user?.mustChangePassword);
  const isOpen = Boolean(user && (isMandatory || isPasswordModalOpen));

  if (!isOpen || !user) {
    return null;
  }

  const resetFields = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setErrorMessage(null);
  };

  const handleClose = () => {
    if (isMandatory || isSubmitting) return;
    resetFields();
    closePasswordModal();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!currentPassword) {
      setErrorMessage('Please enter your current password.');
      return;
    }

    if (!newPassword || newPassword.length < 8) {
      setErrorMessage('New password must be at least 8 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage('New password and confirmation password do not match.');
      return;
    }

    if (currentPassword === newPassword) {
      setErrorMessage('Your new password must be different from your current password.');
      return;
    }

    setIsSubmitting(true);
    const result = await changePassword(currentPassword, newPassword);
    setIsSubmitting(false);

    if (!result.success) {
      setErrorMessage(result.error || 'Failed to update password. Please check your current password.');
    } else {
      resetFields();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="change-password-title"
    >
      <div className="relative w-full max-w-md bg-white rounded-2xl border border-stone-200 shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95 duration-200 ease-out">
        {/* Top Gold Accent Hairline */}
        <div className="h-1 bg-[#D4AF37] w-full shrink-0" />

        {/* Modal Header */}
        <div className="p-4 sm:p-5 bg-[#FAF9F5] border-b border-stone-200 shrink-0 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#4B2E2E] flex items-center justify-center text-[#D4AF37] shadow-xs shrink-0">
              {isMandatory ? (
                <ShieldAlert className="w-5 h-5 text-amber-400" />
              ) : (
                <KeyRound className="w-5 h-5 text-[#D4AF37]" />
              )}
            </div>
            <div>
              <h3
                id="change-password-title"
                className="font-serif text-base font-bold text-stone-900 leading-tight"
              >
                {isMandatory ? 'Mandatory Password Change' : 'Change Account Password'}
              </h3>
              <p className="text-xs text-stone-500 mt-0.5">
                {isMandatory
                  ? 'Replace your temporary password to access KAMCH ERP.'
                  : `Update password for ${user.username}`}
              </p>
            </div>
          </div>

          {!isMandatory && (
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="text-stone-400 hover:text-stone-700 p-1.5 rounded-lg hover:bg-stone-200/60 transition-colors cursor-pointer"
              aria-label="Close change password dialog"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
          {errorMessage && (
            <div
              className="p-3 rounded-lg bg-rose-50 border border-rose-300 text-rose-900 text-xs leading-relaxed flex items-start gap-2.5"
              role="alert"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-700" />
              <div>
                <span className="font-semibold block mb-0.5">Password Error</span>
                <span>{errorMessage}</span>
              </div>
            </div>
          )}

          {/* Current Password Field */}
          <div>
            <label
              htmlFor="current-password"
              className="block text-xs font-semibold text-stone-800 mb-1"
            >
              {isMandatory ? 'Current Temporary Password' : 'Current Password'}{' '}
              <span className="text-rose-700">*</span>
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-400">
                <KeyRound className="w-4 h-4" />
              </span>
              <input
                id="current-password"
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={isSubmitting}
                placeholder="Enter current password"
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-[#4B2E2E] transition-all duration-200 ease-out"
              />
            </div>
          </div>

          {/* New Password Field */}
          <div>
            <label
              htmlFor="new-password"
              className="block text-xs font-semibold text-stone-800 mb-1"
            >
              New Password <span className="text-rose-700">*</span>
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-400">
                <Lock className="w-4 h-4" />
              </span>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={isSubmitting}
                placeholder="Minimum 8 characters"
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-[#4B2E2E] transition-all duration-200 ease-out"
              />
            </div>
            <span className="text-[11px] text-stone-500 mt-0.5 block">
              Must be at least 8 characters long.
            </span>
          </div>

          {/* Confirm New Password Field */}
          <div>
            <label
              htmlFor="confirm-password"
              className="block text-xs font-semibold text-stone-800 mb-1"
            >
              Confirm New Password <span className="text-rose-700">*</span>
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-400">
                <Lock className="w-4 h-4" />
              </span>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={isSubmitting}
                placeholder="Re-enter new password"
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-stone-300 rounded-lg text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-[#4B2E2E] transition-all duration-200 ease-out"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-3 pt-3 border-t border-stone-200">
            {isMandatory ? (
              <button
                type="button"
                onClick={logout}
                disabled={isSubmitting}
                className="text-xs text-stone-500 hover:text-stone-800 underline cursor-pointer py-1"
              >
                Sign Out Instead
              </button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleClose}
                disabled={isSubmitting}
                className="w-full sm:w-auto justify-center"
              >
                Cancel
              </Button>
            )}
            <Button
              type="submit"
              variant="primary"
              size="sm"
              isLoading={isSubmitting}
              icon={<CheckCircle2 className="w-3.5 h-3.5" />}
              className="w-full sm:w-auto justify-center"
            >
              {isMandatory ? 'Update Password & Continue' : 'Save New Password'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
