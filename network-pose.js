// One authority unit = 100 city metres. Flight at 76 m/s stays within the
// generic movement profile, without altering the local controls or camera.
export const METRES_PER_UNIT = 100;
// Added on encode and removed on decode, so it cancels out between peers and
// only keeps the transmitted y positive for the authority. Change one use and
// remote birds fly at the wrong height; change both or neither.
const ALTITUDE_OFFSET = 20;
export const INPUT_STEP = 0.025;

export function encodePose(position, yaw, flying = true) {
  return { x: position.x / METRES_PER_UNIT, y: position.y / METRES_PER_UNIT + ALTITUDE_OFFSET,
    z: position.z / METRES_PER_UNIT, yaw, char: flying ? 1 : 0 };
}

export function decodePose(sample) {
  if (!sample?.position) return null;
  const position = { x: sample.position.x * METRES_PER_UNIT,
    y: (sample.position.y - ALTITUDE_OFFSET) * METRES_PER_UNIT,
    z: sample.position.z * METRES_PER_UNIT };
  if (!Object.values(position).every(Number.isFinite) || !Number.isFinite(sample.yaw)) return null;
  // Reject the authority's uninitialized/default spawn and out-of-city entities.
  if (position.x < -7000 || position.x > 5500 || position.z < -6000 || position.z > 5800 || position.y < -2 || position.y > 800) return null;
  const velocity = { x: (sample.velocity?.x || 0) * METRES_PER_UNIT,
    y: (sample.velocity?.y || 0) * METRES_PER_UNIT, z: (sample.velocity?.z || 0) * METRES_PER_UNIT };
  return { position, velocity, yaw: sample.yaw };
}
