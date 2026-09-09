function defaultClone(value) {
    return structuredClone(value);
}
/**
 * Turns fixed-step local prediction targets into a render-rate presentation.
 *
 * The prediction engine remains authoritative for the logical local state.
 * This timeline deliberately trails it by roughly one input step so displays
 * faster than the input cadence see continuous motion instead of step changes.
 */
export class LocalPresentationTimeline {
    hooks;
    stepDurationMs;
    now;
    cloneState;
    from;
    target;
    startedAtMs = 0;
    constructor(hooks, options) {
        this.hooks = hooks;
        this.stepDurationMs = options.stepDurationMs;
        if (!Number.isFinite(this.stepDurationMs) || this.stepDurationMs < 0) {
            throw new Error("stepDurationMs must be a non-negative finite number");
        }
        this.now = options.now ?? Date.now;
        this.cloneState = options.cloneState ?? defaultClone;
    }
    reset(state, nowMs = this.now()) {
        assertFiniteTime(nowMs);
        this.target = this.cloneState(state);
        this.from = undefined;
        this.startedAtMs = nowMs;
    }
    retarget(state, nowMs = this.now()) {
        assertFiniteTime(nowMs);
        const next = this.cloneState(state);
        if (this.target === undefined || this.hooks.shouldSnap?.(this.cloneState(this.target), this.cloneState(next))) {
            this.reset(next, nowMs);
            return;
        }
        if (this.hooks.equivalent?.(this.cloneState(this.target), this.cloneState(next))) {
            // Preserve the active position blend while refreshing animation and
            // other discrete fields carried by the latest prediction target.
            this.target = next;
            return;
        }
        const visible = this.sample(nowMs);
        if (this.stepDurationMs === 0) {
            this.reset(next, nowMs);
            return;
        }
        this.from = visible;
        this.target = next;
        this.startedAtMs = nowMs;
    }
    sample(nowMs = this.now()) {
        assertFiniteTime(nowMs);
        if (this.target === undefined)
            return undefined;
        if (this.from === undefined || this.stepDurationMs === 0)
            return this.cloneState(this.target);
        const alpha = Math.max(0, Math.min(1, (nowMs - this.startedAtMs) / this.stepDurationMs));
        if (alpha >= 1) {
            this.from = undefined;
            return this.cloneState(this.target);
        }
        return this.cloneState(this.hooks.interpolate(this.cloneState(this.from), this.cloneState(this.target), alpha));
    }
    clear() {
        this.from = undefined;
        this.target = undefined;
        this.startedAtMs = 0;
    }
    transitioning(nowMs = this.now()) {
        assertFiniteTime(nowMs);
        if (this.from === undefined)
            return false;
        if (this.stepDurationMs === 0 || nowMs - this.startedAtMs >= this.stepDurationMs) {
            this.from = undefined;
            return false;
        }
        return true;
    }
}
function assertFiniteTime(nowMs) {
    if (!Number.isFinite(nowMs))
        throw new Error("presentation time must be finite");
}
//# sourceMappingURL=local-presentation-timeline.js.map