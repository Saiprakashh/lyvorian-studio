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
const walkMeter = document.querySelector("[data-walk-meter]");
const tourDots = [...document.querySelectorAll("[data-tour-dot]")];
const arrival = document.querySelector(".arrival-room");
// .tour-header is deliberately NOT in this list. products.css raises it above
// the open room (z-index 1400) so it stays visible, and marking it inert made
// the "Exit office" link the visitor can plainly see do nothing at all. It
// carries the two legitimate ways out of a room, so it stays interactive.
const backgroundRegions = [document.querySelector(".tour-rail"), skipLink, ...rooms].filter(Boolean);

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
  window.scrollTo({ top: projectWing.offsetTop, behavior: "auto" });
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
  closeButton.innerHTML = "<span>←</span> Back to project corridor";
  closeButton.setAttribute("aria-label", "Return to the project corridor");
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

function updateRoomCamera() {
  const viewportHeight = innerHeight;
  let currentRoom = 0;
  const clamp = value => Math.max(0, Math.min(1, value));
  const smooth = value => value * value * (3 - 2 * value);

  rooms.forEach((room, index) => {
    const stackedLayout = innerWidth > 1050;
    const roomTop = stackedLayout ? index * viewportHeight : room.offsetTop;
    const roomHeight = stackedLayout ? viewportHeight : Math.max(viewportHeight, room.offsetHeight);
    const phase = clamp((scrollY - roomTop + viewportHeight) / (roomHeight + viewportHeight));
    const enter = smooth(clamp(phase * 2));
    const exit = smooth(clamp((phase - .5) * 2));
    const focus = Math.sin(phase * Math.PI);
    const passage = (phase - .5) * 2;
    const spread = Math.abs(passage);
    const direction = index % 2 === 0 ? 1 : -1;
    const scale = 1.17 - focus * .13 + exit * .045;
    const panY = (0.5 - phase) * 62;
    const contentShift = passage * -72;
    const contentX = passage * direction * 105;
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
    room.style.setProperty("--content-turn", `${(passage * direction * -9).toFixed(2)}deg`);
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
    room.style.setProperty("--sign-turn", `${(passage * direction * 4.95).toFixed(2)}deg`);
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
  if (walkMeter) walkMeter.style.transform = `scaleX(${progress})`;
  arrival?.classList.toggle("is-entered", scrollY > innerHeight * .12);
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
