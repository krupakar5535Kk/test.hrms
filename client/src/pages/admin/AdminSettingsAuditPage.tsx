import React, { useEffect, useState } from 'react';
import {
  Building2,
  History,
  Lock,
  MapPin,
  ShieldCheck,
  Compass,
  CheckCircle2,
} from 'lucide-react';
import { HRMS_POLICY } from '../../lib/domainRules';
import { useAuth } from '../../context/AuthContext';
import { useApiResource } from '../../hooks/useApiResource';
import { apiRequest } from '../../lib/apiClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { GeofenceBoundaryMap } from '../../components/attendance/GeofenceBoundaryMap';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { MetricCard } from '../../components/ui/MetricCard';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Textarea';

interface AdminSettingsPayload {
  organization: {
    name?: string;
    legalName: string;
    code: string;
    selfieRetentionDays: number;
    plannedEmployeeCount?: number;
  } | null;
  officeGeofence: {
    id?: string;
    name: string;
    address?: string;
    latitude: number;
    longitude: number;
    geofenceRadiusMeters: number;
    maxGpsAccuracyMeters: number;
    policyVersion: string;
    policyUpdatedBy?: string;
  } | null;
  locationHistory: Array<{
    id: string;
    previousName: string | null;
    previousLatitude: number | null;
    previousLongitude: number | null;
    previousRadiusMeters: number | null;
    newName: string;
    newLatitude: number;
    newLongitude: number;
    newRadiusMeters: number;
    reason: string;
    changedAt: string;
  }>;
  auditLogs: Array<{
    id: string;
    action: string;
    reason: string;
    actorName: string;
    createdAt: string;
  }>;
}

const EMPTY_SETTINGS: AdminSettingsPayload = {
  organization: null,
  officeGeofence: null,
  locationHistory: [],
  auditLogs: [],
};

