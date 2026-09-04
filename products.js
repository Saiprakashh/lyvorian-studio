const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const splash = document.querySelector("[data-splash]");
const splashSkip = document.querySelector("[data-splash-skip]");
const skipLink = document.querySelector(".skip-link");
const rooms = [...document.querySelectorAll(".tour-room:not(.product-room):not(.website-room)")];
const roomOverlays = [...document.querySelectorAll(".product-room, .website-room")];
const roomDoors = [...document.querySelectorAll("[data-room-door]")];
const projectWing = document.querySelector("#product-wing");
const projectsEntry = document.querySelector("[data-projects-entry]");
const projectsCorridor = document.querySelector("[data-projects-corridor]");
const openProjectsButton = document.querySelector("[data-open-projects]");
const closeProjectsButton = document.querySelector("[data-close-projects]");
const roomNumber = document.querySelector("[data-room-number]");
const roomName = document.querySelector("[data-room-name]");
const tourProgress = document.querySelector("[data-tour-progress]");
const tourDots = [...document.querySelectorAll("[data-tour-dot]")];
const arrival = document.querySelector(".arrival-room");
// .tour-header is deliberately NOT in this list. products.css raises it above
// the open room (z-index 1400) so it stays visible, and marking it inert made
// the "Exit office" link the visitor can plainly see do nothing at all. It
// carries the two legitimate ways out of a room, so it stays interactive.
const backgroundRegions = [skipLink, ...rooms].filter(Boolean);

function finishSplash() {
  splash?.classList.add("is-done");
  document.body.classList.remove("splash-active");
  setTimeout(() => splash?.setAttribute("aria-hidden", "true"), 1050);
}

splashSkip?.addEventListener("click", finishSplash);
skipLink?.addEventListener("click", finishSplash);
setTimeout(finishSplash, reduceMotion ? 80 : 3600);

let activeRoom = -1;

function setActiveRoom(index) {
  if (index === activeRoom || !rooms[index]) return;
  activeRoom = index;
  rooms.forEach((room, roomIndex) => room.classList.toggle("is-active", roomIndex === index));
  roomNumber.textContent = rooms[index].dataset.roomIndex;
  roomName.textContent = rooms[index].dataset.room;
  tourDots.forEach((dot, dotIndex) => {
    if (dotIndex === index) dot.setAttribute("aria-current", "true");
    else dot.removeAttribute("aria-current");
  });
}

let openRoomElement = null;
let lastRoomDoor = null;

function setProjectsOpen(isOpen, moveFocus = true) {
  if (!projectWing || !projectsCorridor) return;
  projectWing.classList.toggle("projects-open", isOpen);
  projectsEntry?.setAttribute("aria-hidden", String(isOpen));
  if (projectsEntry) projectsEntry.inert = isOpen;
  projectsCorridor.setAttribute("aria-hidden", String(!isOpen));
  projectsCorridor.inert = !isOpen;
  openProjectsButton?.setAttribute("aria-expanded", String(isOpen));
  // Only a visitor-initiated open/close moves the page. This scroll used to sit
  // at the top of the function, so the setProjectsOpen(false, false) init call
  // below ran it on every load and the document opened 4660px down — five
  // viewports in, on the Projects floor, with Arrival, Reception, the CEO
  // office, Conference and Discussion already behind the visitor.
  if (!moveFocus) return;
  // Remeasure BEFORE scrolling, because opening the corridor changes the flow.
  // At <=720px product-quality.css:172 takes .product-wing-room from the 100svh
  // that product-quality.css:99 pins it to while closed up to min-height:1900px,
  // so on an 812px phone the wing's own span more than doubles and .final-room's
  // offsetTop moves about 1090px down the page. roomMetrics refreshes only on
  // resize and load, so without this the camera keeps running both rooms off
  // geometry that no longer exists — and since updateRoomCamera now derives the
  // rest window FROM that span, the plateau would be computed for a room size
  // that is gone. Above 720px the corridor is absolutely positioned, so there is
  // nothing to remeasure and this costs one layout read on a click. updateTour()
  // after, because the scroll can land exactly where we already are, in which
  // case no scroll event fires and nothing repaints from the fresh numbers.
  //
  // This MUST stay below the !moveFocus guard. setProjectsOpen(false, false) is
  // called during module evaluation, and roomMetrics is a `let` declared further
  // down beside measureRooms(), so remeasuring from above the guard throws on the
  // temporal dead zone — inside a handler nobody awaits, where it would be
  // swallowed silently.
  measureRooms();
  window.scrollTo({ top: projectWing.offsetTop, behavior: "auto" });
  updateTour();
  requestAnimationFrame(() => {
    const focusTarget = isOpen ? projectsCorridor.querySelector("[data-room-door]") : openProjectsButton;
    focusTarget?.focus({ preventScroll: true });
  });
}

