import React, { useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  LocateFixed,
  MapPin,
  Navigation,
  Play,
  PlusCircle,
  ShieldAlert,
  Square,
  Compass,
  Building2,
  Activity,
} from 'lucide-react';
import type { CustomerVisitRecord, FieldDutySessionRecord } from '../../types/hrms';
import { useAuth } from '../../context/AuthContext';
import { useApiResource } from '../../hooks/useApiResource';
import { apiRequest } from '../../lib/apiClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { MetricCard } from '../../components/ui/MetricCard';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';

interface EmployeeFieldDutyPayload {
  activeSession: FieldDutySessionRecord | null;
  sessions: FieldDutySessionRecord[];
  visits: CustomerVisitRecord[];
}

const VISIT_PURPOSES = [
  'SALES_PITCH',
  'FOLLOW_UP',
  'COLLECTION',
  'RECOVERY',
  'SUPPORT',
  'OTHER',
] as const;

export const EmployeeFieldDutyPage: React.FC = () => {
  const { user, getInMemoryAccessToken } = useAuth();
  const { state, data, reload } = useApiResource<EmployeeFieldDutyPayload>(
    '/api/v1/employee/field-duty',
    { activeSession: null, sessions: [], visits: [] }
  );

  const [visitNotes, setVisitNotes] = useState<Record<string, string>>({});
  const [followUpDates, setFollowUpDates] = useState<Record<string, string>>({});
  const [customerName, setCustomerName] = useState('');
  const [customerReference, setCustomerReference] = useState('');
  const [visitPurpose, setVisitPurpose] = useState<(typeof VISIT_PURPOSES)[number]>(
    user?.jobCategory === 'RECOVERY' ? 'RECOVERY' : 'SALES_PITCH'
  );
  const [newVisitNote, setNewVisitNote] = useState('');
  const [evidenceDataUrl, setEvidenceDataUrl] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionUnavailable, setActionUnavailable] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const isRecovery = user?.jobCategory === 'RECOVERY';
  const activeSession = data.activeSession;

  const stopVisitCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const acquireCurrentCoords = (): Promise<{ latitude: number; longitude: number; gpsAccuracyMeters: number } | null> => {
    return new Promise((resolve) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            gpsAccuracyMeters: Math.round(pos.coords.accuracy),
          }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 7000 }
      );
    });
  };

  const handleToggleFieldDuty = async () => {
    setActionError(null);
    setActionUnavailable(null);
    setActionSuccess(null);
    setBusy(true);

    const coords = await acquireCurrentCoords();
    if (!coords) {
      setBusy(false);
      setActionError('Device GPS permission is required to record Field Duty start/end coordinates.');
      return;
    }

    const endpoint = activeSession
      ? '/api/v1/employee/field-duty/end'
      : '/api/v1/employee/field-duty/start';

    const res = await apiRequest<{ message?: string }>(endpoint, getInMemoryAccessToken(), {
      method: 'POST',
      body: coords,
    });
    setBusy(false);

    if (res.status === 'UNAVAILABLE') {
      setActionUnavailable(res.message || 'Field Duty backend API is not yet implemented.');
      return;
    }
    if (res.status !== 'OK') {
      setActionError(res.message);
      return;
    }
    setActionSuccess(
      res.data.message ||
        (activeSession
          ? 'Field duty session closed. GPS capture ceased.'
          : 'Field duty session started independently of attendance approval.')
    );
    reload();
  };

  const handlePingGpsCheckpoint = async () => {
    setActionError(null);
    setActionUnavailable(null);
    setActionSuccess(null);
    setBusy(true);

    const coords = await acquireCurrentCoords();
    if (!coords) {
      setBusy(false);
      setActionError('Device GPS permission is required to record a Field Duty GPS checkpoint.');
      return;
    }

    const res = await apiRequest<{ message?: string }>(
      '/api/v1/employee/field-duty/gps',
      getInMemoryAccessToken(),
      { method: 'POST', body: coords }
    );
    setBusy(false);

    if (res.status !== 'OK') {
      setActionError(res.message);
      return;
    }
    setActionSuccess(res.data.message || 'GPS checkpoint recorded on active field duty session.');
    reload();
  };

  const handleStartVisitCamera = async () => {
    setActionError(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setActionError('Live camera API unavailable; use photo upload instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraActive(true);
    } catch {
      setActionError('Camera permission denied.');
    }
  };

  const handleCaptureVisitPhoto = () => {
    if (!videoRef.current || !cameraActive) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 480;
    canvas.height = video.videoHeight || 360;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setEvidenceDataUrl(canvas.toDataURL('image/jpeg', 0.85));
    stopVisitCamera();
  };

  const handleUploadEvidenceFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setEvidenceDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleLogCustomerVisit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setActionUnavailable(null);
    setActionSuccess(null);

    if (customerName.trim().length < 2) {
      setActionError('Customer name is required (min 2 characters).');
      return;
    }

    setBusy(true);
    const coords = await acquireCurrentCoords();
    if (!coords) {
      setBusy(false);
      setActionError('GPS coordinates are required to log a customer visit during active Field Duty.');
      return;
    }

    const res = await apiRequest<{ message?: string }>(
      '/api/v1/employee/field-duty/visits',
      getInMemoryAccessToken(),
      {
        method: 'POST',
        body: {
          customerName: customerName.trim(),
          customerReference: customerReference.trim() || undefined,
          visitPurpose,
          notes: newVisitNote.trim() || undefined,
          ...coords,
          evidenceImageDataUrl: evidenceDataUrl || undefined,
        },
      }
    );
    setBusy(false);

    if (res.status !== 'OK') {
      setActionError(res.message);
      return;
    }
    setCustomerName('');
    setCustomerReference('');
    setNewVisitNote('');
    setEvidenceDataUrl(null);
    setActionSuccess(res.data.message || 'Customer visit logged with GPS verification.');
    reload();
  };

  const handleCompleteVisit = async (visitId: string) => {
    setActionError(null);
    setActionUnavailable(null);
    setActionSuccess(null);
    setBusy(true);

    const coords = await acquireCurrentCoords();
    const res = await apiRequest<{ updated: boolean }>(
      `/api/v1/employee/field-duty/visits/${encodeURIComponent(visitId)}/complete`,
      getInMemoryAccessToken(),
      {
        method: 'POST',
        body: {
          outcomeNote: visitNotes[visitId]?.trim() || 'Visit completed.',
          followUpDate: followUpDates[visitId] || undefined,
          gpsLat: coords?.latitude,
          gpsLng: coords?.longitude,
        },
      }
    );
    setBusy(false);

    if (res.status === 'UNAVAILABLE') {
      setActionUnavailable(res.message || 'Customer visit submission endpoint is not yet implemented.');
      return;
    }
    if (res.status !== 'OK') {
      setActionError(res.message);
      return;
    }
    setActionSuccess('Customer visit status updated.');
    reload();
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/60">
              <Navigation className="w-3 h-3 text-indigo-600" />
              {isRecovery ? 'Recovery Operations' : 'Sales Operations'}
            </span>
            <span className="text-xs text-slate-400">•</span>
            <span className="text-xs font-mono font-medium text-slate-500">
              {activeSession ? 'DUTY ACTIVE' : 'DUTY INACTIVE'}
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-1">
            Field Duty &amp; Customer Visits
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Start and end field duty independently of daily attendance. GPS telemetry logs only while duty is active.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {activeSession && (
            <Button
              variant="outline"
              size="sm"
              loading={busy}
              onClick={() => void handlePingGpsCheckpoint()}
              className="shadow-2xs"
            >
              <LocateFixed className="w-3.5 h-3.5 mr-1 text-indigo-600" />
              Ping Checkpoint
            </Button>
          )}
          <Button
            variant={activeSession ? 'destructive' : 'primary'}
            size="sm"
            loading={busy}
            onClick={handleToggleFieldDuty}
            className="shadow-sm"
          >
            {activeSession ? (
              <>
                <Square className="w-3.5 h-3.5 mr-1.5" />
                End Field Duty
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 mr-1.5" />
                Start Field Duty
              </>
            )}
          </Button>
        </div>
      </div>

      {state.status === 'unavailable' && (
        <StatusBanner tone="unavailable" title="Field Duty API Pending" description={state.message} />
      )}
      {actionUnavailable && (
        <StatusBanner tone="unavailable" title="Field Duty Endpoint Unavailable" description={actionUnavailable} />
      )}
      {actionError && <StatusBanner tone="error" title="Field Duty Action Blocked" description={actionError} />}
      {actionSuccess && <StatusBanner tone="success" title="Updated" description={actionSuccess} />}

      {isRecovery && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-xs text-amber-950 flex items-start gap-3 shadow-2xs">
          <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold text-amber-900">Recovery Non-Collection Governance Strictly Enforced</span>
            <p className="text-[11px] text-amber-800/90 mt-0.5">
              Record visit arrivals, conversation summaries, and follow-up schedules only. Cash/UPI collection is strictly prohibited without prior Finance authorization.
            </p>
          </div>
        </div>
      )}

      {/* Hero Active Duty Session Card */}
      <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${activeSession ? 'bg-emerald-50 text-emerald-600 border border-emerald-200/60' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
              <Navigation className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-slate-900 text-sm">Active Duty Session</h3>
                <Badge variant={activeSession ? 'success' : 'outline'} className="text-[10px]" dot={Boolean(activeSession)}>
                  {activeSession ? 'ACTIVE TELEMETRY' : 'STANDBY'}
                </Badge>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {activeSession
                  ? `Started on ${activeSession.date} • ${activeSession.gpsSamplesCount} GPS points collected • ${activeSession.distanceTravelledKm} km logged`
                  : 'Field Duty is inactive. Start Field Duty when traveling to client locations.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
            {activeSession ? (
              <Button size="sm" variant="destructive" loading={busy} onClick={handleToggleFieldDuty}>
                <Square className="w-3.5 h-3.5 mr-1.5" />
                End Field Duty
              </Button>
            ) : (
              <Button size="sm" loading={busy} onClick={handleToggleFieldDuty}>
                <Play className="w-3.5 h-3.5 mr-1.5" />
                Start Field Duty
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* KPI Overview Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Field Duty Status"
          value={activeSession ? 'Active' : 'Inactive'}
          icon={Activity}
          tone={activeSession ? 'success' : 'default'}
          subtitle={activeSession ? 'GPS capture active' : 'GPS capture stopped'}
        />
        <MetricCard
          label="Distance Logged"
          value={activeSession?.distanceTravelledKm ?? 0}
          unit="km"
          icon={Compass}
          tone="info"
          subtitle="Route distance logged today"
        />
        <MetricCard
          label="Checkpoints Recorded"
          value={activeSession?.gpsSamplesCount ?? 0}
          icon={LocateFixed}
          tone="primary"
          subtitle="Audited GPS coordinate pings"
        />
        <MetricCard
          label="Customer Stops"
          value={data.visits.length}
          icon={MapPin}
          tone="success"
          subtitle="Verified client interactions"
        />
      </div>

      {/* Log Customer Visit Form */}
      <Card className="shadow-card">
        <CardHeader className="border-b border-slate-100 pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <PlusCircle className="w-4 h-4 text-indigo-600" />
              Log Customer Visit
            </CardTitle>
            {!activeSession ? (
              <Badge variant="warning" className="text-[10px]">Start Field Duty First</Badge>
            ) : (
              <Badge variant="success" className="text-[10px]">Duty Active</Badge>
            )}
          </div>
          <CardDescription className="text-xs text-slate-500">
            Records customer coordinates + optional proof photo during active field duty.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <form onSubmit={handleLogCustomerVisit} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <FormField label="Customer / Business Name" required>
                <Input
                  inputSize="md"
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="e.g. Sri Lakshmi Enterprises"
                />
              </FormField>

              <FormField label="Account / Reference (Optional)">
                <Input
                  inputSize="md"
                  value={customerReference}
                  onChange={(e) => setCustomerReference(e.target.value)}
                  placeholder="e.g. LN-2041 / Shop-12"
                />
              </FormField>

              <FormField label="Visit Purpose" required>
                <Select
                  selectSize="md"
                  value={visitPurpose}
                  onChange={(e) => setVisitPurpose(e.target.value as (typeof VISIT_PURPOSES)[number])}
                >
                  {VISIT_PURPOSES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>

            <FormField label="Visit Notes &amp; Summary">
              <Textarea
                rows={2}
                value={newVisitNote}
                onChange={(e) => setNewVisitNote(e.target.value)}
                placeholder="Discussion notes or follow-up schedule (strictly no cash/payment collection entries)..."
              />
            </FormField>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleStartVisitCamera()}
                className="h-8 text-xs"
              >
                <Camera className="w-3.5 h-3.5 mr-1" />
                Live Visit Photo
              </Button>
              {cameraActive && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={handleCaptureVisitPhoto}
                  className="h-8 text-xs"
                >
                  Capture Frame
                </Button>
              )}
              <label className="inline-flex items-center gap-1.5 text-xs font-semibold cursor-pointer text-indigo-600 hover:text-indigo-800">
                <span>Or Upload Photo:</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleUploadEvidenceFile}
                  className="text-xs text-slate-500"
                />
              </label>
              {evidenceDataUrl && (
                <div className="relative">
                  <img
                    src={evidenceDataUrl}
                    alt="Visit evidence preview"
                    className="w-12 h-12 rounded-lg object-cover border border-slate-200 shadow-2xs"
                  />
                </div>
              )}
            </div>

            {cameraActive && (
              <div className="pt-2">
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full max-w-sm rounded-xl border border-slate-200 shadow-sm"
                />
              </div>
            )}

            <div className="pt-2 border-t border-slate-100 flex justify-end">
              <Button type="submit" size="md" loading={busy} disabled={!activeSession}>
                <PlusCircle className="w-4 h-4 mr-1.5" />
                Submit Customer Visit + GPS
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Customer Visits Ledger */}
      <Card className="shadow-card">
        <CardHeader className="border-b border-slate-100 pb-3">
          <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-indigo-600" />
            My Customer &amp; Follow-Up Visits ({data.visits.length})
          </CardTitle>
          <CardDescription className="text-xs text-slate-500">
            Recorded visit arrivals, GPS stamps, and follow-up schedules.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-3">
          {state.status === 'loading' ? (
            <EmptyState variant="loading" title="Loading customer visits..." compact />
          ) : data.visits.length === 0 ? (
            <EmptyState
              variant="empty"
              title="No customer visits recorded yet"
              description="Visits submitted during active field duty will appear here."
              compact
            />
          ) : (
            <div className="divide-y divide-slate-100 text-xs">
              {data.visits.map((v) => (
                <div
                  key={v.id}
                  className="py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-slate-50/50 px-2 rounded-lg transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-indigo-600 bg-indigo-50 border border-indigo-200/50 px-1.5 py-0.5 rounded text-[11px]">
                        {v.customerCode}
                      </span>
                      <span className="font-bold text-slate-900 text-sm">{v.customerName}</span>
                      <Badge variant={v.status === 'COMPLETED' ? 'success' : 'outline'} className="text-[10px]">
                        {v.status}
                      </Badge>
                      <Badge variant={v.visitCategory === 'RECOVERY' ? 'warning' : 'primary'} className="text-[10px]">
                        {v.visitCategory}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-slate-500 font-mono">{v.customerAddress}</p>
                    {v.outcomeNote && (
                      <p className="text-[11px] text-slate-700 bg-slate-50 rounded-md p-2 border border-slate-200/60 max-w-xl">
                        {v.outcomeNote}
                      </p>
                    )}
                  </div>

                  {v.status !== 'COMPLETED' && (
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <div className="w-44">
                        <Input
                          inputSize="sm"
                          placeholder="Outcome notes..."
                          value={visitNotes[v.id] ?? ''}
                          onChange={(e) => setVisitNotes((p) => ({ ...p, [v.id]: e.target.value }))}
                        />
                      </div>
                      <Input
                        inputSize="sm"
                        type="date"
                        value={followUpDates[v.id] ?? ''}
                        onChange={(e) => setFollowUpDates((p) => ({ ...p, [v.id]: e.target.value }))}
                        className="w-32 font-mono text-xs"
                      />
                      <Button
                        size="sm"
                        variant="success"
                        loading={busy}
                        onClick={() => handleCompleteVisit(v.id)}
                        className="h-8 text-xs px-2.5"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                        Complete Visit
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
