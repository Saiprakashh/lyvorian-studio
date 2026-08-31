/* descent.js — the scroll-driven arrival sequence.
 *
 * Eight stills, cross-dissolved on a canvas and pushed in slightly as they go,
 * so scrolling reads as one continuous fall from sky to desk. There is no
 * <video> and no scroll listener: a rAF loop asks the container where it is.
 *
 * Two failure modes drove the shape of this file, both learned the hard way:
 *
 *   1. The loop ticks every ~16ms; an image takes far longer to arrive. If the
 *      loop marks a frame "done" the instant it targets it, the canvas can sit
 *      on bare background forever, because the image's own load has nothing
 *      left to trigger. So paint() reports whether it actually painted, the
 *      tracker only advances on a true, and every image's onload re-attempts
 *      the frame that is wanted right now. Whichever wins, the pixel lands.
 *
 *   2. Text must never wait on pixels. Nothing in here touches the overlay's
 *      opacity — the beats are driven purely by scroll position, and the mount
 *      animation is pure CSS. A slow image can delay the picture; it is not
 *      allowed to delay a word.
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-descent]');
  if (!root) return;

  var canvas = root.querySelector('.dsc-canvas');
  var sticky = root.querySelector('.dsc-sticky');
  if (!canvas || !sticky) return;

  var ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;

  var SRC = (root.getAttribute('data-frames') || '').split(',').filter(Boolean);
  var N = SRC.length;
  if (!N) return;

  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* The plate colour behind the photograph. Read from the stylesheet so the
     canvas can never disagree with the page it sits in. */
  var PLATE = getComputedStyle(root).getPropertyValue('--dsc-plate').trim() || '#212327';

  var imgs = new Array(N);
  var ready = new Array(N);

  /* What the loop currently wants on screen, as a float across the sequence:
     3.4 means "frame 3, four tenths of the way into its dissolve toward 4".
     `wanted` is written every tick; `painted` only moves when a real pixel
     lands. The gap between those two is the whole race fix. */
  var wanted = 0;
  var painted = -1;

  var vw = 0, vh = 0, dpr = 1;

  function measure() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    vw = sticky.clientWidth;
    vh = sticky.clientHeight;
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* Cover-fit, centred, with a scale multiplier for the slow push-in. */
  function cover(img, scale) {
    var s = Math.max(vw / img.naturalWidth, vh / img.naturalHeight) * scale;
    var w = img.naturalWidth * s;
    var h = img.naturalHeight * s;
    ctx.drawImage(img, (vw - w) / 2, (vh - h) / 2, w, h);
  }

  function ease(t) { return t * t * (3 - 2 * t); }

  /* Returns true only if a real photograph reached the canvas. A false means
     "still waiting" and must leave `painted` alone so we try again. */
  function paint(at) {
    var i = Math.min(N - 1, Math.floor(at));
    var t = Math.min(1, Math.max(0, at - i));
    var j = Math.min(N - 1, i + 1);

    if (!ready[i]) return false;

    ctx.fillStyle = PLATE;
    ctx.fillRect(0, 0, vw, vh);

    /* The outgoing frame keeps pushing in as it leaves; the incoming one
       arrives a touch wide and settles. Both moving the same direction is what
       sells eight stills as one continuous descent. */
    var push = reduce ? 0 : 0.12;
    ctx.globalAlpha = 1;
    cover(imgs[i], 1 + push * t);

    if (j !== i && ready[j] && t > 0) {
      ctx.globalAlpha = ease(t);
      cover(imgs[j], (1 - push * 0.5) + push * 0.5 * t);
      ctx.globalAlpha = 1;
    }
    return true;
  }

  /* Fetch order matters more than it looks. Firing all N frames on load put
     ~1.5MB in front of the headline before anyone had scrolled — the worst
     possible thing to spend a phone's first seconds on. Only the opening pair
     is urgent; the rest can arrive while the visitor reads.
     The scrub already tolerates a frame that has not landed (paint() returns
     false and the loop retries), so deferring costs nothing visually. */
  function load(idx) {
    if (imgs[idx]) return;
    var img = new Image();
    img.decoding = 'async';
    img.onload = function () {
      ready[idx] = true;
      /* If this frame is one of the two the loop wants right now, paint it
         immediately — the loop's own tick may have already given up on it. */
      var lo = Math.floor(wanted), hi = Math.min(N - 1, lo + 1);
      if (idx === lo || idx === hi) {
        if (paint(wanted)) painted = wanted;
      }
    };
    img.src = SRC[idx];
    imgs[idx] = img;
  }

  load(0);
  if (N > 1) load(1);

  var restLoaded = false;
  function loadRest() {
    if (restLoaded) return;
    restLoaded = true;
    for (var k = 2; k < N; k++) load(k);
  }

  /* Whichever comes first: the browser goes idle, the visitor starts scrolling,
     or a hard 2.5s backstop for browsers without requestIdleCallback. */
  if (window.requestIdleCallback) requestIdleCallback(loadRest, { timeout: 2500 });
  else setTimeout(loadRest, 1200);
  addEventListener('scroll', loadRest, { once: true, passive: true });

  /* Beats. Each is [enter, hold-from, hold-to, leave]; the closing beat gets a
     leave past 1 so it never fades back out before the sticky releases. */
  var beats = [];
  Array.prototype.forEach.call(root.querySelectorAll('[data-beat]'), function (el) {
    var r = el.getAttribute('data-beat').split(',').map(Number);
    beats.push({ el: el, a: r[0], b: r[1], c: r[2], d: r[3], last: -1 });
  });

  /* Trapezoid: rise a→b, hold b→c, fall c→d.
     `a === b` is the opening beat — already at full when the page loads, with
     no rise to climb. Testing `p <= a` here would return 0 at p === 0 and hide
     the identity block on arrival, so the lower bound is strict. */
  function span(p, a, b, c, d) {
    if (p < a || p >= d) return 0;
    if (p < b) return b > a ? ease((p - a) / (b - a)) : 1;
    if (p <= c) return 1;
    return ease(1 - (p - c) / (d - c));
  }

  var raf = 0, needResize = false;

  function frame() {
    raf = requestAnimationFrame(frame);

    if (needResize) { needResize = false; measure(); painted = -1; }

    var rect = root.getBoundingClientRect();
    var travel = root.offsetHeight - window.innerHeight;
    var p = travel > 0 ? Math.min(1, Math.max(0, -rect.top / travel)) : 0;

    wanted = p * (N - 1);

    /* Retry every tick regardless of whether the tracker moved — that retry is
       what rescues a first load where nothing had downloaded yet. */
    if (wanted !== painted) {
      if (paint(wanted)) painted = wanted;
    }

    for (var i = 0; i < beats.length; i++) {
      var bt = beats[i];
      var v = span(p, bt.a, bt.b, bt.c, bt.d);
      if (v !== bt.last) {
        bt.last = v;
        bt.el.style.opacity = v;
        bt.el.style.visibility = v > 0.001 ? 'visible' : 'hidden';
        var shift = bt.el.getAttribute('data-shift');
        if (shift && !reduce) {
          var parts = shift.split(' ').map(Number);
          bt.el.style.transform =
            'translate3d(' + (parts[0] * (1 - v)) + 'px,' + (parts[1] * (1 - v)) + 'px,0)';
        }
      }
    }
  }

  addEventListener('resize', function () { needResize = true; }, { passive: true });

  measure();
  ctx.fillStyle = PLATE;
  ctx.fillRect(0, 0, vw, vh);

  /* Reduced motion gets a still, not a scrub.
   *
   * The other reduce branches in here only soften the push-in and the mount
   * animation — but the thing most likely to make someone ill is the sticky
   * hero itself: five screens of scrolling during which the page does not
   * move. There is no gentle version of that, so it is removed entirely.
   * CSS collapses the container to one viewport; here we paint a single
   * representative frame, reveal the opening beat, and never start the loop. */
  if (reduce) {
    var STILL = Math.min(N - 1, 2);   // the studio building — the establishing shot
    load(STILL);
    loadRest();
    var showStill = function () {
      if (!paint(STILL)) return false;
      painted = STILL;
      return true;
    };
    if (!showStill() && imgs[STILL]) {
      imgs[STILL].addEventListener('load', showStill, { once: true });
    }
    /* Beats are scroll-driven, so with no scroll they would all sit at zero.
       Show the identity block and leave the rest out. */
    Array.prototype.forEach.call(root.querySelectorAll('[data-beat]'), function (el) {
      var isId = el.classList.contains('dsc-id');
      el.style.opacity = isId ? 1 : 0;
      el.style.visibility = isId ? 'visible' : 'hidden';
      el.style.transform = 'none';
    });
    return;
  }

  frame();
})();