function openProjects(event) {
  event.preventDefault();
  setProjectsOpen(true);
}
function closeProjects(event) {
  event.preventDefault();
  setProjectsOpen(false);
  history.replaceState(null, "", "#product-wing");
}
// Both controls are <a role="button">, so a screen reader announces "button"
// and the visitor presses Space — but an anchor only synthesises a click from
// Enter. Without this the corridor stayed shut and the page scrolled instead.
function activateOnSpace(handler) {
  return event => { if (event.key === " " || event.key === "Spacebar") handler(event); };
}
openProjectsButton?.addEventListener("click", openProjects);
openProjectsButton?.addEventListener("keydown", activateOnSpace(openProjects));
closeProjectsButton?.addEventListener("click", closeProjects);
closeProjectsButton?.addEventListener("keydown", activateOnSpace(closeProjects));
addEventListener("hashchange", () => {
  if (location.hash === "#projects-corridor") setProjectsOpen(true);
});
setProjectsOpen(false, false);

roomOverlays.forEach(room => {
  room.setAttribute("role", "dialog");
  room.setAttribute("aria-modal", "true");
  room.setAttribute("aria-label", `${room.dataset.room || "Project"} room`);
  room.setAttribute("aria-hidden", "true");
  room.inert = true;
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "room-exit-button";
  // The arrow is decoration, so it is hidden from the name rather than spoken;
  // the words are the label and they are enough on their own.
  closeButton.innerHTML = '<span aria-hidden="true">←</span> Back to project corridor';
  // No aria-label. It used to say "Return to the project corridor" while the
  // button reads "Back to project corridor", so the accessible name did not
  // contain the visible words — WCAG 2.5.3, and a voice user saying what the
  // button plainly says would have hit nothing. Any label here would have to
  // repeat the visible text to be conformant, at which point it earns nothing,
  // so the name now comes from the content.
  //
  // Worth knowing: check-site.py's link-names check could NOT have caught this.
  // These buttons are built here at runtime, and the checker reads static HTML,
  // so five of them were invisible to it and only turned up in the browser.
  closeButton.addEventListener("click", closeProductRoom);
  closeButton.dataset.roomOwner = room.id;
  document.body.append(closeButton);
  const motionGuide = document.createElement("div");
  motionGuide.className = "room-motion-guide";
  motionGuide.setAttribute("aria-hidden", "true");
  motionGuide.innerHTML = '<span>Scroll to deconstruct</span><i><b></b></i><em>Composed</em>';
  const motionTrack = document.createElement("div");
  motionTrack.className = "room-motion-track";
  motionTrack.setAttribute("aria-hidden", "true");
  motionGuide.dataset.roomOwner = room.id;
  document.body.append(motionGuide);
  room.append(motionTrack);
  room._closeControl = closeButton;
  room._motionGuide = motionGuide;
  room.addEventListener("scroll", () => updateProductRoomMotion(room), { passive: true });
});

