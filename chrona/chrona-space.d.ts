/** Type declarations for chrona-space: any world shape onto a narrow wire. */

export interface Vec3 { x: number; y: number; z: number }

/**
 * A world is defined by one thing: where "up" points at a position. `ground`
 * is optional and reports height above the surface, which is derived locally
 * and never sent.
 *
 * `up` must depend on position ALONE. If it needs to know which face a player
 * stands on, the pose does not fit on this wire.
 */
export interface WorldShape {
  readonly name: string
  up(position: Vec3): Vec3
  ground?(position: Vec3): number
}

export interface Frame { up: Vec3; east: Vec3; north: Vec3 }

export interface Pose {
  position: Vec3
  up: Vec3
  facing: Vec3
  right: Vec3
  forward: Vec3
  /** Height above the surface, when the shape reports one. */
  height: number
  /** Feed straight into whatever orients the local player. */
  basis: { right: Vec3; up: Vec3; forward: Vec3 }
}

export interface WireP0se { x: number; y: number; z: number; yaw: number }

export interface PoseCodec {
  readonly shape: WorldShape
  frameAt(position: Vec3): Frame
  encode(position: Vec3, facing: Vec3): WireP0se
  decode(sample: Partial<WireP0se> | null | undefined): Pose
  /** False for a position that belongs to some other world sharing the room. */
  contains(position: Vec3, options?: { tolerance?: number }): boolean
}

export declare function createPoseCodec(shape: WorldShape): PoseCodec
export default createPoseCodec

export declare function flatWorld(): WorldShape
export declare function planet(options?: { radius?: number; center?: Vec3 }): WorldShape
export declare function hollowPlanet(options?: { radius?: number; center?: Vec3 }): WorldShape
export declare function cylinder(options?: {
  radius?: number; axis?: Vec3; center?: Vec3; inward?: boolean
}): WorldShape
export declare function customWorld(options: {
  up(position: Vec3): Vec3
  ground?(position: Vec3): number
  name?: string
}): WorldShape
