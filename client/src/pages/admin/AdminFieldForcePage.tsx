import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Flag,
  MapPin,
  Navigation,
  Route,
  WifiOff,
  XCircle,
  Eye,
  Camera,
  Activity,
  Compass,
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
import { DataTable } from '../../components/ui/DataTable';
import { Input } from '../../components/ui/Input';

interface AdminFieldForcePayload {
  sessions: FieldDutySessionRecord[];
  visits: CustomerVisitRecord[];
}

export const AdminFieldForcePage: React.FC = () => {
  const { getInMemoryAccessToken } = useAuth();
  const { state, data, reload } = useApiResource<AdminFieldForcePayload>(
    '/api/v1/admin/field-force',
    { sessions: [], visits: [] }
  );

  const [visitQuery, setVisitQuery] = useState('');
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSuccess, setReviewSuccess] = useState<string | null>(null);

  const kpis = useMemo(() => {
    const activeSessions = data.sessions.filter((s) => s.status === 'ACTIVE').length;
    const totalKm = data.sessions.reduce((acc, s) => acc + (s.distanceTravelledKm || 0), 0);
    const totalVisits = data.visits.length;
    const pendingReviews = data.visits.filter((v) => !v.reviewStatus || v.reviewStatus === 'PENDING').length;
    return { activeSessions, totalKm: totalKm.toFixed(1), totalVisits, pendingReviews };
  }, [data.sessions, data.visits]);

  const filteredVisits = useMemo(() => {
    const q = visitQuery.trim().toLowerCase();
    if (!q) return data.visits;
    return data.visits.filter(
      (v) =>
        v.customerName.toLowerCase().includes(q) ||
        v.customerCode.toLowerCase().includes(q) ||
        v.employeeName.toLowerCase().includes(q) ||
        v.employeeCode.toLowerCase().includes(q) ||
        (v.customerAddress && v.customerAddress.toLowerCase().includes(q))
    );
  }, [data.visits, visitQuery]);

  const handleReviewVisit = async (
    visitId: string,
    reviewStatus: 'VERIFIED' | 'FLAGGED' | 'REJECTED'
  ) => {
    setReviewError(null);
    setReviewSuccess(null);
    setReviewingId(visitId);
    const res = await apiRequest<{ updated: boolean }>(
      `/api/v1/admin/customer-visits/${encodeURIComponent(visitId)}/review`,
      getInMemoryAccessToken(),
      {
        method: 'POST',
        body: {
          reviewStatus,
          reviewNote: reviewNotes[visitId]?.trim() || undefined,
        },
      }
    );
    setReviewingId(null);

    if (res.status !== 'OK') {
      setReviewError(res.message);
      return;
    }

    setReviewSuccess(`Customer visit marked ${reviewStatus}.`);
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
              Field-Force Operations
            </span>
            <span className="text-xs text-slate-400">•</span>
            <span className="text-xs font-mono font-medium text-slate-500">
              Active Duty Sessions: {kpis.activeSessions}
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-1">
            Field Force &amp; Customer Visit Monitor
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time route telemetry for Sales &amp; Recovery officers. Attendance Check-In and Field Duty remain decoupled.
          </p>
        </div>
      </div>

      {state.status === 'unavailable' && (
        <StatusBanner tone="unavailable" title="Field-Force Telemetry API Pending" description={state.message} />
      )}
      {reviewError && <StatusBanner tone="error" title="Visit Review Error" description={reviewError} />}
      {reviewSuccess && <StatusBanner tone="success" title="Visit Reviewed" description={reviewSuccess} />}

      {/* KPI Metrics Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Active Duty Routes"
          value={kpis.activeSessions}
          icon={Activity}
          tone="primary"
          subtitle="Currently transmitting GPS points"
        />
        <MetricCard
          label="Total Distance"
          value={kpis.totalKm}
          unit="km"
          icon={Compass}
          tone="info"
          subtitle="Audited GPS route distances"
        />
        <MetricCard
          label="Customer Visits"
          value={kpis.totalVisits}
          icon={MapPin}
          tone="success"
          subtitle="Total verified client stops"
        />
        <MetricCard
          label="Visits To Adjudicate"
          value={kpis.pendingReviews}
          icon={Flag}
          tone={kpis.pendingReviews > 0 ? 'warning' : 'default'}
          subtitle="Awaiting Admin confirmation"
        />
      </div>

      {/* Authorized Field Duty Sessions */}
      <Card className="shadow-card">
        <CardHeader className="border-b border-slate-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Navigation className="w-4 h-4 text-indigo-600" />
                Active Field Duty Sessions ({data.sessions.length})
              </CardTitle>
              <CardDescription className="text-xs text-slate-500 mt-0.5">
                GPS route checkpoints recorded strictly between Start Field Duty and End Field Duty.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Auto-terminates GPS at Duty End</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {state.status === 'loading' ? (
            <EmptyState variant="loading" title="Loading field duty sessions..." compact />
          ) : data.sessions.length === 0 ? (
            <EmptyState
              variant="empty"
              title="No active field duty sessions."
              description="Field duty routes started by authorized Sales and Recovery employees will appear here."
              compact
            />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {data.sessions.map((session) => (
                <div
                  key={session.id}
                  className="rounded-xl border border-slate-200/90 bg-white p-4 space-y-3 text-xs shadow-2xs hover:border-slate-300 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900 text-sm">
                          {session.employeeName}
                        </span>
                        <span className="font-mono text-xs text-indigo-600 bg-indigo-50 border border-indigo-200/60 px-1.5 py-0.5 rounded">
                          {session.employeeCode}
                        </span>
                        <Badge
                          variant={session.jobCategory === 'RECOVERY' ? 'warning' : 'primary'}
                          className="text-[10px]"
                        >
                          {session.jobCategory}
                        </Badge>
                        <Badge
                          variant={session.status === 'ACTIVE' ? 'success' : 'default'}
                          className="text-[10px]"
                        >
                          {session.status}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Attendance Status at Start: <strong className="font-mono text-slate-700">{session.attendanceStatusAtStart}</strong>
                      </p>
                    </div>
                    <div className="text-right font-mono shrink-0">
                      <p className="font-bold text-slate-900 text-sm tabular-nums">
                        {session.distanceTravelledKm} km
                      </p>
                      <p className="text-[11px] text-slate-400 tabular-nums">{session.gpsSamplesCount} points</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <Badge variant="outline" className="text-[10px] text-slate-700 bg-slate-50">
                      <MapPin className="w-3 h-3 text-emerald-600 mr-1" />
                      {session.lastLocationLabel ?? 'Latest checkpoint'}
                    </Badge>
                    {session.gpsGapsCount > 0 && (
                      <Badge variant="warning" className="text-[10px]">
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        {session.gpsGapsCount} GPS Gap Flagged
                      </Badge>
                    )}
                    {session.offlineQueueCount > 0 && (
                      <Badge variant="default" className="text-[10px]">
                        <WifiOff className="w-3 h-3 mr-1" />
                        {session.offlineQueueCount} Offline Queued
                      </Badge>
                    )}
                  </div>

                  {session.routePoints.length > 0 && (
                    <div className="rounded-lg bg-slate-50 border border-slate-200/70 p-3 space-y-1.5 mt-2">
                      <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                        <Route className="w-3 h-3 text-indigo-600" />
                        Audited Checkpoints ({session.routePoints.length})
                      </p>
                      <div className="divide-y divide-slate-200/50 max-h-32 overflow-y-auto pr-1">
                        {session.routePoints.map((pt, idx) => (
                          <div key={`${session.id}-pt-${idx}`} className="py-1 flex justify-between text-[11px]">
                            <span className="truncate pr-2">
                              <span className="font-mono font-semibold text-slate-800 tabular-nums">{pt.time}</span>
                              <span className="text-slate-400 mx-1">—</span>
                              <span className="text-slate-600">{pt.label}</span>
                            </span>
                            <span className="font-mono tabular-nums text-slate-400 shrink-0">
                              {pt.lat.toFixed(4)}, {pt.lng.toFixed(4)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Customer Visits Table */}
      <DataTable
        title="Customer &amp; Recovery Visits Log"
        description="Verified customer arrival and completion timestamps with GPS evidence. Recovery records strictly exclude payment collection."
        searchPlaceholder="Search customer, code, officer..."
        searchValue={visitQuery}
        onSearchChange={setVisitQuery}
        totalCount={data.visits.length}
        filteredCount={filteredVisits.length}
        isLoading={state.status === 'loading'}
        error={state.status === 'error' ? state.message : null}
        onRetry={reload}
        emptyTitle="No customer or recovery visits logged yet"
        emptyDescription="Field customer visits and recovery follow-ups recorded by Sales and Recovery staff will display here."
        onClearFilters={visitQuery ? () => setVisitQuery('') : undefined}
      >
        <div className="divide-y divide-slate-100">
          {filteredVisits.map((v) => {
            const photoUrl = v.evidenceSignedUrl ?? v.evidencePhotoUrl;
            const currentReview = v.reviewStatus ?? 'PENDING';
            return (
              <div
                key={v.id}
                className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 text-xs hover:bg-slate-50/70 transition-colors"
              >
                <div className="flex items-start gap-3.5">
                  {photoUrl ? (
                    <a
                      href={photoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 group relative block"
                    >
                      <img
                        src={photoUrl}
                        alt={`Evidence for ${v.customerName}`}
                        className="w-16 h-16 rounded-xl object-cover border border-slate-200 bg-slate-100 group-hover:opacity-90 transition-opacity"
                      />
                      <div className="absolute inset-0 bg-black/40 rounded-xl opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                        <Eye className="w-4 h-4" />
                      </div>
                    </a>
                  ) : (
                    <div className="w-16 h-16 rounded-xl border border-dashed border-slate-300 bg-slate-50 flex flex-col items-center justify-center text-[10px] text-slate-400 text-center px-1 shrink-0">
                      <Camera className="w-4 h-4 mb-1 text-slate-300" />
                      No Photo
                    </div>
                  )}

                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-indigo-600 bg-indigo-50 border border-indigo-200/50 px-1.5 py-0.5 rounded text-[11px]">
                        {v.customerCode}
                      </span>
                      <span className="font-bold text-slate-900 text-sm">{v.customerName}</span>
                      <Badge
                        variant={v.visitCategory === 'RECOVERY' ? 'warning' : 'primary'}
                        className="text-[10px]"
                      >
                        {v.visitCategory}
                      </Badge>
                      <Badge
                        variant={
                          currentReview === 'VERIFIED'
                            ? 'success'
                            : currentReview === 'FLAGGED'
                              ? 'warning'
                              : currentReview === 'REJECTED'
                                ? 'destructive'
                                : 'outline'
                        }
                        className="text-[10px]"
                      >
                        Review: {currentReview}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Assigned Agent: <strong className="text-slate-700">{v.employeeName}</strong> ({v.employeeCode}) • Coords: <span className="font-mono text-slate-600">{v.customerAddress}</span>
                    </p>
                    {v.outcomeNote && (
                      <p className="text-[11px] text-slate-700 bg-slate-50 border border-slate-200/60 rounded-md px-2 py-1 max-w-xl">
                        {v.outcomeNote}
                      </p>
                    )}
                    {(v.reviewNote ?? v.reviewNotes) && (
                      <p className="text-[11px] text-indigo-700 font-medium">
                        Admin Note: {v.reviewNote ?? v.reviewNotes}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <div className="w-44">
                    <Input
                      inputSize="sm"
                      placeholder="Audit note..."
                      value={reviewNotes[v.id] ?? ''}
                      onChange={(e) =>
                        setReviewNotes((prev) => ({ ...prev, [v.id]: e.target.value }))
                      }
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="success"
                    loading={reviewingId === v.id}
                    onClick={() => void handleReviewVisit(v.id, 'VERIFIED')}
                    className="h-8 text-xs px-2.5"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                    Verify
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={reviewingId === v.id}
                    onClick={() => void handleReviewVisit(v.id, 'FLAGGED')}
                    className="h-8 text-xs px-2.5 text-amber-700 border-amber-300 hover:bg-amber-50"
                  >
                    <Flag className="w-3.5 h-3.5 mr-1" />
                    Flag
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    loading={reviewingId === v.id}
                    onClick={() => void handleReviewVisit(v.id, 'REJECTED')}
                    className="h-8 text-xs px-2.5"
                  >
                    <XCircle className="w-3.5 h-3.5 mr-1" />
                    Reject
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </DataTable>
    </div>
  );
};
