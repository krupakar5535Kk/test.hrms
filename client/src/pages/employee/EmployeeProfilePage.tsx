import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Phone,
  RefreshCw,
  ScanFace,
  ShieldCheck,
  User,
  Briefcase,
} from 'lucide-react';
import type { EmployeeProfile } from '../../types/hrms';
import { formatJobCategoryLabel } from '../../types/role';
import { useAuth } from '../../context/AuthContext';
import { useApiResource } from '../../hooks/useApiResource';
import { apiRequest } from '../../lib/apiClient';
import { StatusBanner } from '../../components/ui/StatusBanner';

interface ProfileWithBiometrics extends EmployeeProfile {
  biometricEnrollment?: {
    status: string;
    providerName: string;
    consentGiven: boolean;
    consentRecordedAt: string | null;
    rejectionReason: string | null;
    signedPreviewUrl: string | null;
  } | null;
}

export const EmployeeProfilePage: React.FC = () => {
  const { user, getInMemoryAccessToken } = useAuth();
  const { state, data, reload } = useApiResource<{ profile: ProfileWithBiometrics | null }>(
    '/api/v1/employee/profile',
    { profile: null }
  );

  const profile = data.profile;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedImageUrl, setCapturedImageUrl] = useState<string | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [enrollSuccess, setEnrollSuccess] = useState<string | null>(null);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    if (cameraActive && !capturedImageUrl && videoRef.current && streamRef.current) {
      if (videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
        void videoRef.current.play().catch(() => {});
      }
    }
  }, [cameraActive, capturedImageUrl]);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  const handleStartCamera = async () => {
    setCameraError(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('Live camera API is unavailable in this browser context.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraActive(true);
    } catch {
      setCameraError('Camera permission denied or no front camera detected.');
    }
  };

  const handleCaptureFrame = () => {
    if (!videoRef.current || !cameraActive) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 480;
    canvas.height = video.videoHeight || 360;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setCapturedImageUrl(canvas.toDataURL('image/jpeg', 0.85));
    stopCamera();
  };

  const handleSubmitEnrollment = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnrollError(null);
    setEnrollSuccess(null);

    if (!consentChecked) {
      setEnrollError('You must check the explicit biometric consent box before enrolling your reference selfie.');
      return;
    }
    if (!capturedImageUrl) {
      setEnrollError('Capture a live selfie frame using the camera before submitting enrollment.');
      return;
    }

    setEnrolling(true);
    const res = await apiRequest<{ status?: string; message?: string }>(
      '/api/v1/employee/biometrics/enroll',
      getInMemoryAccessToken(),
      {
        method: 'POST',
        body: {
          imageDataUrl: capturedImageUrl,
          consentGiven: true,
          consentVersion: 'v1.0',
        },
      }
    );
    setEnrolling(false);

    if (res.status !== 'OK') {
      setEnrollError(res.message);
      return;
    }

    setCapturedImageUrl(null);
    setConsentChecked(false);
    setEnrollSuccess(res.data.message || 'Reference face selfie submitted for Admin review.');
    reload();
  };

  const enrollmentStatus =
    profile?.biometricEnrollment?.status ?? profile?.faceEnrollmentStatus ?? 'NOT_ENROLLED';

  const userInitials = (profile?.fullName ?? user?.fullName ?? 'AV')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase())
    .slice(0, 2)
    .join('') || 'AV';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200/60">
              EMPLOYEE PORTAL
            </span>
            <span className="text-xs text-slate-400">•</span>
            <span className="text-xs text-slate-500 font-medium">PO-01: Identity &amp; Privacy</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 mt-1.5">
            My Profile &amp; Biometrics
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Registered corporate identity, job classification, and reference face biometric enrollment.
          </p>
        </div>
      </div>

      {state.status === 'unavailable' && (
        <StatusBanner tone="unavailable" title="Extended Profile Endpoint Pending" description={state.message} />
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Employee Code */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-50/80 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
              <User className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Employee Code</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight font-mono">
              {profile?.employeeCode ?? user?.employeeCode ?? 'EMP001'}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">Primary corporate identifier</p>
        </div>

        {/* KPI 2: Job Category */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 shrink-0">
              <Briefcase className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Job Category</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight">
              {formatJobCategoryLabel(profile?.jobCategory ?? user?.jobCategory ?? 'OFFICE')}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">Official role classification</p>
        </div>

        {/* KPI 3: Mobile Identity */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-50/80 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
              <Phone className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Mobile Identity</span>
          </div>
          <div className="my-2.5">
            <p className="text-2xl font-bold text-slate-900 tracking-tight font-mono">
              {profile?.phoneNumber ?? user?.phoneNumber ?? '+917842427275'}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">Primary auth credential</p>
        </div>

        {/* KPI 4: Biometric Status */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-50/80 border border-amber-100 flex items-center justify-center text-amber-600 shrink-0">
              <ScanFace className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-slate-800">Biometric Status</span>
          </div>
          <div className="my-2.5">
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${
                enrollmentStatus === 'APPROVED'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : enrollmentStatus === 'PENDING_VERIFICATION'
                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                    : 'bg-rose-50 text-rose-700 border border-rose-200'
              }`}
            >
              {enrollmentStatus}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 font-medium">
            {enrollmentStatus === 'APPROVED' ? 'Active for 1:1 match' : 'Enrollment required'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Employee Particulars Card */}
        <div className="lg:col-span-6 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-5">
            {/* User Identity Top Bar */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white font-bold flex items-center justify-center text-base shrink-0 shadow-xs">
                  {userInitials}
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900 leading-tight">
                    {profile?.fullName ?? user?.fullName ?? 'Alugu varun'}
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">Organization Employee Profile</p>
                </div>
              </div>
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                ROLE: EMPLOYEE
              </span>
            </div>

            {/* Profile Fields Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80 space-y-1">
                <p className="text-[11px] font-medium text-slate-400">Legal Full Name</p>
                <p className="font-bold text-slate-900 text-sm">
                  {profile?.fullName ?? user?.fullName ?? 'Alugu varun'}
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80 space-y-1">
                <p className="text-[11px] font-medium text-slate-400">Employee Code</p>
                <p className="font-mono font-bold text-slate-900 text-sm">
                  {profile?.employeeCode ?? user?.employeeCode ?? 'EMP001'}
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80 space-y-1">
                <p className="text-[11px] font-medium text-slate-400">Registered Mobile (PO-02)</p>
                <p className="font-mono font-bold text-slate-900 text-sm flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-blue-600" />
                  {profile?.phoneNumber ?? user?.phoneNumber ?? '+917842427275'}
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80 space-y-1">
                <p className="text-[11px] font-medium text-slate-400">Job Classification</p>
                <p className="font-bold text-slate-900 text-sm">
                  {formatJobCategoryLabel(profile?.jobCategory ?? user?.jobCategory ?? 'OFFICE')}
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80 space-y-1">
                <p className="text-[11px] font-medium text-slate-400">Department</p>
                <p className="font-bold text-slate-900 text-sm">
                  {profile?.department ?? 'Employe'}
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80 space-y-1">
                <p className="text-[11px] font-medium text-slate-400">Designation</p>
                <p className="font-bold text-slate-900 text-sm">
                  {profile?.designation ?? 'software developer'}
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80 space-y-1">
                <p className="text-[11px] font-medium text-slate-400">Joining Date</p>
                <p className="font-mono font-bold text-slate-900 text-sm">
                  {profile?.joiningDate ?? '2026-11-14'}
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80 space-y-1">
                <p className="text-[11px] font-medium text-slate-400">Emergency Contact</p>
                <p className="font-bold text-slate-900 text-sm">Registered</p>
              </div>
            </div>
          </div>

          {/* Privacy & Role Security Notice Banner */}
          <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 text-xs text-slate-700 shadow-xs flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold text-slate-900">
                Strict 2-Role Privacy (PO-01 &amp; PO-02)
              </p>
              <p className="leading-relaxed text-slate-600 text-xs">
                Identity authentication is enforced exclusively to organization code and verified mobile credential.
              </p>
            </div>
          </div>
        </div>

        {/* Right Column: Reference Face Biometric Enrollment Card */}
        <div className="lg:col-span-6 bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                <ScanFace className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Reference Face Biometrics</h2>
                <p className="text-xs text-slate-500">
                  Live camera reference selfie for 1:1 attendance verification.
                </p>
              </div>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                enrollmentStatus === 'APPROVED'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-rose-50 text-rose-700 border border-rose-200'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${enrollmentStatus === 'APPROVED' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
              {enrollmentStatus}
            </span>
          </div>

          {cameraError && <StatusBanner tone="error" title="Camera Notice" description={cameraError} />}
          {enrollError && <StatusBanner tone="error" title="Enrollment Error" description={enrollError} />}
          {enrollSuccess && <StatusBanner tone="success" title="Enrollment Received" description={enrollSuccess} />}

          {/* Dark Camera Viewfinder Container */}
          <div className="relative rounded-2xl bg-[#091528] border border-slate-800 p-6 flex flex-col items-center justify-center min-h-[260px] text-center text-white overflow-hidden shadow-inner">
            {!cameraActive && !capturedImageUrl && (
              <div className="space-y-3 max-w-sm">
                <div className="w-16 h-16 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center mx-auto text-blue-400">
                  <Camera className="w-8 h-8" />
                </div>
                <h4 className="font-bold text-sm text-white">Live Camera Standby</h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Start your front camera to capture a live reference photo. Gallery and file uploads are disallowed to prevent attendance spoofing.
                </p>
                <button
                  type="button"
                  onClick={() => void handleStartCamera()}
                  className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs px-4 py-2.5 rounded-xl shadow-xs transition-colors cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  Start Front Camera
                </button>
              </div>
            )}

            {cameraActive && !capturedImageUrl && (
              <div className="space-y-3 w-full flex flex-col items-center">
                <div className="relative rounded-xl overflow-hidden border border-slate-700 max-w-xs w-full aspect-4/3 bg-black">
                  <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                  <div className="absolute inset-0 border-2 border-dashed border-emerald-400/60 rounded-xl pointer-events-none" />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCaptureFrame}
                    className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs px-4 py-2 rounded-xl shadow-xs transition-colors cursor-pointer"
                  >
                    <Camera className="w-4 h-4" />
                    Capture Photo Frame
                  </button>
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="inline-flex items-center px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {capturedImageUrl && (
              <div className="space-y-3 w-full flex flex-col items-center">
                <div className="relative rounded-xl overflow-hidden border-2 border-emerald-500 max-w-xs w-full aspect-4/3 bg-black">
                  <img src={capturedImageUrl} alt="Captured reference selfie" className="w-full h-full object-cover" />
                  <div className="absolute top-2 right-2 bg-emerald-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                    Captured
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCapturedImageUrl(null);
                    void handleStartCamera();
                  }}
                  className="inline-flex items-center gap-1.5 text-xs text-slate-300 hover:text-white bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700 transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Retake Photo
                </button>
              </div>
            )}
          </div>

          {/* Explicit Biometric Consent Checkbox */}
          <form onSubmit={handleSubmitEnrollment} className="space-y-4 pt-2">
            <label className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer text-xs">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-slate-600 leading-relaxed">
                <strong className="text-slate-900 block font-semibold mb-0.5">
                  Explicit Biometric Consent (v1.0)
                </strong>
                I consent to saving this reference facial image encrypted exclusively for 1:1 daily attendance verification.
              </span>
            </label>

            <button
              type="submit"
              disabled={enrolling || !capturedImageUrl || !consentChecked}
              className="w-full h-11 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs sm:text-sm rounded-xl shadow-xs transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              <ScanFace className="w-4 h-4" />
              {enrolling ? 'Submitting Enrollment...' : 'Submit Face Enrollment for Admin Review'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
