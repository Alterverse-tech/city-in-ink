function defaultClone(value) {
    return structuredClone(value);
}
function assertAcknowledgedSequence(sequence) {
    if (!Number.isSafeInteger(sequence) || sequence < -1) {
        throw new Error("acknowledged input sequence must be a safe integer greater than or equal to -1");
    }
}
function defaultInputProgress(state) {
    if (!state || typeof state !== "object")
        return undefined;
    const progress = state.inputProgress;
    if (!progress || typeof progress !== "object")
        return undefined;
    const { seq, processedDurationMs } = progress;
    if (!Number.isSafeInteger(seq) || (seq ?? -1) < 0)
        return undefined;
    if (typeof processedDurationMs !== "number" || !Number.isFinite(processedDurationMs) || processedDurationMs <= 0) {
        return undefined;
    }
    return { seq: seq, processedDurationMs };
}
/**
 * Game-agnostic client prediction and reconciliation pipeline.
 *
 * Logical state is corrected immediately. renderCurrent() can keep the visual
 * state smooth by blending from the pre-correction state while new local input
 * continues to be simulated on both sides of that blend.
 */
export class PredictionEngine {
    hooks;
    state;
    lastAuthoritativeState;
    pending = [];
    correctionDurationMs;
    correctionEpsilon;
    now;
    cloneState;
    cloneInput;
    correctionFrom;
    correctionStartedAtMs = 0;
    lastAcknowledgedSeq;
    lastPredictedSeq;
    constructor(initialState, hooks, options = {}) {
        this.hooks = hooks;
        this.correctionDurationMs = options.correctionDurationMs ?? 100;
        if (!Number.isFinite(this.correctionDurationMs) || this.correctionDurationMs < 0) {
            throw new Error("correctionDurationMs must be a non-negative finite number");
        }
        this.correctionEpsilon = options.correctionEpsilon ?? 0.0001;
        if (!Number.isFinite(this.correctionEpsilon) || this.correctionEpsilon < 0) {
            throw new Error("correctionEpsilon must be a non-negative finite number");
        }
        this.now = options.now ?? Date.now;
        this.cloneState = options.cloneState ?? defaultClone;
        this.cloneInput = options.cloneInput ?? defaultClone;
        this.state = this.cloneState(initialState);
        this.lastAuthoritativeState = this.cloneState(initialState);
        this.lastAcknowledgedSeq = this.hooks.acknowledgedInput(this.state);
        assertAcknowledgedSequence(this.lastAcknowledgedSeq);
        this.lastPredictedSeq = this.lastAcknowledgedSeq;
    }
    predict(input) {
        if (!Number.isSafeInteger(input.seq) || input.seq < 0) {
            throw new Error("prediction input sequence must be a non-negative safe integer");
        }
        if (input.seq <= this.lastPredictedSeq) {
            throw new Error("prediction inputs must have strictly increasing sequence numbers");
        }
        this.settleExpiredCorrection(this.now());
        const storedInput = this.cloneInput(input);
        this.pending.push(storedInput);
        this.state = this.simulate(this.state, storedInput);
        if (this.correctionFrom !== undefined) {
            this.correctionFrom = this.simulate(this.correctionFrom, storedInput);
        }
        this.lastPredictedSeq = input.seq;
        return this.current();
    }
    reconcile(authoritative, nowMs = this.now()) {
        if (!Number.isFinite(nowMs))
            throw new Error("reconciliation time must be finite");
        const acknowledgedSeq = this.hooks.acknowledgedInput(authoritative);
        assertAcknowledgedSequence(acknowledgedSeq);
        if (acknowledgedSeq < this.lastAcknowledgedSeq) {
            return {
                state: this.current(),
                correctionDistance: 0,
                replayedInputs: this.pending.length,
                acknowledgedSeq,
                snapped: false,
                stale: true
            };
        }
        const logicalBefore = this.current();
        const visibleBefore = this.renderCurrent(nowMs);
        while (this.pending.length && this.pending[0].seq <= acknowledgedSeq)
            this.pending.shift();
        const inputProgress = this.hooks.inputProgress?.(authoritative) ?? defaultInputProgress(authoritative);
        let reconciled = this.cloneState(authoritative);
        let replayedInputs = 0;
        for (const input of this.pending) {
            const replayInput = this.remainingReplayInput(input, inputProgress, acknowledgedSeq);
            if (!replayInput)
                continue;
            reconciled = this.simulate(reconciled, replayInput);
            replayedInputs += 1;
        }
        this.state = reconciled;
        const snapped = this.hooks.shouldSnap?.(this.lastAuthoritativeState, authoritative) ?? false;
        this.lastAuthoritativeState = this.cloneState(authoritative);
        this.lastAcknowledgedSeq = acknowledgedSeq;
        this.lastPredictedSeq = Math.max(this.lastPredictedSeq, acknowledgedSeq);
        const correctionDistance = this.hooks.correctionDistance?.(logicalBefore, this.state) ?? 0;
        if (snapped || this.correctionDurationMs === 0 || !this.hooks.interpolateCorrection) {
            this.clearCorrection();
        }
        else if (!this.hooks.correctionDistance || correctionDistance > this.correctionEpsilon) {
            this.correctionFrom = this.cloneState(visibleBefore);
            this.correctionStartedAtMs = nowMs;
        }
        return {
            state: this.current(),
            correctionDistance,
            replayedInputs,
            acknowledgedSeq,
            snapped,
            stale: false
        };
    }
    current() {
        return this.cloneState(this.state);
    }
    renderCurrent(nowMs = this.now()) {
        if (!Number.isFinite(nowMs))
            throw new Error("render time must be finite");
        if (this.correctionFrom === undefined || !this.hooks.interpolateCorrection)
            return this.current();
        if (this.correctionDurationMs === 0) {
            this.clearCorrection();
            return this.current();
        }
        const alpha = Math.max(0, Math.min(1, (nowMs - this.correctionStartedAtMs) / this.correctionDurationMs));
        if (alpha >= 1) {
            this.clearCorrection();
            return this.current();
        }
        return this.cloneState(this.hooks.interpolateCorrection(this.correctionFrom, this.state, alpha));
    }
    pendingCount() {
        return this.pending.length;
    }
    pendingInputs() {
        return this.pending.map((input) => this.cloneInput(input));
    }
    acknowledgedSequence() {
        return this.lastAcknowledgedSeq;
    }
    correctionActive() {
        return this.correctionFrom !== undefined;
    }
    reset(state) {
        const acknowledgedSeq = this.hooks.acknowledgedInput(state);
        assertAcknowledgedSequence(acknowledgedSeq);
        this.pending.length = 0;
        this.state = this.cloneState(state);
        this.lastAuthoritativeState = this.cloneState(state);
        this.lastAcknowledgedSeq = acknowledgedSeq;
        this.lastPredictedSeq = acknowledgedSeq;
        this.clearCorrection();
    }
    simulate(state, input) {
        const next = this.hooks.simulateInput(this.cloneState(state), this.cloneInput(input));
        return this.cloneState(next);
    }
    remainingReplayInput(input, progress, acknowledgedSeq) {
        if (!progress || progress.seq <= acknowledgedSeq || input.seq !== progress.seq) {
            return this.cloneInput(input);
        }
        if (typeof input.durationMs !== "number" || !Number.isFinite(input.durationMs) || input.durationMs <= 0) {
            return this.cloneInput(input);
        }
        const remainingDurationMs = input.durationMs - progress.processedDurationMs;
        if (remainingDurationMs <= 0.0001)
            return undefined;
        const remaining = this.cloneInput(input);
        remaining.durationMs = remainingDurationMs;
        return remaining;
    }
    settleExpiredCorrection(nowMs) {
        if (this.correctionFrom === undefined)
            return;
        if (this.correctionDurationMs === 0 || nowMs - this.correctionStartedAtMs >= this.correctionDurationMs) {
            this.clearCorrection();
        }
    }
    clearCorrection() {
        this.correctionFrom = undefined;
        this.correctionStartedAtMs = 0;
    }
}
//# sourceMappingURL=prediction-engine.js.map