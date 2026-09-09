export class NetcodeProfileValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "NetcodeProfileValidationError";
    }
}
function record(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new NetcodeProfileValidationError("netcode profile must be an object");
    }
    return value;
}
function finiteNumber(value, name) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new NetcodeProfileValidationError(`${name} must be a finite number`);
    }
    return value;
}
function integerInRange(value, name, minimum, maximum) {
    const number = finiteNumber(value, name);
    if (!Number.isInteger(number) || number < minimum || number > maximum) {
        throw new NetcodeProfileValidationError(`${name} must be an integer between ${minimum} and ${maximum}`);
    }
    return number;
}
function milliseconds(value, name) {
    const number = finiteNumber(value, name);
    if (number < 0 || number > 10_000) {
        throw new NetcodeProfileValidationError(`${name} must be between 0 and 10000 milliseconds`);
    }
    return number;
}
function lagCompensation(value) {
    if (value === false)
        return false;
    const input = record(value);
    const maxRewindMs = milliseconds(input.maxRewindMs, "lagCompensation.maxRewindMs");
    if (maxRewindMs <= 0) {
        throw new NetcodeProfileValidationError("lagCompensation.maxRewindMs must be greater than zero");
    }
    return { maxRewindMs };
}
/**
 * Validates untrusted manifest data and returns a normalized, detached profile.
 * The limits are deliberately conservative for browser mini games; a game can
 * choose lower values without changing the shared netcode pipeline.
 */
export function validateNetcodeProfile(value) {
    const input = record(value);
    const profile = input.profile;
    if (profile !== "event-sync" && profile !== "realtime-kinematic" && profile !== "custom-physics") {
        throw new NetcodeProfileValidationError("profile must be event-sync, realtime-kinematic, or custom-physics");
    }
    const tickRate = integerInRange(input.tickRate, "tickRate", 1, 120);
    const minimumSnapshotRate = profile === "event-sync" ? 0 : 1;
    const snapshotRate = integerInRange(input.snapshotRate, "snapshotRate", minimumSnapshotRate, 120);
    if (snapshotRate > tickRate) {
        throw new NetcodeProfileValidationError("snapshotRate cannot exceed tickRate");
    }
    const interpolationMs = milliseconds(input.interpolationMs, "interpolationMs");
    const maxExtrapolationMs = milliseconds(input.maxExtrapolationMs, "maxExtrapolationMs");
    const prediction = input.prediction;
    const compensation = lagCompensation(input.lagCompensation);
    if (profile === "event-sync") {
        if (prediction !== "none") {
            throw new NetcodeProfileValidationError("event-sync requires prediction to be none");
        }
        if (interpolationMs !== 0 || maxExtrapolationMs !== 0) {
            throw new NetcodeProfileValidationError("event-sync does not use interpolation or extrapolation");
        }
        if (compensation !== false) {
            throw new NetcodeProfileValidationError("event-sync does not support lag compensation");
        }
        return {
            profile,
            tickRate,
            snapshotRate,
            prediction,
            interpolationMs: 0,
            maxExtrapolationMs: 0,
            lagCompensation: false
        };
    }
    if (profile === "realtime-kinematic") {
        if (prediction !== "local-player") {
            throw new NetcodeProfileValidationError("realtime-kinematic requires local-player prediction");
        }
        return {
            profile,
            tickRate,
            snapshotRate,
            prediction,
            interpolationMs,
            maxExtrapolationMs,
            lagCompensation: compensation
        };
    }
    if (prediction !== "custom") {
        throw new NetcodeProfileValidationError("custom-physics requires custom prediction");
    }
    return {
        profile,
        tickRate,
        snapshotRate,
        prediction,
        interpolationMs,
        maxExtrapolationMs,
        lagCompensation: compensation
    };
}
/** Compile-time helper that also applies runtime validation to manifest data. */
export function defineNetcodeProfile(profile) {
    return validateNetcodeProfile(profile);
}
//# sourceMappingURL=profile.js.map