export const AdminSettingsAuditPage: React.FC = () => {
  const { getInMemoryAccessToken } = useAuth();
  const { state, data, reload } = useApiResource<AdminSettingsPayload>(
    '/api/v1/admin/settings',
    EMPTY_SETTINGS
  );

  const [officeName, setOfficeName] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [geofenceReason, setGeofenceReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveUnavailable, setSaveUnavailable] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (data.officeGeofence) {
      setOfficeName(data.officeGeofence.name);
      setLatitude(
        data.officeGeofence.latitude.toFixed(14).replace(/0+$/, '').replace(/\.$/, '') ||
          String(data.officeGeofence.latitude)
      );
      setLongitude(
        data.officeGeofence.longitude.toFixed(14).replace(/0+$/, '').replace(/\.$/, '') ||
          String(data.officeGeofence.longitude)
      );
    }
  }, [data.officeGeofence]);

  const handleSaveGeofence = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setSaveUnavailable(null);
    setSaveSuccess(null);

    const latNum = Number(latitude);
    const lngNum = Number(longitude);
    if (
      !Number.isFinite(latNum) ||
      !Number.isFinite(lngNum) ||
      latNum < -90 ||
      latNum > 90 ||
      lngNum < -180 ||
      lngNum > 180
    ) {
      setSaveError('Enter valid HQ latitude and longitude coordinates.');
      return;
    }
    if (geofenceReason.trim().length < 5) {
      setSaveError('Enter an audit reason for changing approved HQ geofence coordinates (min 5 characters).');
      return;
    }

    setSaving(true);
    const res = await apiRequest<{ updated: boolean }>(
      '/api/v1/admin/settings/geofence',
      getInMemoryAccessToken(),
      {
        method: 'PUT',
        body: {
          name: officeName.trim() || 'Headquarters Office',
          latitude: latNum,
          longitude: lngNum,
          geofenceRadiusMeters: HRMS_POLICY.OFFICE_GEOFENCE_RADIUS_METERS,
          maxGpsAccuracyMeters: HRMS_POLICY.MAX_GPS_ACCURACY_METERS,
          reason: geofenceReason.trim(),
        },
      }
    );
    setSaving(false);

    if (res.status === 'UNAVAILABLE') {
      setSaveUnavailable(res.message || 'Organization settings endpoint not yet implemented.');
      return;
    }
    if (res.status !== 'OK') {
      setSaveError(res.message);
      return;
    }

    setGeofenceReason('');
    setSaveSuccess('Approved HQ geofence coordinates updated and permanently audited.');
    reload();
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/60">
              <Building2 className="w-3 h-3 text-indigo-600" />
              Settings &amp; Audit Governance
            </span>
            <span className="text-xs text-slate-400">•</span>
            <span className="text-xs font-mono font-medium text-slate-500">
              Tenant: {data.organization?.code ?? 'DEC-13'}
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-1">
            Organization Settings &amp; Audit Trail
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure approved headquarters perimeter coordinates ({HRMS_POLICY.OFFICE_GEOFENCE_RADIUS_METERS}m radius) and inspect immutable Admin audit history.
          </p>
        </div>
      </div>

      {state.status === 'unavailable' && (
        <StatusBanner tone="unavailable" title="Organization Settings API Pending" description={state.message} />
      )}

      {/* Policy KPI Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Geofence Perimeter"
          value={HRMS_POLICY.OFFICE_GEOFENCE_RADIUS_METERS}
          unit="metres"
          icon={MapPin}
          tone="primary"
          subtitle="Fixed perimeter boundary policy"
        />
        <MetricCard
          label="GPS Accuracy Threshold"
          value={`≤ ${HRMS_POLICY.MAX_GPS_ACCURACY_METERS}`}
          unit="metres"
          icon={Compass}
          tone="success"
          subtitle="Precision required for punch acceptance"
        />
        <MetricCard
          label="Selfie Retention"
          value={data.organization?.selfieRetentionDays ?? 30}
          unit="days"
          icon={ShieldCheck}
          tone="info"
          subtitle="Automated biometric cleanup window"
        />
        <MetricCard
          label="Audited Actions"
          value={data.auditLogs.length}
          icon={History}
          tone="default"
          subtitle="Immutable security trail entries"
        />
      </div>

      {/* Geofence Configuration & Map Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <Card className="lg:col-span-6 shadow-card">
          <CardHeader className="border-b border-slate-100 pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-indigo-600" />
                HQ Coordinates Configuration
              </CardTitle>
              <Badge variant="primary" className="text-[10px]">
                Policy Radius: {HRMS_POLICY.OFFICE_GEOFENCE_RADIUS_METERS}m
              </Badge>
            </div>
            <CardDescription className="text-xs text-slate-500 mt-0.5">
              Approved headquarters pin coordinates for on-premises attendance validation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4 text-xs">
            {/* Metadata Summary */}
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200/80 bg-slate-50/50 p-3 space-y-1.5">
              <div className="flex justify-between py-1">
                <span className="text-slate-500">Legal Organization Entity</span>
                <span className="font-semibold text-slate-900">{data.organization?.legalName ?? 'Corporate Headquarters'}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500">Tenant Code (DEC-13)</span>
                <span className="font-mono font-bold text-indigo-600">{data.organization?.code ?? '--'}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500">Stored Coordinates (14-decimal)</span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {data.officeGeofence
                    ? `${data.officeGeofence.latitude.toFixed(6)}, ${data.officeGeofence.longitude.toFixed(6)}`
                    : 'Not configured'}
                </span>
              </div>
            </div>

            {saveUnavailable && (
              <StatusBanner tone="unavailable" title="Save Endpoint Pending" description={saveUnavailable} />
            )}
            {saveError && <StatusBanner tone="error" title="Invalid Coordinates" description={saveError} />}
            {saveSuccess && <StatusBanner tone="success" title="Saved" description={saveSuccess} />}

            {/* Form */}
            <form onSubmit={handleSaveGeofence} className="space-y-3.5">
              <FormField label="HQ Facility Name">
                <Input
                  inputSize="md"
                  value={officeName}
                  onChange={(e) => setOfficeName(e.target.value)}
                  placeholder="Headquarters Office"
                />
              </FormField>

              <div className="grid grid-cols-2 gap-3">
                <FormField label="Latitude (Decimal)" required>
                  <Input
                    inputSize="md"
                    value={latitude}
                    onChange={(e) => setLatitude(e.target.value)}
                    placeholder="e.g. 17.448293"
                    className="font-mono tabular-nums"
                  />
                </FormField>

                <FormField label="Longitude (Decimal)" required>
                  <Input
                    inputSize="md"
                    value={longitude}
                    onChange={(e) => setLongitude(e.target.value)}
                    placeholder="e.g. 78.374829"
                    className="font-mono tabular-nums"
                  />
                </FormField>
              </div>

              <FormField
                label="Mandatory Audit Justification (min 5 characters)"
                required
                helperText="Reason will be immutably recorded in the location history log."
              >
                <Textarea
                  rows={2}
                  value={geofenceReason}
                  onChange={(e) => setGeofenceReason(e.target.value)}
                  placeholder="State the operational reason for updating official HQ coordinates..."
                />
              </FormField>

              <div className="pt-1">
                <Button type="submit" size="md" variant="primary" loading={saving}>
                  <MapPin className="w-3.5 h-3.5 mr-1.5" />
                  Save Approved HQ Coordinates
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Map & Security Policy Column */}
        <div className="lg:col-span-6 space-y-4">
          <GeofenceBoundaryMap
            officeName={data.officeGeofence?.name ?? 'Headquarters Office'}
            officeLatitude={data.officeGeofence?.latitude ?? null}
            officeLongitude={data.officeGeofence?.longitude ?? null}
            radiusMeters={HRMS_POLICY.OFFICE_GEOFENCE_RADIUS_METERS}
            employeeLabel={
              data.officeGeofence?.policyUpdatedBy
                ? `Updated by ${data.officeGeofence.policyUpdatedBy}`
                : 'No coordinates stored'
            }
            unconfigured={!data.officeGeofence}
          />

          <Card className="shadow-card">
            <CardContent className="p-4 text-xs space-y-2">
              <p className="font-bold text-slate-900 flex items-center gap-1.5">
                <Lock className="w-4 h-4 text-emerald-600" />
                Active Architectural Security Guarantees (PO-01 – PO-07)
              </p>
              <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 pt-1">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>PO-01 Synthetic auth identity</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>PO-02 Indian mobile numbers (+91)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>PO-05 In-memory tokens only</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>PO-07 Multi-device revocation</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Geofence Location History */}
      <Card className="shadow-card">
        <CardHeader className="border-b border-slate-100 pb-3">
          <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-indigo-600" />
            Office Location Change History ({data.locationHistory.length})
          </CardTitle>
          <CardDescription className="text-xs text-slate-500">
            Historical snapshots of approved headquarters coordinates, policy radius, and admin audit reasons.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-3">
          {state.status === 'loading' ? (
            <EmptyState variant="loading" title="Loading location history..." compact />
          ) : data.locationHistory.length === 0 ? (
            <EmptyState
              variant="empty"
              title="No geofence coordinate changes recorded yet."
              description="Each update to approved HQ coordinates appends an immutable entry here."
              compact
            />
          ) : (
            <div className="divide-y divide-slate-100 text-xs">
              {data.locationHistory.map((h) => (
                <div
                  key={h.id}
                  className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-50/50 px-2 rounded-lg transition-colors"
                >
                  <div className="space-y-0.5">
                    <p className="font-semibold text-slate-900">
                      {h.newName} •{' '}
                      <span className="font-mono text-indigo-600 tabular-nums">
                        {h.newLatitude.toFixed(6)}, {h.newLongitude.toFixed(6)} ({h.newRadiusMeters}m)
                      </span>
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Audit Reason: <strong className="text-slate-700">{h.reason}</strong>
                      {h.previousLatitude !== null && h.previousLongitude !== null && (
                        <span>
                          {' '}• Previous:{' '}
                          <span className="font-mono tabular-nums">
                            {h.previousLatitude.toFixed(6)}, {h.previousLongitude.toFixed(6)}
                          </span>
                        </span>
                      )}
                    </p>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400 shrink-0">
                    {h.changedAt}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Immutable Admin Audit Log */}
      <Card className="shadow-card">
        <CardHeader className="border-b border-slate-100 pb-3">
          <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <History className="w-4 h-4 text-indigo-600" />
            Immutable Admin Audit Log ({data.auditLogs.length})
          </CardTitle>
          <CardDescription className="text-xs text-slate-500">
            Cryptographically tracked audit trail recording approvals, attendance corrections, geofence modifications, and payroll authorizations.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-3">
          {state.status === 'loading' ? (
            <EmptyState variant="loading" title="Loading audit logs..." compact />
          ) : data.auditLogs.length === 0 ? (
            <EmptyState
              variant="empty"
              title="No audit entries recorded yet."
              description="Administrative approvals and policy edits persisted by the backend will appear chronologically here."
              compact
            />
          ) : (
            <div className="divide-y divide-slate-100 text-xs">
              {data.auditLogs.map((log) => (
                <div
                  key={log.id}
                  className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-50/50 px-2 rounded-lg transition-colors"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-indigo-600 bg-indigo-50 border border-indigo-200/50 px-2 py-0.5 rounded text-[11px]">
                      {log.action}
                    </span>
                    <span className="text-slate-800 font-medium">{log.reason}</span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400 shrink-0">
                    {log.actorName} • {log.createdAt}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
