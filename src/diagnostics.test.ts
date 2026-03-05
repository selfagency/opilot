import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiagnosticsLogLevel } from './diagnostics.js';

describe('diagnostics', () => {
  let mockOutputChannel: any;
  let createDiagnosticsLogger: any;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock('vscode', () => ({
      workspace: {
        getConfiguration: vi.fn(() => ({
          get: vi.fn(),
        })),
      },
    }));

    const diagnosticsModule = await import('./diagnostics.js');
    createDiagnosticsLogger = diagnosticsModule.createDiagnosticsLogger;

    mockOutputChannel = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  });

  describe('getConfiguredLogLevel', () => {
    it('returns debug when configured', async () => {
      vi.resetModules();
      vi.doMock('vscode', () => ({
        workspace: {
          getConfiguration: vi.fn(() => ({
            get: vi.fn((key: string) => {
              if (key === 'diagnostics.logLevel') return 'debug';
              return undefined;
            }),
          })),
        },
      }));
      const mod = await import('./diagnostics.js');
      expect(mod.getConfiguredLogLevel()).toBe('debug');
    });

    it('returns info when configured', async () => {
      vi.resetModules();
      vi.doMock('vscode', () => ({
        workspace: {
          getConfiguration: vi.fn(() => ({
            get: vi.fn((key: string) => {
              if (key === 'diagnostics.logLevel') return 'info';
              return undefined;
            }),
          })),
        },
      }));
      const mod = await import('./diagnostics.js');
      expect(mod.getConfiguredLogLevel()).toBe('info');
    });

    it('returns warn when configured', async () => {
      vi.resetModules();
      vi.doMock('vscode', () => ({
        workspace: {
          getConfiguration: vi.fn(() => ({
            get: vi.fn((key: string) => {
              if (key === 'diagnostics.logLevel') return 'warn';
              return undefined;
            }),
          })),
        },
      }));
      const mod = await import('./diagnostics.js');
      expect(mod.getConfiguredLogLevel()).toBe('warn');
    });

    it('returns error when configured', async () => {
      vi.resetModules();
      vi.doMock('vscode', () => ({
        workspace: {
          getConfiguration: vi.fn(() => ({
            get: vi.fn((key: string) => {
              if (key === 'diagnostics.logLevel') return 'error';
              return undefined;
            }),
          })),
        },
      }));
      const mod = await import('./diagnostics.js');
      expect(mod.getConfiguredLogLevel()).toBe('error');
    });

    it('returns info as default when invalid value configured', async () => {
      vi.resetModules();
      vi.doMock('vscode', () => ({
        workspace: {
          getConfiguration: vi.fn(() => ({
            get: vi.fn((key: string) => {
              if (key === 'diagnostics.logLevel') return 'invalid';
              return undefined;
            }),
          })),
        },
      }));
      const mod = await import('./diagnostics.js');
      expect(mod.getConfiguredLogLevel()).toBe('info');
    });

    it('returns info as default when undefined', async () => {
      vi.resetModules();
      vi.doMock('vscode', () => ({
        workspace: {
          getConfiguration: vi.fn(() => ({
            get: vi.fn(() => undefined),
          })),
        },
      }));
      const mod = await import('./diagnostics.js');
      expect(mod.getConfiguredLogLevel()).toBe('info');
    });
  });

  describe('createDiagnosticsLogger', () => {
    it('logs debug messages when level is debug', () => {
      const logger = createDiagnosticsLogger(mockOutputChannel, () => 'debug');
      logger.debug('test message');
      expect(mockOutputChannel.debug).toHaveBeenCalledWith('test message');
    });

    it('does not log debug messages when level is info', () => {
      const logger = createDiagnosticsLogger(mockOutputChannel, () => 'info');
      logger.debug('test message');
      expect(mockOutputChannel.debug).not.toHaveBeenCalled();
    });

    it('logs info messages when level is debug', () => {
      const logger = createDiagnosticsLogger(mockOutputChannel, () => 'debug');
      logger.info('test message');
      expect(mockOutputChannel.info).toHaveBeenCalledWith('test message');
    });

    it('logs info messages when level is info', () => {
      const logger = createDiagnosticsLogger(mockOutputChannel, () => 'info');
      logger.info('test message');
      expect(mockOutputChannel.info).toHaveBeenCalledWith('test message');
    });

    it('does not log info messages when level is warn', () => {
      const logger = createDiagnosticsLogger(mockOutputChannel, () => 'warn');
      logger.info('test message');
      expect(mockOutputChannel.info).not.toHaveBeenCalled();
    });

    it('logs warn messages when level is warn', () => {
      const logger = createDiagnosticsLogger(mockOutputChannel, () => 'warn');
      logger.warn('test message');
      expect(mockOutputChannel.warn).toHaveBeenCalledWith('test message');
    });

    it('does not log warn messages when level is error', () => {
      const logger = createDiagnosticsLogger(mockOutputChannel, () => 'error');
      logger.warn('test message');
      expect(mockOutputChannel.warn).not.toHaveBeenCalled();
    });

    it('logs error messages when level is error', () => {
      const logger = createDiagnosticsLogger(mockOutputChannel, () => 'error');
      logger.error('test message');
      expect(mockOutputChannel.error).toHaveBeenCalledWith('test message');
    });

    it('logs exception with Error object', () => {
      const logger = createDiagnosticsLogger(mockOutputChannel, () => 'error');
      const error = new Error('Test error');
      logger.exception('context', error);
      expect(mockOutputChannel.error).toHaveBeenCalledWith(expect.stringContaining('context: Test error'));
    });

    it('logs exception with non-Error object', () => {
      const logger = createDiagnosticsLogger(mockOutputChannel, () => 'error');
      logger.exception('context', 'plain string error');
      expect(mockOutputChannel.error).toHaveBeenCalledWith(expect.stringContaining('context: plain string error'));
    });

    it('logs exception with stack trace', () => {
      const logger = createDiagnosticsLogger(mockOutputChannel, () => 'error');
      const error = new Error('Test error with stack');
      error.stack = 'Error: Test error with stack\n    at test.js:1:1';
      logger.exception('context', error);
      expect(mockOutputChannel.error).toHaveBeenCalledWith(expect.stringContaining('context: Test error with stack'));
      expect(mockOutputChannel.error).toHaveBeenCalledWith(expect.stringContaining('at test.js:1:1'));
    });

    it('skips exception logging when level is higher than error', () => {
      const logger = createDiagnosticsLogger(mockOutputChannel, () => 'error');
      const error = new Error('Test error');
      logger.exception('context', error);
      expect(mockOutputChannel.error).toHaveBeenCalled();
    });

    it('handles dynamic log level changes', () => {
      let level: DiagnosticsLogLevel = 'info';
      const logger = createDiagnosticsLogger(mockOutputChannel, () => level);

      logger.debug('message1');
      expect(mockOutputChannel.debug).not.toHaveBeenCalled();

      level = 'debug';
      logger.debug('message2');
      expect(mockOutputChannel.debug).toHaveBeenCalledWith('message2');
    });

    it('logs messages at all levels correctly ordered', () => {
      const logger = createDiagnosticsLogger(mockOutputChannel, () => 'debug');

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(mockOutputChannel.debug).toHaveBeenCalledWith('debug message');
      expect(mockOutputChannel.info).toHaveBeenCalledWith('info message');
      expect(mockOutputChannel.warn).toHaveBeenCalledWith('warn message');
      expect(mockOutputChannel.error).toHaveBeenCalledWith('error message');
    });
  });
});
