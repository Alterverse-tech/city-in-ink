// Run after wireTuning: the original city stays byte-for-byte intact while
// idle flight becomes a stationary hover. Explicit event navigation remains.
export function wireHoverFlight(html) {
  const once = (from, to) => {
    if (html.split(from).length !== 2) throw new Error('Hover flight patch target changed: ' + from.slice(0, 90));
    html = html.replace(from, to);
  };
  once("  this.gullSpeed = 22;\n  this.flightTurnVelocity = 0;\n  this.gullFlightState = 'Cruising';\n  this.flightVelocity.set(Math.sin(-1.05) * 22, 0, Math.cos(-1.05) * 22);",
    "  this.gullSpeed = 0;\n  this.flightTurnVelocity = 0;\n  this.gullFlightState = 'Hovering';\n  this.flightVelocity.set(0, 0, 0);");
  once(`  const boost = input.boost, brake = input.backward;
  const desiredSpeed = boost ? 76 : brake ? 12 : input.forward ? 42 : 22;
  this.gullSpeed = We.lerp(this.gullSpeed || 22, desiredSpeed, 1 - Math.exp(-2.4 * dt));
  this.flightTurnVelocity = We.lerp(this.flightTurnVelocity, steer * (boost ? .68 : 1.05), 1 - Math.exp(-4 * dt));`,
    `  const horizontal = !!(input.forward || input.backward || steer), moving = horizontal || lift !== 0;
  const boost = !!input.boost && moving, brake = input.backward;
  const desiredSpeed = horizontal ? (boost ? 76 : brake ? 12 : input.forward ? 42 : 22) : 0;
  this.gullSpeed = horizontal ? We.lerp(this.gullSpeed || 0, desiredSpeed, 1 - Math.exp(-2.4 * dt)) : 0;
  this.flightTurnVelocity = steer ? We.lerp(this.flightTurnVelocity, steer * (boost ? .68 : 1.05), 1 - Math.exp(-4 * dt)) : 0;`);
  once(`  this.flightVelocity.lerp(this.flightDesired, 1 - Math.exp(-5 * dt));
  this.flightCharacter.position.addScaledVector(this.flightVelocity, dt);`,
    `  this.flightVelocity.lerp(this.flightDesired, 1 - Math.exp(-5 * dt));
  // Releasing an axis stops it immediately; Shift alone never supplies thrust.
  if (!horizontal) { this.flightVelocity.x = 0; this.flightVelocity.z = 0; }
  if (lift === 0) this.flightVelocity.y = 0;
  this.flightCharacter.position.addScaledVector(this.flightVelocity, dt);`);
  once("  if (p.x <= -6599 || p.x >= 5099 || p.z <= -5599 || p.z >= 5399) {",
    "  if (horizontal && (p.x <= -6599 || p.x >= 5099 || p.z <= -5599 || p.z >= 5399)) {");
  once("  this.gullFlightState = boost ? 'Boosting' : lift > 0 ? 'Climbing' : lift < 0 ? 'Diving' : glide ? 'Gliding' : 'Cruising';",
    "  this.gullFlightState = !moving ? 'Hovering' : boost ? 'Boosting' : lift > 0 ? 'Climbing' : lift < 0 ? 'Diving' : glide ? 'Gliding' : 'Cruising';");
  // The navigation controller previously relied on unconditional 22 m/s thrust
  // while turning/approaching, and cleared forward while boosting. Give it
  // explicit forward/brake inputs so clicking Fly to the ship still works.
  once("      inp.left = err > 0.04; inp.right = err < -0.04; inp.boost = this.phase === 'travel' && dist > 1100 && aligned; inp.forward = this.phase === 'travel' && dist > 170 && aligned && !inp.boost; inp.backward = this.phase === 'circle' || dist < 100;",
    "      inp.left = err > 0.04; inp.right = err < -0.04; inp.boost = this.phase === 'travel' && dist > 1100 && aligned; inp.forward = this.phase === 'travel' && aligned; inp.backward = this.phase === 'circle' || dist < 170;");
  once("c.flightVelocity.set(Math.sin(sp.heading) * 22, 0, Math.cos(sp.heading) * 22);",
    "c.flightVelocity.set(0, 0, 0); c.gullSpeed = 0; c.flightTurnVelocity = 0; c.clearFlightInput(); nav.stop(true);");
  once("setView(state.view); toast(`Welcome, @${state.user.name || 'you'}. The bird tours the city on its own — any key takes over, P pauses, T cruises the busiest events.`);",
    "setView(state.view); toast(`Welcome, @${state.user.name || 'you'}. Hold movement keys to fly; release them to hover. Select an event to fly there.`);");
  once('Your bird cruises the most-RSVP’d ones by itself; take the controls whenever you like.',
    'Hold movement keys to fly, and release them to hover. Choose an event to fly there.');
  once('Cruise forward automatically; release the keys to glide intermittently',
    'Hold movement keys to fly; release them to hover in place');
  once('  let lastFence = 0;', `  // Editing text or leaving the frame must stop navigation too: clearing
  // inputs alone lets nav.tick regenerate them on the following frame.
  function suspendFlightControls() {
    if (!c) return;
    nav.stop(true); c.clearFlightInput(); c.flightVelocity.set(0, 0, 0);
    c.gullSpeed = 0; c.flightTurnVelocity = 0;
  }
  document.addEventListener('focusin', (event) => {
    const path = event.composedPath ? event.composedPath() : [event.target];
    if (path.some(node => node instanceof HTMLElement &&
      (node.matches('input,textarea,select') || node.isContentEditable))) suspendFlightControls();
  }, true);
  window.addEventListener('blur', suspendFlightControls);
  document.addEventListener('visibilitychange', () => { if (document.hidden) suspendFlightControls(); });
  let lastFence = 0;`);
  return html;
}
