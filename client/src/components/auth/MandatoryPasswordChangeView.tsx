import React, { useState } from 'react';
import { ShieldCheck, Lock, Eye, EyeOff, AlertCircle, CheckCircle2, LogOut, KeyRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { apiRequest } from '../../lib/apiClient';
import { Button } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';

export const MandatoryPasswordChangeView: React.FC = () => {
  const { user, getInMemoryAccessToken, markPasswordChanged, logout } = useAuth();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const minLength = newPassword.length >= 8;
  const isDifferent = newPassword.length > 0 && newPassword !== currentPassword;
  const isMatching = newPassword.length > 0 && newPassword === confirmPassword;
  const isValid = minLength && isDifferent && isMatching && currentPassword.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || busy) return;

    setBusy(true);
    setError(null);

    const token = getInMemoryAccessToken();
    const result = await apiRequest<{ changed: boolean }>('/api/v1/auth/change-password', token, {
      method: 'POST',
      body: {
        currentPassword,
        newPassword,
      },
    });

    setBusy(false);

    if (result.status === 'OK' && result.data.changed) {
      setSuccess(true);
      setTimeout(() => {
        markPasswordChanged();
      }, 1200);
    } else {
      setError(
        result.status === 'UNAUTHORIZED' || result.status === 'FORBIDDEN' || result.status === 'ERROR'
          ? result.message
          : 'Unable to update password. Please check your current credentials and try again.'
      );
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50/60 via-slate-50 to-blue-100/40 flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-6">
        {/* Header Branding */}
        <div className="text-center space-y-2">
          <div className="inline-flex p-3 bg-white rounded-2xl shadow-sm border border-slate-200/80 mb-1">
            <img
              src="/kmaccs-logo.png"
              alt="KMACCS Logo"
              className="w-16 h-16 object-contain"
            />
          </div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Security Action Required
          </h1>
          <p className="text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
            Welcome to KMACCS HRMS. Your account was provisioned with a temporary or default password.
            You must set a confidential permanent password to access your employee portal.
          </p>
        </div>

        {/* Form Card */}
        <Card className="border-slate-200/80 shadow-lg shadow-blue-900/5 bg-white">
          <CardContent className="p-6 md:p-8 space-y-6">
            {/* Account Context Banner */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 flex items-center justify-between text-xs">
              <div className="space-y-0.5">
                <span className="font-semibold text-slate-800">{user?.fullName}</span>
                <div className="text-slate-500 flex items-center gap-2">
                  {user?.employeeCode && (
                    <span className="font-mono bg-slate-200/70 text-slate-700 px-1.5 py-0.5 rounded text-[11px]">
                      {user.employeeCode}
                    </span>
                  )}
                  <span>{user?.phoneNumber}</span>
                </div>
              </div>
              <span className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                First-Time Setup
              </span>
            </div>

            {error && (
              <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3 text-rose-800 text-xs">
                <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                <div className="leading-relaxed">{error}</div>
              </div>
            )}

            {success ? (
              <div className="p-6 bg-emerald-50 border border-emerald-200 rounded-xl flex flex-col items-center justify-center text-center space-y-2 text-emerald-800">
                <CheckCircle2 className="w-10 h-10 text-emerald-600 animate-bounce" />
                <h3 className="text-sm font-semibold text-emerald-900">Password Changed Successfully!</h3>
                <p className="text-xs text-emerald-700">
                  Securing your session and redirecting you to your portal...
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Current / Initial Password */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-slate-400" />
                    Current (Initial) Password
                  </label>
                  <div className="relative">
                    <input
                      type={showCurrentPassword ? 'text' : 'password'}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Enter the initial password provided to you"
                      className="w-full px-3.5 py-2.5 text-xs text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 pr-10"
                      required
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                    >
                      {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* New Password */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-slate-400" />
                    New Permanent Password
                  </label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Minimum 8 characters"
                      className="w-full px-3.5 py-2.5 text-xs text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 pr-10"
                      required
                      minLength={8}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                    >
                      {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Confirm New Password */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                    Confirm New Permanent Password
                  </label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter your new permanent password"
                      className="w-full px-3.5 py-2.5 text-xs text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 pr-10"
                      required
                      minLength={8}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Password Rules Checklist */}
                <div className="p-3 bg-slate-50 border border-slate-200/70 rounded-lg space-y-1.5 text-[11px] text-slate-600">
                  <div className="flex items-center gap-1.5">
                    <span className={minLength ? 'text-emerald-600 font-bold' : 'text-slate-400'}>
                      {minLength ? '✓' : '○'}
                    </span>
                    <span>At least 8 characters long</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={isDifferent ? 'text-emerald-600 font-bold' : 'text-slate-400'}>
                      {isDifferent ? '✓' : '○'}
                    </span>
                    <span>Different from initial password</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={isMatching ? 'text-emerald-600 font-bold' : 'text-slate-400'}>
                      {isMatching ? '✓' : '○'}
                    </span>
                    <span>Passwords match exactly</span>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="pt-2 space-y-2">
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={!isValid || busy}
                    className="w-full py-2.5 bg-blue-700 hover:bg-blue-800 text-white font-semibold rounded-lg shadow-sm"
                  >
                    {busy ? 'Securing Password...' : 'Save Password & Access Portal'}
                  </Button>

                  <button
                    type="button"
                    onClick={() => logout()}
                    className="w-full py-2 text-xs text-slate-500 hover:text-slate-700 flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Sign Out &amp; Complete Later
                  </button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>

        {/* Footer info */}
        <p className="text-center text-[11px] text-slate-400">
          KMACCS Cooperative Credit Society Limited &bull; Secure Identity Management
        </p>
      </div>
    </div>
  );
};