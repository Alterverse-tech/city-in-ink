/**
 * chrona-space — putting any shape of world onto the wire.
 *
 * The wire is fixed and narrow: three position floats and one angle. That is
 * enough to describe a pose in *any* world, but only under one condition —
 *
 *     the world's "up" must be a function of position.
 *
 * Where that holds, the angle can be measured against a frame both ends rebuild
 * from the position alone, and nothing else needs to travel. Where it does not
 * (a player walking on arbitrary mesh faces, say, where two points can share a
 * position and differ in surface normal), one scalar cannot express the pose and
 * the game needs an authority that carries more — see references/world-shapes.md.
 *
 * So a world is described here by exactly one thing: `up(position)`. Everything
 * else — the tangent frame, the encoding, the decoding, the degenerate poles —
 * follows from it and is handled once, here, instead of in every game.
 *
 *   import { createPoseCodec, planet } from './chrona-space.js'
 *   const space = createPoseCodec(planet({ radius: 14 }))
 *
 *   presence.sendInput(space.encode(myPosition, myFacing))          // out
 *   const pose = space.decode(presence.sample(id))                  // in
 *
 * Plain `{x, y, z}` objects throughout, and no dependency on a math library:
 * a game converts to and from its own vector type at the boundary.
 */

const vec = (x = 0, y = 0, z = 0) => ({ x, y, z })
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a, b) => vec(
  a.y * b.z - a.z * b.y,
  a.z * b.x - a.x * b.z,
  a.x * b.y - a.y * b.x,
)
const length = a => Math.hypot(a.x, a.y, a.z)

function normalize(a, fallback = vec(0, 1, 0)) {
  const l = length(a)
  return l < 1e-9 ? { ...fallback } : vec(a.x / l, a.y / l, a.z / l)
}

const scale = (a, k) => vec(a.x * k, a.y * k, a.z * k)
const add = (a, b) => vec(a.x + b.x, a.y + b.y, a.z + b.z)
const sub = (a, b) => vec(a.x - b.x, a.y - b.y, a.z - b.z)

const REFERENCE = vec(0, 1, 0)
const FALLBACK_REFERENCE = vec(0, 0, 1)

/* ------------------------------------------------------------ world shapes */

/**
 * A shape is `{ name, up(position), ground?(position) }`.
 *
 * `up` is required and is the whole definition. `ground` is optional and
 * reports how far above the surface a position is, which most games want for
 * jump and shadow height; it is never sent, only derived.
 */

/** An ordinary level. Up is up, everywhere. */
export const flatWorld = () => Object.freeze({
  name: 'flat',
  up: () => ({ ...REFERENCE }),
  ground: position => position.y,
})

/** A planet walked on from outside. Up points away from the centre. */
export const planet = ({ radius = 1, center = vec() } = {}) => Object.freeze({
  name: 'planet',
  up: position => normalize(sub(position, center)),
  ground: position => length(sub(position, center)) - radius,
})

/** A hollow world walked on from inside. Up points back toward the centre. */
export const hollowPlanet = ({ radius = 1, center = vec() } = {}) => Object.freeze({
  name: 'hollow-planet',
  up: position => normalize(scale(sub(position, center), -1)),
  ground: position => radius - length(sub(position, center)),
})

/**
 * A ring or rotating station. `inward: true` (the default) is the habitable
 * inside surface, where up points at the axis.
 */
export const cylinder = ({ radius = 1, axis = vec(0, 1, 0), center = vec(), inward = true } = {}) => {
  const unitAxis = normalize(axis)
  const radial = position => {
    const offset = sub(position, center)
    return sub(offset, scale(unitAxis, dot(offset, unitAxis)))
  }
  return Object.freeze({
    name: inward ? 'cylinder-inside' : 'cylinder-outside',
    up: position => normalize(scale(radial(position), inward ? -1 : 1), unitAxis),
    ground: position => (inward ? radius - length(radial(position)) : length(radial(position)) - radius),
  })
}

/**
 * Anything else. Give the up vector for a position and the rest follows —
 * a heightfield's smoothed normal, a spline tube, a Möbius strip.
 *
 * The function must depend on **position only**. If it needs to know which face
 * a player is standing on, or which way they came from, the pose does not fit
 * on this wire.
 */
export const customWorld = ({ up, ground = () => 0, name = 'custom' }) => {
  if (typeof up !== 'function') throw new TypeError('customWorld requires an up(position) function')
  return Object.freeze({ name, up: position => normalize(up(position)), ground })
}

/* -------------------------------------------------------------------- codec */

/**
 * Build the encoder/decoder for one world shape.
 *
 * The tangent frame is derived from `up` by crossing it with a fixed reference
 * axis. That collapses where up is parallel to the reference — the poles of a
 * planet, the ends of a cylinder — so a second axis takes over there. Both ends
 * make the same substitution from the same position, so the angle keeps meaning
 * the same thing across the seam.
 */
export function createPoseCodec(shape) {
  if (!shape || typeof shape.up !== 'function') {
    throw new TypeError('createPoseCodec requires a world shape, e.g. planet({ radius })')
  }

  function frameAt(position) {
    const up = normalize(shape.up(position))
    let east = cross(REFERENCE, up)
    if (length(east) < 1e-3) east = cross(FALLBACK_REFERENCE, up)
    east = normalize(east)
    return { up, east, north: normalize(cross(up, east)) }
  }

  return Object.freeze({
    shape,

    /** The local frame at a point: `up`, plus the two tangent axes yaw is measured against. */
    frameAt,

    /**
     * A pose for the wire. `facing` is the direction the body looks, in world
     * space; only its component in the tangent plane survives, which is what a
     * body standing on a surface actually shows.
     */
    encode(position, facing) {
      const { east, north } = frameAt(position)
      return {
        x: position.x,
        y: position.y,
        z: position.z,
        yaw: Math.atan2(dot(facing, east), dot(facing, north)),
      }
    },

    /**
     * The pose back out of a wire sample (or any `{x, y, z, yaw}`).
     *
     * Returns the position, the local `up`, the reconstructed `facing`, the
     * `height` above the surface when the shape reports one, and the full
     * orthonormal `basis` — feed `right/up/forward` straight into whatever the
     * game already uses to orient its local player, so remote bodies lean and
     * turn identically.
     */
    decode(sample) {
      const position = vec(Number(sample?.x) || 0, Number(sample?.y) || 0, Number(sample?.z) || 0)
      const { up, east, north } = frameAt(position)
      const yaw = Number(sample?.yaw) || 0
      const facing = normalize(add(scale(north, Math.cos(yaw)), scale(east, Math.sin(yaw))), north)
      const right = normalize(cross(up, facing), east)
      return {
        position,
        up,
        facing,
        right,
        forward: normalize(cross(right, up), north),
        height: typeof shape.ground === 'function' ? shape.ground(position) : 0,
        basis: { right, up, forward: normalize(cross(right, up), north) },
      }
    },

    /**
     * Whether a position belongs to this world at all.
     *
     * Rooms are shared with whatever else runs on the same authority, and a
     * client that has not reported yet sits at that authority's default spawn.
     * Without this check it is drawn as a stranger hanging in the sky.
     */
    contains(position, { tolerance = Infinity } = {}) {
      if (typeof shape.ground !== 'function' || !Number.isFinite(tolerance)) return true
      const height = shape.ground(position)
      return Number.isFinite(height) && height > -tolerance && height < tolerance
    },
  })
}

export default createPoseCodec