function updateProductRoomMotion(room) {
  const max = Math.max(1, room.scrollHeight - room.clientHeight);
  const progress = Math.max(0, Math.min(1, room.scrollTop / max));
  const deconstruct = Math.sin(progress * Math.PI);
  const eased = deconstruct * deconstruct * (3 - 2 * deconstruct);
  const direction = roomOverlays.indexOf(room) % 2 === 0 ? 1 : -1;
  const phase = progress < .14 ? "Composed" : progress < .56 ? "Deconstructing" : progress < .88 ? "Reassembling" : "Resolved";

  room.style.setProperty("--room-progress", progress.toFixed(4));
  room.style.setProperty("--room-motion", eased.toFixed(4));
  room.style.setProperty("--story-x", `${(-eased * 2 * direction).toFixed(2)}vw`);
  room.style.setProperty("--story-y", `${(-eased * 3).toFixed(2)}vh`);
  room.style.setProperty("--story-z", `${(eased * 90).toFixed(2)}px`);
  room.style.setProperty("--display-x", `${(eased * 4.5 * direction).toFixed(2)}vw`);
  room.style.setProperty("--display-y", `${(eased * 3).toFixed(2)}vh`);
  room.style.setProperty("--display-z", `${(-eased * 100).toFixed(2)}px`);
  room.style.setProperty("--screen-x", `${(-eased * 2 * direction).toFixed(2)}vw`);
  room.style.setProperty("--screen-y", `${(-eased * 5).toFixed(2)}vh`);
  room.style.setProperty("--screen-z", `${(eased * 220).toFixed(2)}px`);
  room.style.setProperty("--float-x", `${(eased * 3 * direction).toFixed(2)}vw`);
  room.style.setProperty("--float-y", `${(eased * 8).toFixed(2)}vh`);
  room.style.setProperty("--float-z", `${(eased * 300).toFixed(2)}px`);
  room.style.setProperty("--manager-x", `${(eased * 3.5 * direction).toFixed(2)}vw`);
  room.style.setProperty("--manager-y", `${(eased * 4).toFixed(2)}vh`);
  room.style.setProperty("--manager-z", `${(eased * 140).toFixed(2)}px`);
  room.style.setProperty("--room-turn", `${(eased * 5 * direction).toFixed(2)}deg`);
  room.style.setProperty("--room-turn-inverse", `${(-eased * 5 * direction).toFixed(2)}deg`);
  room.style.setProperty("--room-fade", Math.max(.55, 1 - eased * .34).toFixed(3));
  room.style.setProperty("--room-scale", (1 + eased * .035).toFixed(4));
  const guide = room._motionGuide;
  guide?.style.setProperty("--guide-progress", progress.toFixed(4));
  const phaseLabel = guide?.querySelector("em");
  if (phaseLabel) phaseLabel.textContent = phase;
}

function openProductRoom(roomId, trigger = null) {
  const target = document.getElementById(roomId);
  if (!target || !roomOverlays.includes(target)) return;
  if (openRoomElement && openRoomElement !== target) {
    openRoomElement.classList.remove("is-room-open");
    openRoomElement.setAttribute("aria-hidden", "true");
    openRoomElement.inert = true;
    openRoomElement._closeControl?.classList.remove("is-control-active");
    openRoomElement._motionGuide?.classList.remove("is-control-active");
  }
  openRoomElement = target;
  lastRoomDoor = trigger || document.querySelector(`[data-room-door="${roomId}"]`);
  document.body.classList.add("room-view-active");
  backgroundRegions.forEach(region => { region.inert = true; });
  roomOverlays.forEach(room => { room.inert = room !== target; });
  target.classList.add("is-room-open");
  target.setAttribute("aria-hidden", "false");
  target._closeControl?.classList.add("is-control-active");
  target._motionGuide?.classList.add("is-control-active");
  target.scrollTop = 0;
  updateProductRoomMotion(target);
  // Clear activeRoom so the setActiveRoom() call in closeProductRoom() is not
  // short-circuited by its `index === activeRoom` guard — without this the
  // header kept reading "07 · Finance Tracker" after returning to the corridor.
  activeRoom = -1;
  roomNumber.textContent = target.dataset.roomIndex;
  roomName.textContent = target.dataset.room;
  history.replaceState(null, "", `#${roomId}`);
  requestAnimationFrame(() => target._closeControl?.focus());
}

function closeProductRoom() {
  if (!openRoomElement) return;
  openRoomElement.classList.remove("is-room-open");
  openRoomElement.setAttribute("aria-hidden", "true");
  openRoomElement.inert = true;
  openRoomElement._closeControl?.classList.remove("is-control-active");
  openRoomElement._motionGuide?.classList.remove("is-control-active");
  openRoomElement = null;
  document.body.classList.remove("room-view-active");
  backgroundRegions.forEach(region => { region.inert = false; });
  history.replaceState(null, "", "#product-wing");
  setActiveRoom(rooms.findIndex(room => room.id === "product-wing"));
  lastRoomDoor?.focus();
}

roomDoors.forEach(door => door.addEventListener("click", event => {
  event.preventDefault();
  openProductRoom(door.dataset.roomDoor, door);
}));

rooms.forEach((room, index) => room.style.setProperty("--room-order", index + 1));

let ticking = false;
let walkingTimer;