/* Theme toggle.
 *
 * Writes the same `lyv-theme` key index.html reads, so the choice follows the
 * visitor between pages. The <head> bootstrap has already applied the stored
 * value before first paint — this only handles the click. */
(function () {
  'use strict';

  var btn = document.querySelector('.dsc-theme');
  if (!btn) return;
  var root = document.documentElement;
  var meta = document.querySelector('meta[name="theme-color"]');

  function isDark() {
    var set = root.getAttribute('data-theme');
    return set ? set === 'dark'
               : matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function sync() {
    var d = isDark();
    btn.setAttribute('aria-pressed', d ? 'true' : 'false');
    if (meta) meta.setAttribute('content', d ? '#191410' : '#f2e8d5');
  }

  btn.addEventListener('click', function () {
    var next = isDark() ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('lyv-theme', next); } catch (e) {}
    sync();
  });
  sync();
})();


/* Scroll progress + back to top. One rAF-free listener for both, since they
   answer the same question. */
(function () {
  'use strict';

  var bar = document.querySelector('.dsc-progress i');
  var top = document.getElementById('toTop');
  if (!bar && !top) return;

  var ticking = false;
  function update() {
    ticking = false;
    var max = document.documentElement.scrollHeight - innerHeight;
    var p = max > 0 ? scrollY / max : 0;
    if (bar) bar.style.width = (p * 100).toFixed(2) + '%';
    if (top) top.classList.toggle('on', scrollY > innerHeight * 1.5);
  }
  addEventListener('scroll', function () {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });

  if (top) {
    top.addEventListener('click', function () {
      scrollTo({ top: 0, behavior:
        matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  }
  update();
})();


/* Product-screen lightbox.
 *
 * The deck renders each screen at roughly 150px, which is far too small to
 * read an interface — without this the screenshots are decoration. Opening
 * them full size is what makes the section informative. */
(function () {
  'use strict';

  var lb = document.getElementById('lb');
  var deck = document.querySelector('[data-deck]');
  if (!lb || !deck) return;

  var slabs = [].slice.call(deck.querySelectorAll('.room-slab'));
  var img = lb.querySelector('.lb-img');
  var cap = lb.querySelector('.lb-cap');
  var at = 0, lastFocus = null;

  function show(i) {
    at = (i + slabs.length) % slabs.length;
    var s = slabs[at], pic = s.querySelector('img');
    img.src = pic.getAttribute('src');
    img.alt = pic.getAttribute('alt') || '';
    cap.textContent = (s.querySelector('span') || {}).textContent || '';
  }
  function open(i, from) {
    lastFocus = from || null;
    show(i);
    lb.hidden = false;
    document.body.style.overflow = 'hidden';
    lb.querySelector('.lb-x').focus();
  }
  function close() {
    lb.hidden = true;
    document.body.style.overflow = '';
    if (lastFocus) lastFocus.focus();
  }

  slabs.forEach(function (s, i) {
    s.addEventListener('click', function (e) {
      e.preventDefault();          // the slab is an <a> to the product page
      open(i, s);
    });
  });

  lb.querySelector('.lb-x').addEventListener('click', close);
  lb.querySelector('.lb-prev').addEventListener('click', function () { show(at - 1); });
  lb.querySelector('.lb-next').addEventListener('click', function () { show(at + 1); });
  lb.addEventListener('click', function (e) {
    if (e.target === lb) close();          // click the backdrop, not the image
  });
  addEventListener('keydown', function (e) {
    if (lb.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') show(at - 1);
    else if (e.key === 'ArrowRight') show(at + 1);
  });
})();


/* The mobile menu.
 *
 * The link row is hidden below 560px, so without this the header nav is
 * rendered but unreachable on a phone. Closing on link click matters because
 * every destination is an in-page anchor — the sheet would otherwise stay over
 * the section it just scrolled to. */
(function () {
  'use strict';

  var btn = document.querySelector('.nav-toggle');
  var sheet = document.getElementById('mmSheet');
  if (!btn || !sheet) return;

  function set(open) {
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    sheet.hidden = !open;
    document.body.style.overflow = open ? 'hidden' : '';
  }

  btn.addEventListener('click', function () {
    set(btn.getAttribute('aria-expanded') !== 'true');
  });

  sheet.addEventListener('click', function (e) {
    if (e.target.closest('a')) set(false);
  });

  addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !sheet.hidden) { set(false); btn.focus(); }
  });

  /* Leaving the sheet open while the viewport grows past the breakpoint would
     strand a fixed overlay with no visible way to dismiss it. */
  matchMedia('(min-width: 561px)').addEventListener('change', function (e) {
    if (e.matches && !sheet.hidden) set(false);
  });
})();


/* The product room's 3D deck.
 *
 * Only the deck's two rotations are touched. The slabs keep their own
 * translateZ, so the browser's perspective divide does the parallax for us —
 * the near screen sweeps further than the far ones because it is nearer, not
 * because anything here moves them at different rates. Writing per-slab
 * transforms would be more code and less convincing.
 *
 * Gated behind a fine pointer: on touch there is no hover to track, and on a
 * narrow screen the stylesheet has already flattened the deck to a grid. */
(function () {
  'use strict';

  var deck = document.querySelector('[data-deck]');
  if (!deck) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  var stage = deck.parentElement;
  var MAX_Y = 15, MAX_X = 9;
  var tx = 0, ty = 0, cx = 0, cy = 0, raf = 0, live = false;

  function tick() {
    /* Ease toward the target so the deck settles rather than snapping; the
       CSS transition alone would fight a per-frame write. */
    cx += (tx - cx) * 0.09;
    cy += (ty - cy) * 0.09;
    deck.style.setProperty('--ry', cx.toFixed(2) + 'deg');
    deck.style.setProperty('--rx', cy.toFixed(2) + 'deg');
    if (Math.abs(tx - cx) > 0.01 || Math.abs(ty - cy) > 0.01) {
      raf = requestAnimationFrame(tick);
    } else { raf = 0; }
  }
  function wake() { if (!raf) raf = requestAnimationFrame(tick); }

  stage.addEventListener('pointermove', function (e) {
    var r = stage.getBoundingClientRect();
    tx = ((e.clientX - r.left) / r.width - 0.5) * 2 * MAX_Y;
    ty = -((e.clientY - r.top) / r.height - 0.5) * 2 * MAX_X;
    if (!live) { live = true; deck.style.transition = 'none'; }
    wake();
  }, { passive: true });

  stage.addEventListener('pointerleave', function () {
    tx = 0; ty = 0;
    live = false;
    deck.style.transition = '';
    wake();
  }, { passive: true });
})();
