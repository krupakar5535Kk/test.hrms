import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, KeyRound, Lock, Phone, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../lib/apiClient';
import { HRMS_POLICY, normalizeIndianMobile } from '../lib/domainRules';
import { Button } from '../components/ui/Button';
import { Card, CardContent } from '../components/ui/Card';
import { StatusBanner } from '../components/ui/StatusBanner';

export const ActivateAccountPage: React.FC = () => {
  const [fragmentToken, setFragmentToken] = useState<string>('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailableMsg, setUnavailableMsg] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  // Read opaque 256-bit activation token strictly from client-only URL hash fragment (#token=...),
  // never URL query parameters, preventing server/proxy log leakage.
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#token=')) {
      setFragmentToken(decodeURIComponent(hash.slice('#token='.length)));
    }
  }, []);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setUnavailableMsg(null);

    if (!fragmentToken.trim()) {
      setError('An activation link containing a hash fragment (#token=...) is required.');
      return;
    }
    const mobile = normalizeIndianMobile(phoneNumber);
    if (!mobile.isValid || !mobile.data) {
      setError(mobile.errors[0]?.message ?? 'Valid +91 Indian mobile number is required.');
      return;
    }
    if (password.length < HRMS_POLICY.PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${HRMS_POLICY.PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    const res = await apiRequest('/api/v1/auth/activate', null, {
      method: 'POST',
      body: {
        activationToken: fragmentToken.trim(),
        phoneNumber: mobile.data.canonicalE164,
        password,
      },
    });
    setSubmitting(false);

    if (res.status === 'UNAVAILABLE') {
      setUnavailableMsg(
        'Initial account activation endpoint is pending backend provisioning deployment.'
      );
      return;
    }
    if (res.status !== 'OK') {
      setError(res.message);
      return;
    }

    setCompleted(true);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-4">
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Sign In
        </Link>

        <Card className="border-slate-800 shadow-elevated">
          <CardContent className="p-6 sm:p-8 space-y-5">
            <div className="space-y-1">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600">
                  <ShieldCheck className="w-4 h-4" />
                  Initial Account Activation
                </span>
              </div>
              <h1 className="text-xl font-extrabold tracking-tight">Activate Your HRMS Account</h1>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Verify your one-time activation token (passed via client URL hash{' '}
                <span className="font-mono">#token=...</span>), complete SMS OTP verification, and
                choose your own password. Administrators never set or view your password.
              </p>
            </div>

            {unavailableMsg && (
              <StatusBanner
                tone="unavailable"
                title="Activation Service Not Yet Mounted"
                description={unavailableMsg}
              />
            )}

            {error && <StatusBanner tone="error" title={error} />}

            {completed ? (
              <div className="space-y-4 text-center py-3">
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-base font-bold">Account Activated</h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    Your password has been securely set. Sign in with your Organization Code and mobile number.
                  </p>
                </div>
                <Link to="/login" className="block">
                  <Button className="w-full">Proceed to Login</Button>
                </Link>
              </div>
            ) : (
              <form onSubmit={handleActivate} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="fragToken" className="text-xs font-semibold flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-muted-foreground" />
                    Activation Link Hash Token (#token=...)
                  </label>
                  <input
                    id="fragToken"
                    type="text"
                    placeholder="Open your Admin-issued activation link with #token=..."
                    value={fragmentToken}
                    onChange={(e) => setFragmentToken(e.target.value)}
                    className="w-full h-10 px-3 text-xs rounded-xl border border-input font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="actPhone" className="text-xs font-semibold flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                    Registered Indian Mobile Number (+91)
                  </label>
                  <input
                    id="actPhone"
                    type="tel"
                    placeholder="10-digit mobile number"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="w-full h-10 px-3 text-sm rounded-xl border border-input font-mono"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label htmlFor="actPass" className="text-xs font-semibold flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                      Choose Password
                    </label>
                    <input
                      id="actPass"
                      type="password"
                      placeholder="Min 8 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full h-10 px-3 text-sm rounded-xl border border-input"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="actConfirm" className="text-xs font-semibold">
                      Confirm Password
                    </label>
                    <input
                      id="actConfirm"
                      type="password"
                      placeholder="Repeat password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full h-10 px-3 text-sm rounded-xl border border-input"
                    />
                  </div>
                </div>

                <Button type="submit" loading={submitting} className="w-full">
                  Complete Activation &amp; Set Password
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
