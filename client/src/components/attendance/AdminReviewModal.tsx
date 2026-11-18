import React, { useState } from 'react';
import {
  Camera,
  CheckCircle2,
  History,
  MapPin,
  MessageSquareQuote,
  ShieldCheck,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import type { DailyAttendanceRecord, FieldDutySessionRecord } from '../../types/hrms';
import { useAuth } from '../../context/AuthContext';
import { apiRequest } from '../../lib/apiClient';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { StatusBanner } from '../ui/StatusBanner';
import { GeofenceBoundaryMap } from './GeofenceBoundaryMap';

interface AdminReviewModalProps {
  record: DailyAttendanceRecord | null;
  fieldSession?: FieldDutySessionRecord | null;
  onClose: () => void;
  onReviewed?: () => void;
}

export const AdminReviewModal: React.FC<AdminReviewModalProps> = ({
  record,
  fieldSession,
  onClose,
  onReviewed,
}) => {
  const { getInMemoryAccessToken } = useAuth();
  const [remarks, setRemarks] = useState('');
  const [approvePostShift, setApprovePostShift] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailableMessage, setUnavailableMessage] = useState<string | null>(null);

  if (!record) return null;

  const isLocationViolated =
    record.locationState !== 'INSIDE_GEOFENCE' ||
    (record.distanceFromOfficeMeters !== undefined && record.distanceFromOfficeMeters > 50) ||
    (record.gpsAccuracyMeters !== undefined && record.gpsAccuracyMeters > 30);

  const handleDecision = async (decision: 'APPROVED' | 'REJECTED') => {
    setError(null);
    setUnavailableMessage(null);

    if (remarks.trim().length < 5) {
      setError('Mandatory Admin justification must be at least 5 characters.');
      return;
    }

    setSubmitting(true);
    const result = await apiRequest<{ updated: boolean }>(
      `/api/v1/admin/attendance/${encodeURIComponent(record.id)}/review`,
      getInMemoryAccessToken(),
      {
        method: 'POST',
        body: {
          decision,
          remarks: remarks.trim(),
          postShiftApproved: approvePostShift,
        },
      }
    );
    setSubmitting(false);

    if (result.status === 'UNAVAILABLE') {
      setUnavailableMessage(
        result.message || 'Attendance review API is not yet implemented on the backend.'
      );
      return;
    }

    if (result.status !== 'OK') {
      setError(result.message);
      return;
    }

    setRemarks('');
    onReviewed?.();
    onClose();
  };

  return (
    <Dialog
      open={Boolean(record)}
      onClose={onClose}
      title={`Attendance Exception Review — ${record.employeeName} (${record.employeeCode})`}
      description={`${record.department} • ${record.jobCategory} • Date: ${record.date} • Submitted: ${record.checkInTime ?? '--'}`}
      maxWidthClass="max-w-4xl"
    >
      <div className="space-y-5">
        {error && <StatusBanner tone="error" title="Review Validation Error" description={error} />}
        {unavailableMessage && (
          <StatusBanner
            tone="unavailable"
            title="Backend Endpoint Unavailable"
            description={unavailableMessage}
          />
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Enrolled Reference & Biometric Panel */}
          <div className="rounded-2xl border border-border p-4 space-y-3 bg-muted/20">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                Biometric &amp; Live Selfie Evidence
              </span>
              <Badge variant={record.livenessPassed ? 'success' : 'destructive'}>
                Liveness {record.livenessPassed ? 'Passed' : 'Not Verified'}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-900 text-slate-200 p-3 text-center space-y-2">
                {record.enrolledFaceUrl ? (
                  <img
                    src={record.enrolledFaceUrl}
                    alt="Enrolled reference face"
                    className="w-full h-24 object-cover rounded-lg border border-indigo-400/30"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-indigo-500/20 border border-indigo-400/40 mx-auto flex items-center justify-center font-bold text-indigo-300">
                    REF
                  </div>
                )}
                <p className="text-[11px] font-semibold">Enrolled Reference</p>
                <p className="text-[10px] text-slate-400">
                  {record.enrolledFaceUrl ? 'Signed private storage URL' : 'No approved enrollment on file'}
                </p>
              </div>
              <div className="rounded-xl bg-slate-900 text-slate-200 p-3 text-center space-y-2">
                {record.checkInSelfieUrl || record.checkOutSelfieUrl ? (
                  <img
                    src={record.checkInSelfieUrl ?? record.checkOutSelfieUrl ?? ''}
                    alt="Live attendance selfie"
                    className="w-full h-24 object-cover rounded-lg border border-emerald-400/30"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-400/40 mx-auto flex items-center justify-center">
                    <Camera className="w-5 h-5 text-emerald-300" />
                  </div>
                )}
                <p className="text-[11px] font-semibold">Live Attempt Selfie</p>
                <p className="text-[10px] text-slate-400">
                  Match: {record.faceConfidence ? `${Math.round(record.faceConfidence * 100)}%` : 'Manual Review'} •{' '}
                  {record.faceAttemptsUsed} attempt(s)
                </p>
              </div>
            </div>

            <div className="text-[11px] text-muted-foreground space-y-1">
              <p>
                <span className="font-semibold text-foreground">Face Verification State:</span>{' '}
                <span className="font-mono">{record.faceState}</span>
              </p>
              {record.selfieCapturedLabel && (
                <p>
                  <span className="font-semibold text-foreground">Capture Metadata:</span>{' '}
                  {record.selfieCapturedLabel}
                </p>
              )}
            </div>
          </div>

          {/* GPS, 50m Geofence & Comment Panel */}
          <div className="rounded-2xl border border-border p-4 space-y-3 bg-muted/20">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-amber-600" />
                GPS, 50m Geofence &amp; Telemetry
              </span>
              <Badge variant={record.locationState === 'INSIDE_GEOFENCE' ? 'success' : 'warning'}>
                {record.locationState}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div className="p-2.5 rounded-xl bg-card border border-border">
                <p className="text-[10px] text-muted-foreground">Submitted Coordinates</p>
                <p className="font-mono font-semibold text-xs mt-0.5">
                  {record.latitude !== undefined && record.longitude !== undefined
                    ? `${record.latitude.toFixed(4)}, ${record.longitude.toFixed(4)}`
                    : '--'}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-card border border-border">
                <p className="text-[10px] text-muted-foreground">Distance from HQ (50m rule)</p>
                <p className="font-mono font-semibold text-xs mt-0.5">
                  {record.distanceFromOfficeMeters !== undefined
                    ? `${record.distanceFromOfficeMeters}m`
                    : '--'}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-card border border-border">
                <p className="text-[10px] text-muted-foreground">GPS Accuracy (Max 30m)</p>
                <p className="font-mono font-semibold text-xs mt-0.5">
                  {record.gpsAccuracyMeters !== undefined ? `${record.gpsAccuracyMeters}m` : '--'}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-card border border-border">
                <p className="text-[10px] text-muted-foreground">Field Duty Session</p>
                <p className="font-mono font-semibold text-xs mt-0.5">
                  {fieldSession ? fieldSession.status : 'NOT STARTED'}
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200 space-y-1">
              <p className="text-[11px] font-bold text-amber-950 flex items-center gap-1.5">
                <MessageSquareQuote className="w-3.5 h-3.5 text-amber-700" />
                Preserved Employee Comment
              </p>
              <p className="text-xs text-amber-900 italic">
                {record.employeeComment ? `"${record.employeeComment}"` : 'No employee comment provided.'}
              </p>
            </div>

            {/* Visual 50m Geofence Radar / Map */}
            <div className="pt-1">
              <GeofenceBoundaryMap
                officeName="Official Head Office"
                officeLatitude={17.31917323150614}
                officeLongitude={78.65081944376108}
                radiusMeters={50}
                employeeDistanceMeters={record.distanceFromOfficeMeters}
                gpsAccuracyMeters={record.gpsAccuracyMeters}
                employeeLabel={record.employeeName}
              />
            </div>
          </div>
        </div>

        {isLocationViolated && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Approval Blocked by Location Governance Policy</p>
              <p className="mt-0.5 text-rose-800">
                Employee location was outside the 50m office geofence ({record.distanceFromOfficeMeters !== undefined ? `${record.distanceFromOfficeMeters}m from HQ` : 'location exception'}) or GPS accuracy exceeded the 30m maximum threshold. Per enterprise governance rules, attendance submissions outside the geofence cannot be approved. Only rejection is permitted.
              </p>
            </div>
          </div>
        )}

        <StatusBanner
          tone="info"
          title="Immutable Audit Guarantee"
          description="Approving or rejecting records Admin identity, timestamp, and mandatory remarks server-side without overwriting original selfie evidence, GPS telemetry, employee comments, or active Field Duty logs."
        />

        {record.auditTrail.length > 0 && (
          <div className="rounded-xl border border-border p-3.5 space-y-2">
            <p className="text-xs font-bold flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-muted-foreground" />
              Chronological Audit History ({record.auditTrail.length})
            </p>
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {record.auditTrail.map((a) => (
                <div key={a.id} className="text-[11px] bg-muted/40 rounded-lg px-2.5 py-1.5 flex justify-between gap-2">
                  <span>
                    <span className="font-mono font-semibold text-foreground">{a.action}</span> — {a.reason}
                  </span>
                  <span className="text-muted-foreground shrink-0">{a.actorName}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {record.postShiftMinutes > 0 && (
          <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer p-3 rounded-xl bg-indigo-50/70 border border-indigo-200">
            <input
              type="checkbox"
              checked={approvePostShift}
              onChange={(e) => setApprovePostShift(e.target.checked)}
              className="rounded border-input"
            />
            <span>
              Approve {record.postShiftMinutes} min post-18:00 overtime at 1.0x hourly rate
            </span>
          </label>
        )}

        <div className="space-y-2">
          <label htmlFor="admin-review-remarks" className="text-xs font-semibold block">
            Mandatory Admin Justification / Remarks (min 5 characters)
          </label>
          <textarea
            id="admin-review-remarks"
            rows={2}
            placeholder="Enter Admin verification remarks explaining approval or rejection..."
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            className="w-full rounded-xl border border-input px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Close
          </Button>
          <Button
            type="button"
            variant="destructive"
            loading={submitting}
            onClick={() => handleDecision('REJECTED')}
          >
            <XCircle className="w-4 h-4" />
            Reject Attendance
          </Button>
          <Button
            type="button"
            variant="success"
            loading={submitting}
            disabled={submitting || isLocationViolated}
            onClick={() => handleDecision('APPROVED')}
          >
            <CheckCircle2 className="w-4 h-4" />
            Approve Attendance
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
