import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  LogIn,
  Shield,
  Smartphone,
  User,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getPostAuthDestination, HRMS_POLICY } from '../lib/domainRules';
import { StatusBanner } from '../components/ui/StatusBanner';
import { BrandIntroScreen } from '../components/BrandIntroScreen';

interface AuthPortalProps {
  portalVariant?: 'EMPLOYEE' | 'ADMIN';
}

export const AuthPortal: React.FC<AuthPortalProps> = ({ portalVariant = 'EMPLOYEE' }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, health, loginWithCredentials, failedAttemptsCount } = useAuth();
  const isAdminPortal = portalVariant === 'ADMIN';

  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [throttleSeconds, setThrottleSeconds] = useState<number | null>(null);
  const [showIntro, setShowIntro] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('kmaccs_intro_played') !== 'true';
    } catch {
      return false;
    }
  });

  // Load remembered user name and phone if available
  useEffect(() => {
    try {
      const savedName = localStorage.getItem('kmaccs_saved_name');
      const savedPhone = localStorage.getItem('kmaccs_saved_phone');
      if (savedName) setFullName(savedName);
      if (savedPhone) setPhoneNumber(savedPhone);
      const savedRemember = localStorage.getItem('kmaccs_remember_me');
      if (savedRemember === 'true') {
        setRememberMe(true);
      }
    } catch {
      // Ignore local storage error in sandboxed contexts
    }
  }, []);

  // Redirect if already authenticated
  useEffect(() => {
    if (user) {
      navigate(getPostAuthDestination(user.role), { replace: true });
    }
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);
    setThrottleSeconds(null);
    setFieldErrors({});

    const errors: Record<string, string> = {};
    const cleanName = fullName.trim();
    const cleanPhone = phoneNumber.trim().replace(/\D/g, '');

    if (!cleanName) {
      errors['fullName'] = 'Full Name is required.';
    } else if (cleanName.length < 2) {
      errors['fullName'] = 'Please enter your registered full name (minimum 2 characters).';
    }

    if (!cleanPhone) {
      errors['phoneNumber'] = 'Registered Mobile Number is required.';
    } else if (cleanPhone.length < 10) {
      errors['phoneNumber'] = 'Please enter a valid 10-digit mobile number.';
    }

    if (!password) {
      errors['password'] = 'Password is required.';
    } else if (password.length < 8) {
      errors['password'] = 'Password must be at least 8 characters.';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    // Save remember me preference
    try {
      if (rememberMe) {
        localStorage.setItem('kmaccs_saved_name', cleanName);
        localStorage.setItem('kmaccs_saved_phone', cleanPhone);
        localStorage.setItem('kmaccs_remember_me', 'true');
      } else {
        localStorage.removeItem('kmaccs_saved_name');
        localStorage.removeItem('kmaccs_saved_phone');
        localStorage.removeItem('kmaccs_remember_me');
      }
    } catch {
      // Ignore
    }

    setSubmitting(true);
    const outcome = await loginWithCredentials({
      fullName: cleanName,
      phoneNumber: cleanPhone,
      password,
    });
    setSubmitting(false);

    if (!outcome.ok) {
      if (outcome.fieldErrors) {
        setFieldErrors(outcome.fieldErrors);
      }
      if (outcome.throttled) setThrottleSeconds(outcome.retryAfterSeconds ?? 900);
      if (outcome.errorMessage) setApiError(outcome.errorMessage);
      return;
    }

    // Verified backend role strictly determines destination regardless of entry URL
    if (outcome.role) {
      navigate(getPostAuthDestination(outcome.role), { replace: true });
    }
  };

  const handleSwitchPortal = (target: 'EMPLOYEE' | 'ADMIN') => {
    if (target === 'ADMIN' && !isAdminPortal) {
      navigate('/admin/login', { replace: false, state: { from: location.pathname } });
    } else if (target === 'EMPLOYEE' && isAdminPortal) {
      navigate('/login', { replace: false, state: { from: location.pathname } });
    }
  };

  return (
    <>
      {showIntro && !user && (
        <BrandIntroScreen
          onComplete={() => {
            try {
              sessionStorage.setItem('kmaccs_intro_played', 'true');
            } catch {
              // Ignore
            }
            setShowIntro(false);
          }}
        />
      )}
      <div className="min-h-screen relative overflow-hidden bg-gradient-to-b from-[#EDF5FE] via-[#E4EFFD] to-[#D5E6FA] flex flex-col justify-between font-sans selection:bg-[#0B357A]/15 selection:text-[#0B357A]">
      {/* Background Radial Light Accent */}
      <div
        className="absolute top-0 left-1/4 -translate-x-1/2 w-[700px] h-[700px] bg-gradient-to-br from-white/80 via-blue-100/40 to-transparent rounded-full blur-3xl pointer-events-none"
        aria-hidden="true"
      />
      <div
        className="absolute -top-40 -right-20 w-[600px] h-[600px] bg-gradient-to-bl from-white/70 via-blue-50/50 to-transparent rounded-full blur-3xl pointer-events-none"
        aria-hidden="true"
      />

      {/* Main Content Area */}
      <div className="relative z-10 flex-1 flex flex-col lg:flex-row items-center justify-center max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-12 py-8 sm:py-12 lg:py-16 gap-8 lg:gap-16">
        {/* Left Column: Official Large KMACCS Logo */}
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <div className="relative transition-transform duration-500 hover:scale-[1.01]">
            <img
              src="/kmaccs-logo.jpg"
              alt="Karthikeya Mutually Aided Cooperative Credit Society Limited (KMACCS)"
              className="w-56 h-56 sm:w-72 sm:h-72 md:w-88 md:h-88 lg:w-[440px] lg:h-[440px] object-contain drop-shadow-[0_12px_24px_rgba(11,53,122,0.12)] select-none pointer-events-none"
              width={1024}
              height={1024}
            />
          </div>
        </div>

        {/* Right Column: Clean White Floating Login Card */}
        <div className="w-full max-w-md flex-1 flex justify-center">
          <div className="w-full bg-white rounded-3xl sm:rounded-[32px] p-6 sm:p-9 shadow-[0_20px_60px_-15px_rgba(11,53,122,0.14)] border border-blue-100/70 relative">
            {/* Top Segmented Portal Toggle */}
            <div className="bg-[#EEF4FB] p-1 rounded-2xl flex items-center mb-6">
              <button
                type="button"
                onClick={() => handleSwitchPortal('EMPLOYEE')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer ${
                  !isAdminPortal
                    ? 'bg-[#0B357A] text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <User className="w-4 h-4 shrink-0" />
                <span>Employee Login</span>
              </button>

              <button
                type="button"
                onClick={() => handleSwitchPortal('ADMIN')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer ${
                  isAdminPortal
                    ? 'bg-[#0B357A] text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Shield className="w-4 h-4 shrink-0" />
                <span>Admin Login</span>
              </button>
            </div>

            {/* Title Section */}
            <div className="mb-5">
              <p className="text-xs font-bold text-[#0B357A] uppercase tracking-wider mb-1">
                KMACCS HRMS
              </p>
              <h1 className="text-2xl sm:text-[28px] font-extrabold text-[#0F172A] tracking-tight">
                {isAdminPortal ? 'Admin Login' : 'Employee Login'}
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                {isAdminPortal
                  ? 'Secure access to HRMS administration'
                  : 'Access your attendance, leave, payroll and more'}
              </p>
            </div>

            {/* Offline & Error Banners */}
            {!health.reachable && health.status !== 'checking' && (
              <div className="mb-4">
                <StatusBanner
                  tone="offline"
                  title="Backend Server Offline"
                  description="Authentication service is currently unreachable. Please check connection."
                />
              </div>
            )}

            {apiError && (
              <div className="mb-4">
                <StatusBanner
                  tone={throttleSeconds ? 'warning' : 'error'}
                  title={throttleSeconds ? 'Temporary Throttling Active' : 'Authentication Notice'}
                  description={
                    throttleSeconds
                      ? `${apiError} Please wait ${Math.ceil(throttleSeconds / 60)} minute(s) before retrying.`
                      : apiError
                  }
                />
              </div>
            )}

            {!apiError && failedAttemptsCount >= 3 && (
              <div className="mb-4">
                <StatusBanner
                  tone="warning"
                  title="Security Notice"
                  description={`Failed attempts (${failedAttemptsCount}/${HRMS_POLICY.MAX_FAILED_LOGIN_ATTEMPTS}): temporary throttling activates after 5 failed attempts.`}
                />
              </div>
            )}

            {/* Login Form */}
            <form onSubmit={handleSubmit} className="space-y-3.5" noValidate>
              {/* Field 1: Full Name */}
              <div>
                <label htmlFor="fullName" className="block text-[11px] font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Full Name
                </label>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                    <User className="w-4 h-4" />
                  </div>
                  <input
                    id="fullName"
                    name="fullName"
                    type="text"
                    autoComplete="name"
                    placeholder="Enter your registered full name"
                    value={fullName}
                    onChange={(e) => {
                      setFullName(e.target.value);
                      setFieldErrors((p) => ({ ...p, fullName: '' }));
                    }}
                    className={`w-full h-11 sm:h-12 pl-10 pr-4 text-xs sm:text-sm rounded-xl border bg-white text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:border-[#0B357A] focus:ring-2 focus:ring-[#0B357A]/15 transition-all ${
                      fieldErrors['fullName']
                        ? 'border-rose-500 ring-2 ring-rose-100'
                        : 'border-slate-200'
                    }`}
                  />
                </div>
                {fieldErrors['fullName'] && (
                  <p className="text-[11px] font-medium text-rose-600 mt-1 pl-1">
                    {fieldErrors['fullName']}
                  </p>
                )}
              </div>

              {/* Field 2: Mobile Number */}
              <div>
                <label htmlFor="phoneNumber" className="block text-[11px] font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Registered Mobile Number
                </label>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                    <Smartphone className="w-4 h-4" />
                  </div>
                  <input
                    id="phoneNumber"
                    name="phoneNumber"
                    type="tel"
                    autoComplete="tel"
                    placeholder="10-digit Mobile Number (e.g. 7816029162)"
                    value={phoneNumber}
                    onChange={(e) => {
                      setPhoneNumber(e.target.value);
                      setFieldErrors((p) => ({ ...p, phoneNumber: '' }));
                    }}
                    className={`w-full h-11 sm:h-12 pl-10 pr-4 text-xs sm:text-sm rounded-xl border bg-white text-slate-900 placeholder:text-slate-400 font-mono focus:outline-hidden focus:border-[#0B357A] focus:ring-2 focus:ring-[#0B357A]/15 transition-all ${
                      fieldErrors['phoneNumber']
                        ? 'border-rose-500 ring-2 ring-rose-100'
                        : 'border-slate-200'
                    }`}
                  />
                </div>
                {fieldErrors['phoneNumber'] && (
                  <p className="text-[11px] font-medium text-rose-600 mt-1 pl-1">
                    {fieldErrors['phoneNumber']}
                  </p>
                )}
              </div>

              {/* Field 3: Password */}
              <div>
                <label htmlFor="password" className="block text-[11px] font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Password
                </label>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="Enter password (min 8 characters)"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setFieldErrors((p) => ({ ...p, password: '' }));
                    }}
                    className={`w-full h-11 sm:h-12 pl-10 pr-11 text-xs sm:text-sm rounded-xl border bg-white text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:border-[#0B357A] focus:ring-2 focus:ring-[#0B357A]/15 transition-all ${
                      fieldErrors['password']
                        ? 'border-rose-500 ring-2 ring-rose-100'
                        : 'border-slate-200'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer p-0.5"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {fieldErrors['password'] && (
                  <p className="text-[11px] font-medium text-rose-600 mt-1 pl-1">
                    {fieldErrors['password']}
                  </p>
                )}
              </div>

              {/* Options: Remember me & Forgot password */}
              <div className="flex items-center justify-between pt-1 pb-1 text-xs">
                <label className="flex items-center gap-2 cursor-pointer select-none text-slate-600 hover:text-slate-800 transition-colors">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-[#0B357A] focus:ring-[#0B357A]/20 cursor-pointer"
                  />
                  <span>Remember me</span>
                </label>

                <Link
                  to="/forgot-password"
                  className="font-medium text-blue-600 hover:text-blue-800 hover:underline transition-colors"
                >
                  Forgot password?
                </Link>
              </div>

              {/* Primary Action Button */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full h-11 sm:h-12 rounded-xl bg-[#0B357A] hover:bg-[#08285C] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-xs sm:text-sm shadow-md shadow-[#0B357A]/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {submitting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Signing in...</span>
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4 shrink-0" />
                    <span>{isAdminPortal ? 'Login to Admin Portal' : 'Login to Employee Portal'}</span>
                  </>
                )}
              </button>
            </form>

            {/* Security Footer */}
            <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <span className="text-slate-500">
                Authorized Personnel Only
              </span>

              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                Secure Portal
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Elegant Flowing Blue Waves at Bottom */}
      <div className="w-full relative z-0 overflow-hidden leading-none select-none pointer-events-none">
        <svg
          viewBox="0 0 1440 180"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-24 sm:h-32 md:h-40 lg:h-44 object-cover"
          preserveAspectRatio="none"
        >
          {/* Top subtle light azure wave */}
          <path
            d="M0,70 C320,130 520,30 840,80 C1120,120 1320,50 1440,70 L1440,180 L0,180 Z"
            fill="#7BB4F7"
            fillOpacity="0.45"
          />
          {/* Mid vibrant royal blue wave */}
          <path
            d="M0,100 C280,40 560,140 900,90 C1180,50 1340,110 1440,95 L1440,180 L0,180 Z"
            fill="#1D6ECC"
            fillOpacity="0.85"
          />
          {/* Bottom deep navy base wave matching reference */}
          <path
            d="M0,130 C300,85 580,165 920,125 C1200,95 1360,140 1440,130 L1440,180 L0,180 Z"
            fill="#082A60"
          />
        </svg>
      </div>
    </div>
    </>
  );
};

export const LoginPage: React.FC = () => <AuthPortal portalVariant="EMPLOYEE" />;
export const AdminLoginPage: React.FC = () => <AuthPortal portalVariant="ADMIN" />;
