function defaultClone(value) {
    return structuredClone(value);
}
/** Generic snapshot timeline for remote players, vehicles, or game entities. */
export class RemoteEntityInterpolator {
    hooks;
    buffers = new Map();
    interpolationDelayMs;
    maxExtrapolationMs;
    maxFramesPerEntity;
    cloneEntity;
    constructor(hooks, options = {}) {
        this.hooks = hooks;
        this.interpolationDelayMs = options.interpolationDelayMs ?? 100;
        this.maxExtrapolationMs = options.maxExtrapolationMs ?? 80;
        this.maxFramesPerEntity = options.maxFramesPerEntity ?? 32;
        this.cloneEntity = options.cloneEntity ?? defaultClone;
        if (!Number.isFinite(this.interpolationDelayMs) || this.interpolationDelayMs < 0) {
            throw new Error("interpolationDelayMs must be a non-negative finite number");
        }
        if (!Number.isFinite(this.maxExtrapolationMs) || this.maxExtrapolationMs < 0) {
            throw new Error("maxExtrapolationMs must be a non-negative finite number");
        }
        if (!Number.isSafeInteger(this.maxFramesPerEntity) || this.maxFramesPerEntity < 2) {
            throw new Error("maxFramesPerEntity must be an integer greater than or equal to 2");
        }
    }
    push(serverTimeMs, entities) {
        if (!Number.isFinite(serverTimeMs))
            throw new Error("serverTimeMs must be finite");
        for (const source of entities) {
            const entity = this.cloneEntity(source);
            const entityId = this.hooks.getId(entity);
            if (!entityId)
                throw new Error("interpolated entity id cannot be empty");
            const frames = this.buffers.get(entityId) ?? [];
            const latest = frames[frames.length - 1];
            if (latest && serverTimeMs <= latest.serverTimeMs)
                continue;
            if (latest && this.hooks.shouldSnap?.(latest.entity, entity))
                frames.length = 0;
            frames.push({ serverTimeMs, entity });
            if (frames.length > this.maxFramesPerEntity) {
                frames.splice(0, frames.length - this.maxFramesPerEntity);
            }
            this.buffers.set(entityId, frames);
        }
    }
    sample(entityId, estimatedServerTimeMs) {
        if (!Number.isFinite(estimatedServerTimeMs))
            throw new Error("estimatedServerTimeMs must be finite");
        const frames = this.buffers.get(entityId);
        if (!frames?.length)
            return undefined;
        const renderTimeMs = estimatedServerTimeMs - this.interpolationDelayMs;
        while (frames.length > 2 && frames[1].serverTimeMs <= renderTimeMs)
            frames.shift();
        const older = frames[0];
        const newer = frames[1];
        if (newer && renderTimeMs <= newer.serverTimeMs) {
            const durationMs = Math.max(1, newer.serverTimeMs - older.serverTimeMs);
            const alpha = Math.max(0, Math.min(1, (renderTimeMs - older.serverTimeMs) / durationMs));
            return this.cloneEntity(this.hooks.interpolate(this.cloneEntity(older.entity), this.cloneEntity(newer.entity), alpha));
        }
        const latest = newer ?? older;
        const extrapolationMs = Math.max(0, Math.min(this.maxExtrapolationMs, renderTimeMs - latest.serverTimeMs));
        if (!this.hooks.extrapolate || extrapolationMs === 0)
            return this.cloneEntity(latest.entity);
        return this.cloneEntity(this.hooks.extrapolate(this.cloneEntity(latest.entity), extrapolationMs));
    }
    remove(entityId) {
        this.buffers.delete(entityId);
    }
    clear() {
        this.buffers.clear();
    }
    entityCount() {
        return this.buffers.size;
    }
    bufferedFrameCount(entityId) {
        return this.buffers.get(entityId)?.length ?? 0;
    }
}
//# sourceMappingURL=entity-interpolator.js.map