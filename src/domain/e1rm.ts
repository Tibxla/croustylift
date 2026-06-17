export function estimateE1rm(weightKg: number, reps: number, rir: number): number {
  if (weightKg < 0) {
    throw new Error(`weightKg must not be negative, received ${weightKg}`)
  }
  if (!Number.isInteger(reps)) {
    throw new Error(`reps must be an integer, received ${reps}`)
  }
  if (reps < 1) {
    throw new Error(`reps must be at least 1, received ${reps}`)
  }
  if (!Number.isInteger(rir)) {
    throw new Error(`rir must be an integer, received ${rir}`)
  }
  if (rir < 0) {
    throw new Error(`rir must not be negative, received ${rir}`)
  }
  return weightKg * (1 + (reps + rir) / 30)
}