// Measured once per layout change: reading offsetTop/offsetHeight and
// getComputedStyle for twelve rooms on every scroll frame would be a forced
// reflow per frame. The five product/website rooms are position:fixed overlays
// opened by a click, not part of the scroll flow, so they are excluded from the
// spacing chain and fall back to a single viewport.
let roomMetrics = [];
function measureRooms() {
  const viewportHeight = innerHeight;
  const inFlow = rooms.filter(room => getComputedStyle(room).position !== "fixed");
  roomMetrics = rooms.map(room => {
    if (getComputedStyle(room).position === "fixed") return { top: 0, span: viewportHeight };
    const next = inFlow[inFlow.indexOf(room) + 1];
    const top = room.offsetTop;
    return { top, span: next ? next.offsetTop - top : Math.max(viewportHeight, room.offsetHeight) };
  });
}
measureRooms();
addEventListener("resize", measureRooms, { passive: true });
// Remeasuring alone left the camera painting from the pre-load metrics until the
// visitor happened to scroll: a late font swap or a decoded image moves every
// offsetTop, and updateRoomCamera derives its rest window from those spans.
addEventListener("load", () => { measureRooms(); updateTour(); });

function updateRoomCamera() {
  const viewportHeight = innerHeight;
  let currentRoom = 0;
  const clamp = value => Math.max(0, Math.min(1, value));
  const smooth = value => value * value * (3 - 2 * value);

  rooms.forEach((room, index) => {
    // Real geometry, not index * viewportHeight. That shortcut was only ever
    // correct while every room was exactly one viewport tall and butted against
    // the next; the pacing margin breaks both halves of that assumption, and the
    // camera would drift further out of step with every room down the page.
    // roomSpan is the distance to the NEXT room's arrival, so the camera arc
    // matches how long the room is actually on screen — lengthen the spacing and
    // the camera slows with it rather than finishing early and sitting faded out.
    const metrics = roomMetrics[index] || { top: room.offsetTop, span: viewportHeight };
    const roomTop = metrics.top;
    const roomHeight = metrics.span;
    const phaseSpan = roomHeight + viewportHeight;
    const phase = clamp((scrollY - roomTop + viewportHeight) / phaseSpan);
    const enter = smooth(clamp(phase * 2));
    const exit = smooth(clamp((phase - .5) * 2));
    const focus = Math.sin(phase * Math.PI);

    // Let the copy REST while the room is simply on screen.
    //
    // descent.js:76 says why, for the hero: without a hold "something is always
    // mid-fade and nothing is ever simply on screen — which reads as restless
    // however much scroll distance it is given". The same was true here. Measured
    // on the live site: while a room sits pinned and completely uncovered, its
    // copy was still sliding +/-35px in X and 75px in Z, because `passage` ran
    // linearly through the room's whole life.
    //
    // The hero's own dwell() curve does NOT port across, and porting it would
    // make this worse rather than better. There, t is the fraction through one
    // TRANSITION, so its flat stretches sit at the two ENDS of t and that is rest
    // on screen. Here, phase is the fraction through a room's whole life —
    // arriving, resting, being covered — so the still moment is the MIDDLE.
    // dwell() applied to passage would pin the copy at its full +/-105px offset
    // through both wipes and swing the entire 210px range during the plateau:
    // three times today's movement, precisely where we want none.
    //
    // So: same principle, curve turned inside out. Flat in the middle, ramping at
    // the ends. The edges are derived, not guessed — the room is fully arrived
    // once scrollY reaches roomTop (phase = viewportHeight/phaseSpan) and the
    // next room starts wiping over it at scrollY = roomTop + roomHeight -
    // viewportHeight (phase = roomHeight/phaseSpan). Measured against the live
    // page at a 100svh gap those come out at 0.333 and 0.667, matching the
    // observed window exactly. Deriving them also means this stays correct for
    // the wing room, whose span is a single viewport and whose plateau is
    // therefore a point, and on mobile, where nothing pins at all.
    //
    // focus/enter/exit/scale/panY/opacity keep reading `phase` on purpose, so the
    // camera goes on drifting through the rest — descent.js:81 makes exactly this
    // split, keeping the push-in linear "so the frame feels alive, not frozen".
    // Math.min, because roomHeight can be SHORTER than viewportHeight, and the
    // naive pair then inverts: restEnd lands below restStart, both ternary
    // conditions below are true at once so the first branch wins, and drift
    // steps discontinuously where they cross. It is reachable, not theoretical.
    // .product-wing-room is excluded from both pacing levers, so its span is a
    // fixed 100svh, while viewportHeight is read as live innerHeight — which on
    // a phone grows towards the LARGE viewport as the URL bar retracts. The
    // room then measures shorter than the viewport and the plateau turns inside
    // out, on the one room that holds a button.
    // Clamping to the shorter of the two keeps the pair ordered and still
    // symmetric about .5. Where roomHeight >= viewportHeight — every
    // walk-through room on both layouts — it is algebraically the expression it
    // replaces, since 1 - vh/(H+vh) === H/(H+vh), so the desktop [1/3, 2/3]
    // window is untouched.
    const restStart = Math.min(viewportHeight, roomHeight) / phaseSpan;
    const restEnd = 1 - restStart;
    const drift = phase < restStart ? smooth(phase / restStart) - 1
      : phase > restEnd ? smooth((phase - restEnd) / restStart)
      : 0;
    // The room's own furniture stays on the linear curve: the backdrop's turn
    // and the tilts the overlay rooms' panels read. That is the same split again
    // from the other side — descent.js:81 keeps the push-in linear through the
    // hold so the frame stays alive. Settling the copy is the point; freezing
    // the room around it as well would stop it dead.
    //
    // The name plaque is deliberately NOT on that list. products.css:79 composes
    // --sign-x, --sign-y, --sign-z and --sign-turn onto one element, and the
    // first three are derived below from contentX/contentShift/contentZ, so they
    // already rest. Leaving only its yaw linear made the plaque the one thing
    // that is half held and half live — it rotated through 3.3deg with zero
    // translation across the plateau, which reads as a wobble, not as drift.
    // Either the whole element rests or none of it does; it rests.
    const passage = (phase - .5) * 2;
    const spread = Math.abs(drift);
    const direction = index % 2 === 0 ? 1 : -1;
    const scale = 1.17 - focus * .13 + exit * .045;
    const panY = (0.5 - phase) * 62;
    const contentShift = drift * -72;
    const contentX = drift * direction * 105;
    const contentZ = -spread * 210 + focus * 36;
    const contentOpacity = Math.max(.12, Math.min(1, .08 + focus * 1.16));
    const transition = Math.max(1 - enter, exit);

    if (scrollY >= roomTop - viewportHeight * .42) currentRoom = index;

    room.style.setProperty("--camera-scale", scale.toFixed(4));
    room.style.setProperty("--camera-y", `${panY.toFixed(2)}px`);
    room.style.setProperty("--room-focus", focus.toFixed(3));
    room.style.setProperty("--content-shift", `${contentShift.toFixed(2)}px`);
    room.style.setProperty("--content-x", `${contentX.toFixed(2)}px`);
    room.style.setProperty("--content-z", `${contentZ.toFixed(2)}px`);
    room.style.setProperty("--content-turn", `${(drift * direction * -9).toFixed(2)}deg`);
    room.style.setProperty("--content-opacity", contentOpacity.toFixed(3));
    room.style.setProperty("--camera-brightness", (.68 + focus * .32).toFixed(3));
    room.style.setProperty("--camera-saturate", (.74 + focus * .26).toFixed(3));
    room.style.setProperty("--layer-left", `${(-spread * 148).toFixed(2)}px`);
    room.style.setProperty("--layer-right", `${(spread * 148).toFixed(2)}px`);
    room.style.setProperty("--layer-rise", `${(-spread * 92).toFixed(2)}px`);
    room.style.setProperty("--layer-drop", `${(spread * 62).toFixed(2)}px`);
    room.style.setProperty("--layer-phone", `${(-spread * 118).toFixed(2)}px`);
    room.style.setProperty("--layer-token-rise", `${(spread * 52).toFixed(2)}px`);
    room.style.setProperty("--layer-turn", `${(passage * 13).toFixed(2)}deg`);
    room.style.setProperty("--layer-clarity", Math.max(.12, 1 - spread * .88).toFixed(3));
    room.style.setProperty("--scene-entry", enter.toFixed(3));
    room.style.setProperty("--scene-exit", exit.toFixed(3));
    room.style.setProperty("--scene-transition", transition.toFixed(3));
    room.style.setProperty("--scene-depth", `${(-spread * 135).toFixed(2)}px`);
    room.style.setProperty("--transition-y", `${((1 - enter) * 8).toFixed(2)}vh`);
    room.style.setProperty("--transition-opacity", (transition * .46).toFixed(3));
    room.style.setProperty("--vignette-opacity", (.72 + focus * .28).toFixed(3));
    room.style.setProperty("--actor-opacity", (.45 + focus * .55).toFixed(3));
    room.style.setProperty("--background-turn", `${(passage * -1.17).toFixed(2)}deg`);
    room.style.setProperty("--sign-x", `${(-contentX * .42).toFixed(2)}px`);
    room.style.setProperty("--sign-y", `${(contentShift * .45).toFixed(2)}px`);
    room.style.setProperty("--sign-z", `${(contentZ * .4).toFixed(2)}px`);
    room.style.setProperty("--sign-turn", `${(drift * direction * 4.95).toFixed(2)}deg`);
    room.style.setProperty("--speech-x", `${(contentX * .25).toFixed(2)}px`);
    room.style.setProperty("--speech-y", `${(-contentShift * .18).toFixed(2)}px`);
    room.style.setProperty("--speech-z", `${(contentZ * .25).toFixed(2)}px`);
    room.style.setProperty("--suite-tilt", `${(passage * 1.56).toFixed(2)}deg`);
    room.style.setProperty("--story-turn", `${(passage * -7.54).toFixed(2)}deg`);
    room.style.setProperty("--display-turn", `${(passage * 6.5).toFixed(2)}deg`);
    room.style.setProperty("--float-turn", `${(passage * -10.4).toFixed(2)}deg`);
    room.style.setProperty("--manager-shift", `${(spread * 32.56).toFixed(2)}px`);
    room.style.setProperty("--mobile-content-x", `${(contentX * .34).toFixed(2)}px`);
    room.style.setProperty("--mobile-content-y", `${(contentShift * .36).toFixed(2)}px`);
    room.style.setProperty("--mobile-layer-left", `${(-spread * 37).toFixed(2)}px`);
    room.style.setProperty("--mobile-layer-right", `${(spread * 37).toFixed(2)}px`);
    room.style.setProperty("--mobile-transition-opacity", (transition * .28).toFixed(3));
  });

  setActiveRoom(currentRoom);
}

