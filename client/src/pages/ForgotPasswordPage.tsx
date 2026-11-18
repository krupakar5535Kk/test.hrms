import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Building2, CheckCircle2, KeyRound, Lock, Phone } from 'lucide-react';
import { apiRequest } from '../lib/apiClient';
import { HRMS_POLICY, normalizeIndianMobile } from '../lib/domainRules';
import { Button } from '../components/ui/Button';
import { Card, CardContent } from '../components/ui/Card';
import { StatusBanner } from '../components/ui/StatusBanner';

export const ForgotPasswordPage: React.FC = () => {
  const [step, setStep] = useState<'REQUEST_OTP' | 'RESET_PASSWORD' | 'DONE'>('REQUEST_OTP');
  const [organizationCode, setOrganizationCode] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailableMsg, setUnavailableMsg] = useState<string | null>(null);

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setUnavailableMsg(null);
    const org = organizationCode.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{2,20}$/.test(org)) {
      setError('Organization code must be 2–20 alphanumeric characters.');
      return;
    }
    const mobile = normalizeIndianMobile(phoneNumber);
    if (!mobile.isValid || !mobile.data) {
      setError(mobile.errors[0]?.message ?? 'Invalid Indian mobile number.');
      return;
    }

    setSubmitting(true);
    const res = await apiRequest('/api/v1/auth/password-reset/request-otp', null, {
      method: 'POST',
      body: {
        organizationCode: org,
        phoneNumber: mobile.data.tenDigit,
      },
    });
    setSubmitting(false);

    if (res.status === 'UNAVAILABLE') {
      setUnavailableMsg(
        'Mobile OTP password recovery endpoint is pending backend SMS gateway configuration.'
      );
      return;
    }
    if (res.status !== 'OK') {
      setError(res.message);
      return;
    }

    setStep('RESET_PASSWORD');
  };

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setUnavailableMsg(null);
    if (!/^\d{6}$/.test(otp.trim())) {
      setError('Enter the 6-digit verification OTP sent to your registered mobile.');
      return;
    }
    if (newPassword.length < HRMS_POLICY.PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${HRMS_POLICY.PASSWORD_MIN_LENGTH} characters.`);
      return;
    }

    const mobile = normalizeIndianMobile(phoneNumber);
    setSubmitting(true);
    const res = await apiRequest('/api/v1/auth/password-reset/confirm', null, {
      method: 'POST',
      body: {
        organizationCode: organizationCode.trim().toUpperCase(),
        phoneNumber: mobile.data?.tenDigit ?? phoneNumber,
        otp: otp.trim(),
        newPassword,
      },
    });
    setSubmitting(false);

    if (res.status === 'UNAVAILABLE') {
      setUnavailableMsg(
        'Mobile OTP password reset confirmation endpoint is pending backend implementation.'
      );
      return;
    }
    if (res.status !== 'OK') {
      setError(res.message);
      return;
    }

    setStep('DONE');
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
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
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600">
                  <KeyRound className="w-4 h-4" />
                  PO-03 Password Recovery
                </span>
              </div>
              <h1 className="text-xl font-extrabold tracking-tight text-foreground">
                Reset Password via Mobile OTP
              </h1>
              <p className="text-xs text-muted-foreground">
                Verify your organization code and registered Indian mobile number (+91). Administrators
                never view or manage your password.
              </p>
            </div>

            {unavailableMsg && (
              <StatusBanner
                tone="unavailable"
                title="OTP Service Not Yet Mounted"
                description={unavailableMsg}
              />
            )}

            {error && <StatusBanner tone="error" title={error} />}

            {step === 'REQUEST_OTP' && (
              <form onSubmit={handleRequestOtp} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="resetOrg" className="text-xs font-semibold flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                    Organization Code
                  </label>
                  <input
                    id="resetOrg"
                    type="text"
                    placeholder="Enter organization code"
                    value={organizationCode}
                    onChange={(e) => setOrganizationCode(e.target.value.toUpperCase())}
                    className="w-full h-10 px-3 text-sm rounded-xl border border-input font-mono uppercase"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="resetPhone" className="text-xs font-semibold flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                    Registered Indian Mobile (+91)
                  </label>
                  <input
                    id="resetPhone"
                    type="tel"
                    placeholder="10-digit mobile number"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="w-full h-10 px-3 text-sm rounded-xl border border-input font-mono"
                  />
                </div>

                <Button type="submit" loading={submitting} className="w-full">
                  Send Verification OTP
                </Button>
              </form>
            )}

            {step === 'RESET_PASSWORD' && (
              <form onSubmit={handleConfirmReset} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="otpInput" className="text-xs font-semibold">
                    6-Digit OTP Code
                  </label>
                  <input
                    id="otpInput"
                    type="text"
                    maxLength={6}
                    placeholder="6-digit OTP"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    className="w-full h-10 px-3 text-sm rounded-xl border border-input font-mono tracking-widest"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="newPass" className="text-xs font-semibold flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                    New Password (min 8 chars)
                  </label>
                  <input
                    id="newPass"
                    type="password"
                    placeholder="Choose your own strong password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full h-10 px-3 text-sm rounded-xl border border-input"
                  />
                </div>

                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setStep('REQUEST_OTP')}>
                    Back
                  </Button>
                  <Button type="submit" loading={submitting} className="flex-1">
                    Update Password
                  </Button>
                </div>
              </form>
            )}

            {step === 'DONE' && (
              <div className="space-y-4 text-center py-2">
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-base font-bold">Password Updated</h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    Active sessions have been revoked. Please sign in with your new password.
                  </p>
                </div>
                <Link to="/login" className="block">
                  <Button className="w-full">Return to Sign In</Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
