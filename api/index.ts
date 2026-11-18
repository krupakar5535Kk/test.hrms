import type { Request, Response } from 'express';

let appInstance: any = null;

async function getApp() {
  if (!appInstance) {
    const { createApp } = await import('../server/src/app.js');
    appInstance = createApp();
  }
  return appInstance;
}

export default async function handler(req: Request, res: Response) {
  const app = await getApp();
  return app(req, res);
}
