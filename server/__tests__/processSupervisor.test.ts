import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the exported functions' behavior without spawning real processes
// by checking that the module exports the expected interface

describe('Process Supervisor', () => {
  it('exports startPiperTTSService', async () => {
    const mod = await import('../services/processSupervisor');
    expect(typeof mod.startPiperTTSService).toBe('function');
  });

  it('exports startSpeakerService', async () => {
    const mod = await import('../services/processSupervisor');
    expect(typeof mod.startSpeakerService).toBe('function');
  });

  it('exports shutdownAllProcesses', async () => {
    const mod = await import('../services/processSupervisor');
    expect(typeof mod.shutdownAllProcesses).toBe('function');
  });

  it('shutdownAllProcesses does not throw when no processes running', async () => {
    const mod = await import('../services/processSupervisor');
    expect(() => mod.shutdownAllProcesses()).not.toThrow();
  });
});
