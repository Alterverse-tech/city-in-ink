export function simulateKinematicMovement(state, input, durationMs, config, resolveMovement) {
    const length = Math.hypot(input.move.x, input.move.z);
    const scale = length > 1 ? 1 / length : 1;
    const directionX = input.move.x * scale;
    const directionZ = input.move.z * scale;
    const seconds = Math.max(0, durationMs) / 1000;
    const velocity = {
        x: directionX * config.moveSpeed,
        y: 0,
        z: directionZ * config.moveSpeed
    };
    const desiredPosition = {
        x: state.position.x + velocity.x * seconds,
        y: state.position.y,
        z: state.position.z + velocity.z * seconds
    };
    if (config.minY !== undefined)
        desiredPosition.y = Math.max(config.minY, desiredPosition.y);
    if (config.maxY !== undefined)
        desiredPosition.y = Math.min(config.maxY, desiredPosition.y);
    const position = resolveMovement ? resolveMovement({ player: state, desiredPosition, durationMs }) : desiredPosition;
    const moving = Math.hypot(velocity.x, velocity.z) > 0.001;
    return {
        ...state,
        position: { ...position },
        velocity,
        yaw: input.yaw,
        animation: moving ? "move" : "idle"
    };
}
//# sourceMappingURL=kinematic.js.map