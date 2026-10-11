import { describe, expect, it } from 'vitest';
import { shouldTrigger, validateTrigger } from '../src/index.js';

const q = (bid: number | null, ask: number | null) => ({ bid, ask });

describe('shouldTrigger', () => {
  it('limit buy fires when the ask is at or below the trigger', () => {
    expect(shouldTrigger('limit_buy', 0.4, q(0.3, 0.41))).toBe(false);
    expect(shouldTrigger('limit_buy', 0.4, q(0.3, 0.4))).toBe(true);
    expect(shouldTrigger('limit_buy', 0.4, q(0.3, 0.35))).toBe(true);
  });

  it('take-profit fires when the bid reaches the trigger, stop-loss when it falls to it', () => {
    expect(shouldTrigger('take_profit', 0.7, q(0.69, 0.7))).toBe(false);
    expect(shouldTrigger('take_profit', 0.7, q(0.7, 0.71))).toBe(true);
    expect(shouldTrigger('stop_loss', 0.2, q(0.21, 0.22))).toBe(false);
    expect(shouldTrigger('stop_loss', 0.2, q(0.2, 0.22))).toBe(true);
  });

  it('never fires on a missing side', () => {
    expect(shouldTrigger('limit_buy', 0.4, q(0.3, null))).toBe(false);
    expect(shouldTrigger('take_profit', 0.7, q(null, 0.9))).toBe(false);
    expect(shouldTrigger('stop_loss', 0.2, q(null, 0.1))).toBe(false);
  });
});

describe('validateTrigger', () => {
  it('rejects an out-of-range trigger', () => {
    expect(validateTrigger('limit_buy', 0, q(null, null))).not.toBeNull();
    expect(validateTrigger('limit_buy', 1.1, q(null, null))).not.toBeNull();
  });

  it('take-profit and stop-loss must not already be crossed', () => {
    expect(validateTrigger('take_profit', 0.4, q(0.48, 0.5))).toBe('would_trigger_now');
    expect(validateTrigger('take_profit', 0.7, q(0.48, 0.5))).toBeNull();
    expect(validateTrigger('stop_loss', 0.6, q(0.48, 0.5))).toBe('would_trigger_now');
    expect(validateTrigger('stop_loss', 0.2, q(0.48, 0.5))).toBeNull();
  });

  it('a marketable limit buy is allowed, and no Quote means nothing to cross', () => {
    expect(validateTrigger('limit_buy', 0.6, q(0.48, 0.5))).toBeNull();
    expect(validateTrigger('stop_loss', 0.2, q(null, null))).toBeNull();
  });
});
