import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createVoiceFSM } from '../voiceFSM';

describe('VoiceFSM - State Machine', () => {
  let fsm: ReturnType<typeof createVoiceFSM>;

  beforeEach(() => {
    vi.useFakeTimers();
    fsm = createVoiceFSM();
  });

  afterEach(() => {
    fsm.destroy();
    vi.useRealTimers();
  });

  describe('Initial State', () => {
    it('should start in idle state', () => {
      expect(fsm.getState()).toBe('idle');
    });

    it('should have no error initially', () => {
      const context = fsm.getContext();
      expect(context.error).toBeNull();
    });

    it('should not be in degraded mode initially', () => {
      expect(fsm.isDegraded()).toBe(false);
    });
  });

  describe('Valid Transitions', () => {
    it('should transition from idle to unlocking', () => {
      fsm.transition({ type: 'UNLOCK' });
      expect(fsm.getState()).toBe('unlocking');
    });

    it('should transition from unlocking to idle on success', () => {
      fsm.transition({ type: 'UNLOCK' });
      fsm.transition({ type: 'UNLOCK_SUCCESS' });
      expect(fsm.getState()).toBe('idle');
    });

    it('should transition from idle to listening', () => {
      fsm.transition({ type: 'START_LISTENING' });
      expect(fsm.getState()).toBe('listening');
    });

    it('should transition from listening to processing', () => {
      fsm.transition({ type: 'START_LISTENING' });
      fsm.transition({ type: 'PROCESS_AUDIO' });
      expect(fsm.getState()).toBe('processing');
    });

    it('should transition from processing to idle on complete', () => {
      fsm.transition({ type: 'START_LISTENING' });
      fsm.transition({ type: 'PROCESS_AUDIO' });
      fsm.transition({ type: 'PROCESS_COMPLETE' });
      expect(fsm.getState()).toBe('idle');
    });

    it('should transition from idle to speaking', () => {
      fsm.transition({ type: 'START_SPEAKING' });
      expect(fsm.getState()).toBe('speaking');
    });

    it('should transition from speaking to idle on complete', () => {
      fsm.transition({ type: 'START_SPEAKING' });
      fsm.transition({ type: 'SPEAKING_COMPLETE' });
      expect(fsm.getState()).toBe('idle');
    });
  });

  describe('Invalid Transitions', () => {
    it('should not transition from idle to processing directly', () => {
      fsm.transition({ type: 'PROCESS_AUDIO' });
      expect(fsm.getState()).toBe('idle');
    });

    it('should not transition from speaking to listening directly', () => {
      fsm.transition({ type: 'START_SPEAKING' });
      fsm.transition({ type: 'START_LISTENING' });
      expect(fsm.getState()).toBe('speaking');
    });

    it('should not transition from unlocking to speaking', () => {
      fsm.transition({ type: 'UNLOCK' });
      fsm.transition({ type: 'START_SPEAKING' });
      expect(fsm.getState()).toBe('unlocking');
    });
  });

  describe('Error Handling', () => {
    it('should transition to error state on ERROR action', () => {
      fsm.transition({ type: 'START_LISTENING' });
      fsm.transition({ type: 'ERROR', error: 'network' });
      expect(fsm.getState()).toBe('error');
    });

    it('should store error information', () => {
      fsm.transition({ type: 'ERROR', error: 'not-allowed' });
      const context = fsm.getContext();
      expect(context.error).not.toBeNull();
      expect(context.error?.code).toBe('not-allowed');
    });

    it('should increment failure count on errors', () => {
      fsm.transition({ type: 'ERROR', error: 'network' });
      let context = fsm.getContext();
      expect(context.failureCount).toBe(1);
      
      fsm.transition({ type: 'RECOVER' });
      fsm.transition({ type: 'ERROR', error: 'network' });
      context = fsm.getContext();
      expect(context.failureCount).toBe(2);
    });

    it('should enter degraded mode after 3 failures', () => {
      for (let i = 0; i < 3; i++) {
        fsm.transition({ type: 'ERROR', error: 'network' });
        if (i < 2) fsm.transition({ type: 'RECOVER' });
      }
      expect(fsm.isDegraded()).toBe(true);
    });

    it('should recover from error state', () => {
      fsm.transition({ type: 'ERROR', error: 'network' });
      fsm.transition({ type: 'RECOVER' });
      expect(fsm.getState()).toBe('idle');
    });
  });

  describe('Reset', () => {
    it('should reset to idle from any state', () => {
      fsm.transition({ type: 'START_LISTENING' });
      fsm.transition({ type: 'RESET' });
      expect(fsm.getState()).toBe('idle');
    });

    it('should clear error on reset', () => {
      fsm.transition({ type: 'ERROR', error: 'network' });
      fsm.transition({ type: 'RESET' });
      const context = fsm.getContext();
      expect(context.error).toBeNull();
    });

    it('should reset failure count on reset', () => {
      fsm.transition({ type: 'ERROR', error: 'network' });
      fsm.transition({ type: 'RESET' });
      const context = fsm.getContext();
      expect(context.failureCount).toBe(0);
    });

    it('should preserve degraded mode on reset', () => {
      for (let i = 0; i < 3; i++) {
        fsm.transition({ type: 'ERROR', error: 'network' });
        fsm.transition({ type: 'RECOVER' });
      }
      fsm.transition({ type: 'RESET' });
      expect(fsm.isDegraded()).toBe(true);
    });

    it('should clear degraded mode explicitly', () => {
      for (let i = 0; i < 3; i++) {
        fsm.transition({ type: 'ERROR', error: 'network' });
        fsm.transition({ type: 'RECOVER' });
      }
      fsm.resetDegradedMode();
      expect(fsm.isDegraded()).toBe(false);
    });
  });

  describe('Timeouts', () => {
    it('should auto-reset from unlocking after timeout', () => {
      fsm.transition({ type: 'UNLOCK' });
      expect(fsm.getState()).toBe('unlocking');
      
      vi.advanceTimersByTime(11000);
      expect(fsm.getState()).toBe('idle');
    });

    it('should auto-reset from processing after timeout', () => {
      fsm.transition({ type: 'START_LISTENING' });
      fsm.transition({ type: 'PROCESS_AUDIO' });
      expect(fsm.getState()).toBe('processing');
      
      vi.advanceTimersByTime(31000);
      expect(fsm.getState()).toBe('idle');
    });

    it('should set timeout error message', () => {
      fsm.transition({ type: 'UNLOCK' });
      vi.advanceTimersByTime(11000);
      
      const context = fsm.getContext();
      expect(context.error?.code).toBe('timeout');
    });

    it('should clear timeout when transitioning normally', () => {
      fsm.transition({ type: 'UNLOCK' });
      fsm.transition({ type: 'UNLOCK_SUCCESS' });
      
      vi.advanceTimersByTime(15000);
      expect(fsm.getState()).toBe('idle');
      expect(fsm.getContext().error).toBeNull();
    });
  });

  describe('Force Reset', () => {
    it('should force reset from any state', () => {
      fsm.transition({ type: 'START_LISTENING' });
      fsm.transition({ type: 'PROCESS_AUDIO' });
      fsm.forceReset();
      expect(fsm.getState()).toBe('idle');
    });

    it('should clear timeouts on force reset', () => {
      fsm.transition({ type: 'UNLOCK' });
      fsm.forceReset();
      vi.advanceTimersByTime(15000);
      expect(fsm.getContext().error).toBeNull();
    });
  });

  describe('Transition Log', () => {
    it('should log transitions', () => {
      fsm.transition({ type: 'START_LISTENING' });
      fsm.transition({ type: 'STOP_LISTENING' });
      
      const log = fsm.getTransitionLog();
      expect(log.length).toBe(2);
      expect(log[0].from).toBe('idle');
      expect(log[0].to).toBe('listening');
    });

    it('should limit log size', () => {
      for (let i = 0; i < 60; i++) {
        fsm.transition({ type: 'START_LISTENING' });
        fsm.transition({ type: 'STOP_LISTENING' });
      }
      
      const log = fsm.getTransitionLog();
      expect(log.length).toBeLessThanOrEqual(50);
    });
  });

  describe('State Duration', () => {
    it('should track state entry time', () => {
      fsm.transition({ type: 'START_LISTENING' });
      vi.advanceTimersByTime(1000);
      
      const duration = fsm.getStateDuration();
      expect(duration).toBeGreaterThanOrEqual(1000);
    });
  });

  describe('Subscription', () => {
    it('should notify subscribers on state change', () => {
      const callback = vi.fn();
      fsm.subscribe(callback);
      
      fsm.transition({ type: 'START_LISTENING' });
      expect(callback).toHaveBeenCalled();
    });

    it('should allow unsubscribing', () => {
      const callback = vi.fn();
      const unsubscribe = fsm.subscribe(callback);
      
      unsubscribe();
      fsm.transition({ type: 'START_LISTENING' });
      expect(callback).not.toHaveBeenCalled();
    });
  });
});
