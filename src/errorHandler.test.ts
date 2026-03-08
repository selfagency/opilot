import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { reportError as ReportErrorFn } from './errorHandler.js';

describe('reportError', () => {
  let reportError: typeof ReportErrorFn;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('vscode', () => ({
      window: {
        showErrorMessage: vi.fn().mockResolvedValue(undefined),
      },
    }));
    const mod = await import('./errorHandler.js');
    reportError = mod.reportError;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs the error message via the provided logger', async () => {
    const error = vi.fn();
    const logger = { info: vi.fn(), warn: vi.fn(), error, debug: vi.fn(), exception: vi.fn() };

    reportError(logger as any, 'Something failed', new Error('boom'));

    expect(error).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Something failed'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('includes the stack trace in the log message when available', () => {
    const error = vi.fn();
    const logger = { info: vi.fn(), warn: vi.fn(), error, debug: vi.fn(), exception: vi.fn() };
    const err = new Error('with stack');

    reportError(logger as any, 'Context', err);

    const logArg: string = error.mock.calls[0][0];
    expect(logArg).toContain(err.message);
  });

  it('logs a non-Error value as a string', () => {
    const error = vi.fn();
    const logger = { info: vi.fn(), warn: vi.fn(), error, debug: vi.fn(), exception: vi.fn() };

    reportError(logger as any, 'Unexpected value', 'just a string');

    expect(error).toHaveBeenCalledWith(expect.stringContaining('just a string'));
  });

  it('does not show error dialog by default (showToUser: false)', async () => {
    const { window } = await import('vscode');
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), exception: vi.fn() };

    reportError(logger as any, 'Silent error', new Error('hidden'));

    // Flush microtasks
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('shows error dialog when showToUser: true', async () => {
    const { window } = await import('vscode');
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), exception: vi.fn() };

    reportError(logger as any, 'Visible error', new Error('user-facing'), { showToUser: true });

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(window.showErrorMessage).toHaveBeenCalledOnce();
    expect(window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('user-facing'));
  });

  it('does not throw when logger is undefined', () => {
    expect(() => reportError(undefined, 'No logger', new Error('test'))).not.toThrow();
  });

  it('does not throw when logger.error throws internally', () => {
    const throwingLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn().mockImplementation(() => { throw new Error('logger broken'); }),
      debug: vi.fn(),
      exception: vi.fn(),
    };

    expect(() => reportError(throwingLogger as any, 'msg', new Error('x'))).not.toThrow();
  });

  it('handles null error value without throwing', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), exception: vi.fn() };
    expect(() => reportError(logger as any, 'null error', null)).not.toThrow();
  });
});
