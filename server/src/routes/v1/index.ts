import { Router } from 'express';
import { healthRouter } from './health.js';
import { authRouter } from './auth.js';
import { adminRouter } from './admin.js';
import { employeeRouter } from './employee.js';
import { notificationsRouter } from './notifications.js';

export const v1Router = Router();

v1Router.use('/health', healthRouter);
v1Router.use('/auth', authRouter);
v1Router.use('/admin', adminRouter);
v1Router.use('/employee', employeeRouter);
v1Router.use('/notifications', notificationsRouter);
