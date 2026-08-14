import { describe, expect, it } from 'vitest';
import { DIFFICULTY_TIERS } from '../../src/sim/difficultyConstants';

describe('DIFFICULTY_TIERS', () => {
  it('has all three difficulty tiers', () => {
    expect(Object.keys(DIFFICULTY_TIERS).sort()).toEqual(['easy', 'hard', 'medium']);
  });

  it('increases shoot range and decreases aim noise as difficulty rises (harder CPU shoots from further, more accurately)', () => {
    const { easy, medium, hard } = DIFFICULTY_TIERS;
    expect(easy.shootRangeSq as number).toBeLessThan(medium.shootRangeSq as number);
    expect(medium.shootRangeSq as number).toBeLessThan(hard.shootRangeSq as number);
    expect(easy.aimNoiseRange).toBeGreaterThan(medium.aimNoiseRange);
    expect(medium.aimNoiseRange).toBeGreaterThan(hard.aimNoiseRange);
    expect(hard.aimNoiseRange).toBe(0);
  });
});
