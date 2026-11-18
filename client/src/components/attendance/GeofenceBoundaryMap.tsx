import React from 'react';
import { MapPin, Navigation } from 'lucide-react';
import { HRMS_POLICY } from '../../lib/domainRules';

interface GeofenceBoundaryMapProps {
  officeName?: string;
  officeLatitude?: number | null;
  officeLongitude?: number | null;
  radiusMeters?: number;
  employeeDistanceMeters?: number;
  gpsAccuracyMeters?: number;
  employeeLabel?: string;
  unconfigured?: boolean;
}

export const GeofenceBoundaryMap: React.FC<GeofenceBoundaryMapProps> = ({
  officeName = 'Headquarters Office',
  officeLatitude,
  officeLongitude,
  radiusMeters = HRMS_POLICY.OFFICE_GEOFENCE_RADIUS_METERS,
  employeeDistanceMeters,
  gpsAccuracyMeters,
  employeeLabel = 'Current GPS Position',
  unconfigured = officeLatitude == null || officeLongitude == null,
}) => {
  const inside =
    employeeDistanceMeters !== undefined && employeeDistanceMeters <= radiusMeters;

  const markerOffsetPx =
    employeeDistanceMeters === undefined
      ? 0
      : Math.min(72, Math.max(8, Math.round((employeeDistanceMeters / radiusMeters) * 44)));

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0B1528] p-4 text-slate-200 shadow-xs">
      <div className="flex items-center justify-between gap-2 text-xs mb-3 font-semibold text-white">
        <span className="flex items-center gap-2 truncate">
          <MapPin className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="truncate">{officeName}</span>
        </span>
        <span className="font-mono text-xs text-slate-400 shrink-0 bg-slate-800/80 px-2.5 py-0.5 rounded-full border border-slate-700">
          Radius {radiusMeters}m
        </span>
      </div>

      <div className="relative rounded-xl bg-[#070D18] border border-slate-800/90 overflow-hidden">
        <svg viewBox="0 0 240 180" className="w-full h-44 block" aria-label="Office 50m geofence boundary view">
          <defs>
            <pattern id="geofence-grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(148,163,184,0.06)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="240" height="180" fill="url(#geofence-grid)" />

          {/* Approved 50m radius perimeter */}
          <circle
            cx="120"
            cy="90"
            r="46"
            fill={unconfigured ? 'rgba(148,163,184,0.06)' : 'rgba(16,185,129,0.12)'}
            stroke={unconfigured ? '#64748b' : '#10b981'}
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />

          {/* HQ center point */}
          <circle cx="120" cy="90" r="5" fill="#3b82f6" stroke="#93c5fd" strokeWidth="1.5" />
          <text x="120" y="106" textAnchor="middle" fill="#94a3b8" fontSize="8" fontWeight="600">
            {unconfigured ? 'HQ Not Configured' : `HQ Center (${radiusMeters}m)`}
          </text>

          {!unconfigured && employeeDistanceMeters !== undefined && (
            <g
              transform={`translate(${120 + markerOffsetPx}, ${90 - Math.round(markerOffsetPx * 0.25)})`}
            >
              <circle r="10" fill={inside ? '#10b981' : '#f59e0b'} fillOpacity="0.25" />
              <circle
                r="4.5"
                fill={inside ? '#34d399' : '#fbbf24'}
                stroke="#0f172a"
                strokeWidth="1.5"
              />
              <text
                x="0"
                y="-11"
                textAnchor="middle"
                fill={inside ? '#6ee7b7' : '#fcd34d'}
                fontSize="8"
                fontFamily="monospace"
              >
                {employeeDistanceMeters > 999
                  ? `${(employeeDistanceMeters / 1000).toFixed(1)}km`
                  : `${employeeDistanceMeters}m`}
              </text>
            </g>
          )}
        </svg>
      </div>

      <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5 truncate">
          <Navigation className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          {unconfigured
            ? 'Configure office HQ coordinates in Admin Settings'
            : `${employeeLabel} (${officeLatitude?.toFixed(4)}, ${officeLongitude?.toFixed(4)})`}
        </span>
        <span className="font-mono text-slate-400">
          {gpsAccuracyMeters !== undefined
            ? `GPS Acc: ${gpsAccuracyMeters}m (Max ${HRMS_POLICY.MAX_GPS_ACCURACY_METERS}m)`
            : `Max GPS Accuracy: ${HRMS_POLICY.MAX_GPS_ACCURACY_METERS}m`}
        </span>
      </div>
    </div>
  );
};
