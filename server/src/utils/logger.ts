import { env } from '../config/env.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogPayload {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

class Logger {
  private formatLog(level: LogLevel, message: string, context?: Record<string, unknown>, err?: Error): string {
    const payload: LogPayload = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(context ? { context } : {}),
      ...(err ? { error: { name: err.name, message: err.message, stack: err.stack } } : {}),
    };

    if (env.NODE_ENV === 'production') {
      return JSON.stringify(payload);
    }

    const timestamp = `\x1b[90m${payload.timestamp}\x1b[0m`;
    const levelColors: Record<LogLevel, string> = {
      debug: '\x1b[34m[DEBUG]\x1b[0m',
      info: '\x1b[32m[INFO]\x1b[0m',
      warn: '\x1b[33m[WARN]\x1b[0m',
      error: '\x1b[31m[ERROR]\x1b[0m',
    };

    const color = levelColors[level];
    const contextStr = context ? ` \x1b[90m${JSON.stringify(context)}\x1b[0m` : '';
    const errStr = err?.stack ? `\n\x1b[31m${err.stack}\x1b[0m` : '';

    return `${timestamp} ${color} ${message}${contextStr}${errStr}`;
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (env.NODE_ENV !== 'production') {
      console.debug(this.formatLog('debug', message, context));
    }
  }

  info(message: string, context?: Record<string, unknown>): void {
    console.info(this.formatLog('info', message, context));
  }

  warn(message: string, context?: Record<string, unknown>): void {
    console.warn(this.formatLog('warn', message, context));
  }

  error(message: string, error?: Error | unknown, context?: Record<string, unknown>): void {
    const err = error instanceof Error ? error : undefined;
    const ctx = error instanceof Error ? context : (error as Record<string, unknown> | undefined);
    console.error(this.formatLog('error', message, ctx, err));
  }
}

export const logger = new Logger();