function updateTour() {
  const max = document.documentElement.scrollHeight - innerHeight;
  const progress = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
  tourProgress.style.transform = `scaleX(${progress})`;
  updateRoomCamera();
  ticking = false;
}

addEventListener("scroll", () => {
  document.body.classList.add("is-walking");
  clearTimeout(walkingTimer);
  walkingTimer = setTimeout(() => document.body.classList.remove("is-walking"), 130);
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(updateTour);
}, { passive: true });

addEventListener("resize", updateTour);
addEventListener("pointermove", event => {
  if (reduceMotion) return;
  const lookX = ((event.clientX / innerWidth) - .5) * -12;
  const lookY = ((event.clientY / innerHeight) - .5) * -8;
  document.documentElement.style.setProperty("--look-x", `${lookX.toFixed(2)}px`);
  document.documentElement.style.setProperty("--look-y", `${lookY.toFixed(2)}px`);
}, { passive: true });

document.documentElement.addEventListener("mouseleave", () => {
  document.documentElement.style.setProperty("--look-x", "0px");
  document.documentElement.style.setProperty("--look-y", "0px");
});

updateTour();
setActiveRoom(0);

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && openRoomElement) {
    closeProductRoom();
    return;
  }
  if (event.key === "Escape" && projectWing?.classList.contains("projects-open")) {
    setProjectsOpen(false);
    return;
  }
  if (event.key === "Tab" && openRoomElement) {
    // _closeControl LAST, not first: products.js:91 appends it to <body>, so
    // it sits after </main> in DOM order. Listing it first made focusables[0]
    // the element Tab actually reaches last, so the forward wrap compared
    // against the wrong end and focus escaped the aria-modal dialog.
    const focusables = [
      ...openRoomElement.querySelectorAll('a[href],button:not([disabled]):not([tabindex="-1"]),[tabindex]:not([tabindex="-1"])'),
      openRoomElement._closeControl
    ].filter(element => element && !element.inert);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
    return;
  }
  if (openRoomElement && ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const pageStep = Math.max(240, openRoomElement.clientHeight * .72);
    const destinations = {
      ArrowDown: openRoomElement.scrollTop + 96,
      ArrowUp: openRoomElement.scrollTop - 96,
      PageDown: openRoomElement.scrollTop + pageStep,
      PageUp: openRoomElement.scrollTop - pageStep,
      Home: 0,
      End: openRoomElement.scrollHeight
    };
    openRoomElement.scrollTo({ top: destinations[event.key], behavior: reduceMotion ? "auto" : "smooth" });
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(event.key)) return;
  if (document.body.classList.contains("splash-active")) finishSplash();
});

const requestedRoom = location.hash.slice(1);
if (roomOverlays.some(room => room.id === requestedRoom)) {
  setTimeout(() => {
    finishSplash();
    openProductRoom(requestedRoom);
  }, reduceMotion ? 100 : 220);
}

addEventListener("pageshow", updateTour);
