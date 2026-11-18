import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  LocateFixed,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { isFieldExceptionEligible, type JobCategory } from '../../types/role';
import type { AttendanceEventType } from '../../types/hrms';
import { calculateHaversineDistanceMeters, HRMS_POLICY } from '../../lib/domainRules';
import { useAuth } from '../../context/AuthContext';
import { apiRequest } from '../../lib/apiClient';
import {
  captureScaledVideoFrame,
  extractObservationFromLandmarks,
  getBrowserFaceLandmarker,
  isChallengeObserved,
  type FrameLivenessObservation,
  type LivenessChallengeAction,
} from '../../lib/livenessCapture';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { StatusBanner } from '../ui/StatusBanner';
import { GeofenceBoundaryMap } from './GeofenceBoundaryMap';

export interface OfficeGeofenceConfig {
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

interface SmartAttendanceModalProps {
  open: boolean;
  onClose: () => void;
  employee: {
    id: string;
    fullName: string;
    employeeCode?: string;
    department?: string;
    jobCategory: JobCategory;
  };
  officeGeofence?: OfficeGeofenceConfig | null;
  mode: 'CHECK_IN' | 'CHECK_OUT';
  onSubmitted?: () => void;
}

const FIELD_COMMENT_TEMPLATES = [
  'I am here.',
  'I am visiting a customer.',
  'I am working in the field.',
];

export const SmartAttendanceModal: React.FC<SmartAttendanceModalProps> = ({
  open,
  onClose,
  employee,
  officeGeofence,
  mode,
  onSubmitted,
}) => {
  const { getInMemoryAccessToken } = useAuth();
  const fieldExceptionAllowed = isFieldExceptionEligible(employee.jobCategory);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureCancelRef = useRef(false);

  const [cameraStatus, setCameraStatus] = useState<
    'IDLE' | 'ACTIVE' | 'DENIED' | 'UNSUPPORTED' | 'INTERRUPTED'
  >('IDLE');
  const [gpsStatus, setGpsStatus] = useState<'IDLE' | 'ACQUIRING' | 'READY' | 'DENIED' | 'UNSUPPORTED'>('IDLE');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [gpsAccuracyMeters, setGpsAccuracyMeters] = useState<number | null>(null);
  const [capturedSelfieDataUrl, setCapturedSelfieDataUrl] = useState<string | null>(null);
  const [livenessFrames, setLivenessFrames] = useState<string[]>([]);
  const [livenessChallengeToken, setLivenessChallengeToken] = useState<string | null>(null);
  const [livenessAction, setLivenessAction] = useState<LivenessChallengeAction | null>(null);
  const [livenessPrompt, setLivenessPrompt] = useState<string | null>(null);
  const [livenessCapturing, setLivenessCapturing] = useState(false);
  const [livenessProgressText, setLivenessProgressText] = useState<string | null>(null);
  const [eventType, setEventType] = useState<Exclude<AttendanceEventType, 'MANAGER_OVERRIDE'>>('FACE_EMPLOYEE_APP');
  const [employeeComment, setEmployeeComment] = useState<string>('');
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [unavailableMessage, setUnavailableMessage] = useState<string | null>(null);
  const [submissionResult, setSubmissionResult] = useState<{
    status: string;
    verificationState?: string;
    locationState?: string;
    faceMatchStatus?: string;
    livenessStatus?: string;
    livenessProvider?: string;
    livenessScore?: number | null;
    challengeAction?: string | null;
    challengePassed?: boolean;
    spoofingSuspected?: boolean;
    failureReason?: string | null;
    distanceMeters?: number;
    gpsAccuracyMeters?: number;
    message: string;
  } | null>(null);

  const hasCoordinates = latitude !== null && longitude !== null;
  const hasGeofence = Boolean(officeGeofence);
  const distanceFromHq =
    hasCoordinates && officeGeofence
      ? calculateHaversineDistanceMeters(
          latitude,
          longitude,
          officeGeofence.latitude,
          officeGeofence.longitude
        )
      : undefined;

  const effectiveRadius =
    officeGeofence?.radiusMeters ?? HRMS_POLICY.OFFICE_GEOFENCE_RADIUS_METERS;
  const insideGeofence =
    distanceFromHq !== undefined ? distanceFromHq <= effectiveRadius : false;
  const poorGpsAccuracy =
    gpsAccuracyMeters !== null && gpsAccuracyMeters > HRMS_POLICY.MAX_GPS_ACCURACY_METERS;

  const stopCamera = () => {
    captureCancelRef.current = true;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const resetCapturedLiveness = () => {
    captureCancelRef.current = true;
    setLivenessCapturing(false);
    setCapturedSelfieDataUrl(null);
    setLivenessFrames([]);
    setLivenessChallengeToken(null);
    setLivenessAction(null);
    setLivenessPrompt(null);
    setLivenessProgressText(null);
  };

  useEffect(() => {
    if (
      cameraStatus === 'ACTIVE' &&
      !capturedSelfieDataUrl &&
      videoRef.current &&
      streamRef.current &&
      videoRef.current.srcObject !== streamRef.current
    ) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play().catch(() => {});
    }
  }, [cameraStatus, capturedSelfieDataUrl]);

  useEffect(() => {
    if (!open) {
      stopCamera();
      return;
    }
    setSubmissionError(null);
    setUnavailableMessage(null);
    setSubmissionResult(null);
    resetCapturedLiveness();
    setCameraStatus('IDLE');
    setGpsStatus('IDLE');
    setLatitude(null);
    setLongitude(null);
    setGpsAccuracyMeters(null);
    setEventType('FACE_EMPLOYEE_APP');
    setEmployeeComment('');
    setIdempotencyKey(
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `att-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    );
    return () => {
      stopCamera();
    };
  }, [open]);

  const startLiveSensors = async () => {
    setSubmissionError(null);
    setUnavailableMessage(null);

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      setGpsStatus('ACQUIRING');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLatitude(pos.coords.latitude);
          setLongitude(pos.coords.longitude);
          setGpsAccuracyMeters(Math.round(pos.coords.accuracy));
          setGpsStatus('READY');
        },
        () => {
          setGpsStatus('DENIED');
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    } else {
      setGpsStatus('UNSUPPORTED');
    }

    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        stopCamera();
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.addEventListener('ended', () => {
            captureCancelRef.current = true;
            setLivenessCapturing(false);
            streamRef.current = null;
            setCameraStatus('INTERRUPTED');
            setSubmissionError('Camera stream interrupted. Re-enable camera access before capturing.');
          });
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }
        setCameraStatus('ACTIVE');
      } catch {
        setCameraStatus('DENIED');
      }
    } else {
      setCameraStatus('UNSUPPORTED');
    }
  };

  const handleCaptureSelfie = async () => {
    setSubmissionError(null);
    if (!videoRef.current || cameraStatus !== 'ACTIVE' || !streamRef.current) {
      setSubmissionError('Activate camera permission before capturing a live selfie frame.');
      return;
    }
    const video = videoRef.current;
    const activeTrack = streamRef.current.getVideoTracks()[0];
    if (!activeTrack || activeTrack.readyState !== 'live' || !streamRef.current.active) {
      setCameraStatus('INTERRUPTED');
      setSubmissionError('Camera stream was interrupted. Re-enable your camera and try again.');
      return;
    }
    if (!video.videoWidth || !video.videoHeight || video.readyState < 2) {
      setSubmissionError('Camera video feed is still initializing. Wait a moment and capture again.');
      return;
    }

    const canvas = document.createElement('canvas');

    if (eventType === 'PIN_FALLBACK') {
      const single = captureScaledVideoFrame(video, canvas, 640, 0.85);
      if (!single) {
        setSubmissionError('Unable to initialize canvas frame capture.');
        return;
      }
      setLivenessFrames([]);
      setLivenessChallengeToken(null);
      setLivenessAction(null);
      setCapturedSelfieDataUrl(single);
      return;
    }

    setLivenessCapturing(true);
    captureCancelRef.current = false;
    setLivenessProgressText('Requesting single-use server liveness challenge...');

    const challengeRes = await apiRequest<{
      challengeToken: string;
      action: LivenessChallengeAction;
      prompt: string;
      expiresAt: string;
    }>('/api/v1/employee/attendance/liveness-challenge', getInMemoryAccessToken(), {
      method: 'POST',
      body: { direction: mode },
    });

    if (captureCancelRef.current) {
      setLivenessCapturing(false);
      return;
    }

    if (challengeRes.status !== 'OK') {
      setLivenessCapturing(false);
      setLivenessProgressText(null);
      setSubmissionError(challengeRes.message || 'Unable to obtain server liveness challenge.');
      return;
    }

    const { challengeToken, action, prompt } = challengeRes.data;
    setLivenessAction(action);
    setLivenessPrompt(prompt);

    const landmarkerPromise = Promise.race([
      getBrowserFaceLandmarker(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
    ]);
    const landmarker = await landmarkerPromise;

    const frames: string[] = [];
    const observations: FrameLivenessObservation[] = [];
    const totalTargetFrames = 6;

    for (let idx = 0; idx < totalTargetFrames; idx += 1) {
      if (captureCancelRef.current) {
        setLivenessCapturing(false);
        setLivenessProgressText(null);
        return;
      }

      const trackNow = streamRef.current?.getVideoTracks()[0];
      if (!streamRef.current?.active || !trackNow || trackNow.readyState !== 'live') {
        setLivenessCapturing(false);
        setLivenessProgressText(null);
        setCameraStatus('INTERRUPTED');
        setSubmissionError('Camera stream interrupted during liveness capture. Please retry.');
        return;
      }

      setLivenessProgressText(`Challenge (${action.replace('_', ' ')}): capturing frame ${idx + 1}/${totalTargetFrames}...`);
      const frameUrl = captureScaledVideoFrame(video, canvas, 480, 0.78);
      if (frameUrl) {
        frames.push(frameUrl);
        if (landmarker) {
          try {
            const lm = landmarker.detect(canvas);
            const obs = extractObservationFromLandmarks(lm.faceLandmarks, lm.faceBlendshapes);
            observations.push(obs);
          } catch {
            // Fall back silently to server-side landmark & ONNX analysis
          }
        }
      }

      if (frames.length >= 4 && observations.length >= 4 && isChallengeObserved(action, observations)) {
        break;
      }

      if (idx < totalTargetFrames - 1) {
        await new Promise((resolve) => setTimeout(resolve, 260));
      }
    }

    setLivenessCapturing(false);
    setLivenessProgressText(null);

    if (frames.length < 2) {
      setSubmissionError('Could not capture enough live camera frames. Keep camera uncovered and retry.');
      return;
    }

    setLivenessFrames(frames);
    setLivenessChallengeToken(challengeToken);
    setCapturedSelfieDataUrl(frames[0]!);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmissionError(null);
    setUnavailableMessage(null);

    if (!capturedSelfieDataUrl) {
      setSubmissionError(
        'Capture a live selfie frame first so the backend biometric service can verify 1:1 identity.'
      );
      return;
    }

    if (!hasCoordinates || gpsAccuracyMeters === null) {
      setSubmissionError('Acquire valid device GPS coordinates before submitting attendance.');
      return;
    }

    if (poorGpsAccuracy) {
      setSubmissionError(
        `GPS accuracy (${gpsAccuracyMeters}m) exceeds ${HRMS_POLICY.MAX_GPS_ACCURACY_METERS}m maximum threshold. Move outdoors and reacquire GPS.`
      );
      return;
    }

    if (mode === 'CHECK_IN' && hasGeofence && !insideGeofence) {
      if (!fieldExceptionAllowed) {
        setSubmissionError(
          `Outside ${effectiveRadius}m office geofence (${distanceFromHq}m from HQ). Office, HR, and Finance employees cannot submit remote check-ins.`
        );
        return;
      }
      if (employeeComment.trim().length < 5) {
        setSubmissionError(
          'Outside-office exception check-in for Sales/Recovery requires a detailed explanation (min 5 characters).'
        );
        return;
      }
    }

    const endpoint =
      mode === 'CHECK_IN'
        ? '/api/v1/employee/attendance/check-in'
        : '/api/v1/employee/attendance/check-out';

    setSubmitting(true);
    const result = await apiRequest<{
      status: string;
      verificationState?: string;
      locationState?: string;
      faceMatchStatus?: string;
      livenessStatus?: string;
      livenessProvider?: string;
      livenessScore?: number | null;
      challengeAction?: string | null;
      challengePassed?: boolean;
      spoofingSuspected?: boolean;
      failureReason?: string | null;
      distanceMeters?: number;
      gpsAccuracyMeters?: number;
      message?: string;
    }>(
      endpoint,
      getInMemoryAccessToken(),
      {
        method: 'POST',
        idempotencyKey: idempotencyKey || undefined,
        body: {
          eventType,
          latitude,
          longitude,
          gpsAccuracyMeters,
          selfieImageDataUrl: capturedSelfieDataUrl,
          livenessFrames: eventType === 'PIN_FALLBACK' ? undefined : livenessFrames,
          livenessChallengeToken:
            eventType === 'PIN_FALLBACK' ? undefined : livenessChallengeToken ?? undefined,
          comment: employeeComment.trim() || undefined,
        },
      }
    );
    setSubmitting(false);

    if (result.status === 'UNAVAILABLE') {
      setUnavailableMessage(
        result.message ||
          'Attendance check-in/check-out and biometric verification APIs are not yet implemented on the backend.'
      );
      return;
    }

    if (result.status !== 'OK') {
      setSubmissionError(result.message);
      return;
    }

    setSubmissionResult({
      status: result.data.status,
      verificationState: result.data.verificationState,
      locationState: result.data.locationState,
      faceMatchStatus: result.data.faceMatchStatus,
      livenessStatus: result.data.livenessStatus,
      livenessProvider: result.data.livenessProvider,
      livenessScore: result.data.livenessScore,
      challengeAction: result.data.challengeAction,
      challengePassed: result.data.challengePassed,
      spoofingSuspected: result.data.spoofingSuspected,
      failureReason: result.data.failureReason,
      distanceMeters: result.data.distanceMeters,
      gpsAccuracyMeters: result.data.gpsAccuracyMeters,
      message: result.data.message || `${mode === 'CHECK_IN' ? 'Check-in' : 'Check-out'} recorded.`,
    });
    stopCamera();
    onSubmitted?.();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === 'CHECK_IN' ? 'Smart Attendance Check-In' : 'Smart Attendance Check-Out'}
      description={`${employee.fullName}${employee.employeeCode ? ` (${employee.employeeCode})` : ''} • ${employee.jobCategory} • DEC-02 single daily session`}
      maxWidthClass="max-w-4xl"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {submissionResult ? (
          <div className="space-y-4">
            <StatusBanner
              tone={submissionResult.status === 'APPROVED' ? 'success' : 'pending'}
              title={
                submissionResult.status === 'APPROVED'
                  ? 'Attendance Confirmed'
                  : 'Attendance Submission Received — Awaiting Admin Verification'
              }
              description={submissionResult.message}
            />

            <div className="rounded-xl border border-border bg-muted/20 p-3.5 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Approval Status
                </p>
                <Badge
                  className="mt-1"
                  variant={submissionResult.status === 'APPROVED' ? 'success' : 'warning'}
                >
                  {submissionResult.status}
                </Badge>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Face Recognition
                </p>
                <Badge
                  className="mt-1"
                  variant={
                    submissionResult.faceMatchStatus === 'VERIFIED'
                      ? 'success'
                      : submissionResult.faceMatchStatus === 'MISMATCH' ||
                          submissionResult.faceMatchStatus === 'FACE_NOT_DETECTED' ||
                          submissionResult.faceMatchStatus === 'MULTIPLE_FACES_DETECTED' ||
                          submissionResult.faceMatchStatus === 'POOR_IMAGE_QUALITY' ||
                          submissionResult.faceMatchStatus === 'SPOOFING_SUSPECTED' ||
                          submissionResult.faceMatchStatus === 'FAILED'
                        ? 'destructive'
                        : 'warning'
                  }
                >
                  {submissionResult.faceMatchStatus ?? 'PENDING'}
                </Badge>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Liveness Check
                </p>
                <Badge
                  className="mt-1"
                  variant={
                    submissionResult.livenessStatus === 'LIVE'
                      ? 'success'
                      : submissionResult.livenessStatus === 'FAILED'
                        ? 'destructive'
                        : 'warning'
                  }
                >
                  {submissionResult.livenessStatus ?? 'UNAVAILABLE'}
                </Badge>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Geofence
                </p>
                <Badge
                  className="mt-1"
                  variant={
                    submissionResult.locationState === 'INSIDE_GEOFENCE' ? 'success' : 'warning'
                  }
                >
                  {submissionResult.locationState ?? submissionResult.verificationState ?? '--'}
                </Badge>
              </div>
            </div>

            {submissionResult.status === 'VERIFICATION_PENDING' &&
              submissionResult.livenessStatus !== 'LIVE' && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  Identity match alone does not auto-approve attendance while liveness detection is{' '}
                  <strong>{submissionResult.livenessStatus ?? 'UNAVAILABLE'}</strong>. Your attempt is
                  safely held as <strong>VERIFICATION_PENDING</strong> for Admin review.
                  {submissionResult.failureReason ? ` Detail: ${submissionResult.failureReason}` : ''}
                </p>
              )}

            <div className="flex justify-end">
              <Button type="button" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <>
            {submissionError && (
              <StatusBanner tone="error" title="Validation Blocked" description={submissionError} />
            )}
            {unavailableMessage && (
              <StatusBanner
                tone="unavailable"
                title="Biometric &amp; Attendance Backend Pending"
                description={unavailableMessage}
              />
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Step 1: Real Camera & Selfie Capture */}
              <div className="rounded-2xl border border-border p-4 space-y-3 bg-muted/20">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold flex items-center gap-1.5">
                    <Camera className="w-4 h-4 text-primary" />
                    Step 1 — Live Camera Capture
                  </span>
                  <Badge variant={capturedSelfieDataUrl ? 'success' : 'outline'}>
                    {capturedSelfieDataUrl ? 'Frame Captured' : cameraStatus}
                  </Badge>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold block">Punch Event Mode</label>
                  <select
                    value={eventType}
                    onChange={(e) =>
                      setEventType(
                        e.target.value as Exclude<AttendanceEventType, 'MANAGER_OVERRIDE'>
                      )
                    }
                    className="w-full h-8 px-2.5 rounded-lg border border-input bg-card text-xs"
                  >
                    <option value="FACE_EMPLOYEE_APP">FACE_EMPLOYEE_APP — Live Selfie App Punch</option>
                    <option value="FACE_BUTTON">FACE_BUTTON — Desk / Kiosk Button</option>
                    <option value="FACE_AUTO">FACE_AUTO — Automated Face Detection</option>
                    <option value="PIN_FALLBACK">PIN_FALLBACK — Assisted Selfie + Review</option>
                  </select>
                </div>

                <div className="relative rounded-xl bg-slate-950 aspect-video overflow-hidden flex items-center justify-center border border-slate-800">
                  {capturedSelfieDataUrl ? (
                    <img
                      src={capturedSelfieDataUrl}
                      alt="Captured attendance selfie frame"
                      className="w-full h-full object-cover"
                    />
                  ) : cameraStatus === 'ACTIVE' ? (
                    <video
                      ref={videoRef}
                      autoPlay
                      muted
                      playsInline
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-center px-4 py-6 text-slate-300 space-y-1.5">
                      <ShieldCheck className="w-8 h-8 text-indigo-400 mx-auto" />
                      <p className="text-xs font-semibold">
                        {cameraStatus === 'DENIED'
                          ? 'Camera permission denied'
                          : cameraStatus === 'INTERRUPTED'
                            ? 'Camera stream interrupted'
                            : cameraStatus === 'UNSUPPORTED'
                              ? 'Camera API unavailable in this browser'
                              : 'Camera standby — activate device sensors below'}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Active liveness challenge + passive anti-spoofing + 1:1 matching run server-side (max{' '}
                        {HRMS_POLICY.MAX_FACE_ATTEMPTS} attempts).
                      </p>
                    </div>
                  )}
                  {livenessPrompt && cameraStatus === 'ACTIVE' && !capturedSelfieDataUrl && (
                    <div className="absolute inset-x-2 bottom-2 rounded-lg bg-slate-950/85 border border-indigo-400/50 px-3 py-2 text-white text-center shadow-lg">
                      <p className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider">
                        Active Liveness Challenge ({livenessAction?.replace('_', ' ')})
                      </p>
                      <p className="text-xs font-medium mt-0.5">{livenessPrompt}</p>
                      {livenessProgressText && (
                        <p className="text-[10px] text-slate-300 mt-1">{livenessProgressText}</p>
                      )}
                    </div>
                  )}
                </div>

                {capturedSelfieDataUrl && livenessFrames.length > 1 && (
                  <p className="text-[11px] text-emerald-700 font-medium">
                    Captured {livenessFrames.length}-frame active challenge sequence ({livenessAction}) for anti-spoofing verification.
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={startLiveSensors}
                    disabled={livenessCapturing}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Enable Camera &amp; GPS
                  </Button>
                  {cameraStatus === 'ACTIVE' && !capturedSelfieDataUrl && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      loading={livenessCapturing}
                      onClick={() => void handleCaptureSelfie()}
                    >
                      <Camera className="w-3.5 h-3.5" />
                      {eventType === 'PIN_FALLBACK' ? 'Capture Frame' : 'Run Liveness & Capture'}
                    </Button>
                  )}
                  {capturedSelfieDataUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={resetCapturedLiveness}
                    >
                      Retake Selfie
                    </Button>
                  )}
                </div>
              </div>

              {/* Step 2: Real GPS & 50m Geofence */}
              <div className="rounded-2xl border border-border p-4 space-y-3 bg-muted/20">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold flex items-center gap-1.5">
                    <LocateFixed className="w-4 h-4 text-emerald-600" />
                    Step 2 — Device GPS &amp; {effectiveRadius}m Geofence
                  </span>
                  <Badge
                    variant={
                      gpsStatus === 'READY' && hasGeofence && insideGeofence && !poorGpsAccuracy
                        ? 'success'
                        : gpsStatus === 'DENIED' || poorGpsAccuracy
                          ? 'destructive'
                          : 'outline'
                    }
                  >
                    {gpsStatus === 'READY'
                      ? distanceFromHq !== undefined
                        ? insideGeofence
                          ? `Inside HQ (${distanceFromHq}m)`
                          : `Outside HQ (${distanceFromHq}m)`
                        : 'GPS Ready'
                      : gpsStatus}
                  </Badge>
                </div>

                <GeofenceBoundaryMap
                  officeName={officeGeofence?.name ?? 'Headquarters Office'}
                  officeLatitude={officeGeofence?.latitude ?? null}
                  officeLongitude={officeGeofence?.longitude ?? null}
                  radiusMeters={effectiveRadius}
                  employeeDistanceMeters={distanceFromHq}
                  gpsAccuracyMeters={gpsAccuracyMeters ?? undefined}
                  employeeLabel={
                    hasCoordinates
                      ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
                      : 'Waiting for browser GPS'
                  }
                  unconfigured={!hasGeofence}
                />

                {gpsStatus === 'DENIED' && (
                  <StatusBanner
                    tone="error"
                    title="Location Permission Required"
                    description="Allow location access in browser settings so GPS coordinates and accuracy can be verified against the 50m office geofence."
                  />
                )}

                {poorGpsAccuracy && (
                  <StatusBanner
                    tone="error"
                    title="GPS Accuracy Too Weak"
                    description={`Measured GPS error radius is ${gpsAccuracyMeters}m (exceeds ${HRMS_POLICY.MAX_GPS_ACCURACY_METERS}m max). Wait for high-accuracy fix.`}
                  />
                )}
              </div>
            </div>

            {mode === 'CHECK_IN' && hasGeofence && hasCoordinates && !insideGeofence && (
              <div className="rounded-2xl border border-border p-4 space-y-3">
                {!fieldExceptionAllowed ? (
                  <div className="flex items-start gap-2.5 text-rose-700 text-xs">
                    <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">Outside Office Geofence — Blocked</p>
                      <p className="mt-0.5 text-rose-600">
                        Only authorized Sales Representatives and Recovery Agents may submit outside-office exception check-ins with mandatory Admin approval.
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start gap-2 text-amber-800">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-bold">
                          Outside-Office Exception Check-In ({distanceFromHq}m from HQ)
                        </p>
                        <p className="text-[11px] text-amber-700">
                          Submission routes to Admin Review (PENDING_ADMIN_REVIEW). Separate Field Duty starts independently after Check-In.
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {FIELD_COMMENT_TEMPLATES.map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => setEmployeeComment(chip)}
                          className="text-[11px] px-2.5 py-1 rounded-full bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100 transition-colors"
                        >
                          <MessageSquareText className="w-3 h-3 inline mr-1" />
                          {chip}
                        </button>
                      ))}
                    </div>

                    <div>
                      <label htmlFor="attendance-exception-comment" className="text-xs font-semibold block mb-1">
                        Mandatory Outside-Office Reason (min 5 characters)
                      </label>
                      <textarea
                        id="attendance-exception-comment"
                        rows={2}
                        value={employeeComment}
                        onChange={(e) => setEmployeeComment(e.target.value)}
                        placeholder="Explain field/customer location and reason for checking in outside the 50m HQ perimeter..."
                        className="w-full rounded-xl border border-input px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
              <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button
                type="submit"
                loading={submitting}
                disabled={
                  !capturedSelfieDataUrl ||
                  !hasCoordinates ||
                  poorGpsAccuracy ||
                  (mode === 'CHECK_IN' && hasGeofence && !insideGeofence && !fieldExceptionAllowed)
                }
              >
                <CheckCircle2 className="w-4 h-4" />
                {mode === 'CHECK_IN' ? 'Submit Check-In' : 'Submit Check-Out'}
              </Button>
            </div>
          </>
        )}
      </form>
    </Dialog>
  );
};
