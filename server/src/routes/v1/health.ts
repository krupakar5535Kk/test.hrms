import { Router, Request, Response } from 'express';
import { ApiResponse } from '@hrms/shared';
import { env } from '../../config/env.js';

export const healthRouter = Router();

export interface HealthStatusData {
  status: 'ok' | 'degraded' | 'error';
  service: string;
  version: string;
  environment: string;
  timestamp: string;
  uptimeSeconds: number;
  memory: {
    rssMb: number;
    heapUsedMb: number;
  };
}

healthRouter.get('/', (_req: Request, res: Response<ApiResponse<HealthStatusData>>) => {
  const mem = process.memoryUsage();

  const data: HealthStatusData = {
    status: 'ok',
    service: 'hrms-api',
    version: '1.0.0',
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    memory: {
      rssMb: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
      heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
    },
  };

  res.status(200).json({
    success: true,
    data,
    meta: {
      timestamp: data.timestamp,
    },
  });
});
