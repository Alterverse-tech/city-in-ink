import { validateNetcodeProfile } from "./profile.js";
/**
 * Defines the small game-owned surface around the shared prediction and
 * interpolation pipelines. This is the primary contract generated per game.
 */
export function defineGameNetcode(definition) {
    const profile = validateNetcodeProfile(definition.profile);
    if (profile.profile !== "event-sync") {
        if (!definition.prediction) {
            throw new Error(`${profile.profile} requires game prediction hooks`);
        }
        if (!definition.interpolation) {
            throw new Error(`${profile.profile} requires game interpolation hooks`);
        }
    }
    return Object.freeze({
        ...definition,
        profile
    });
}
//# sourceMappingURL=game-netcode.js.map