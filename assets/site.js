/* site.js — shared behaviour for every Lyvorian Studio page.
   Theme is applied by a tiny inline script in <head>; this file only
   handles the toggle, the mobile menu, the contact popover and reveals. */
(function(){
  'use strict';

  // ── theme toggle ───────────────────────────
  var toggle = document.getElementById('themeToggle');
  if (toggle){
    toggle.addEventListener('click', function(){
      var root = document.documentElement;
      var cur = root.getAttribute('data-theme') ||
        (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      var next = cur === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      // guarded like descent.js:381 — a blocked store throws here, and the
      // throw would skip the theme-color update below, leaving the browser
      // UI painted for the previous theme
      try { localStorage.setItem('lyv-theme', next); } catch (e) {}
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', next === 'dark' ? '#191410' : '#f2e8d5');
    });
  }

  // ── mobile menu ────────────────────────────
  var navBtn = document.getElementById('navToggle');
  var menu = document.getElementById('mobileMenu');
  function closeMenu(){
    if (!menu) return;
    // Take focus back BEFORE hiding: the sheet is the last thing in the
    // document, so focus left inside it would otherwise be dropped to the top
    // of the page and a keyboard user would have to tab the whole page again.
    var inside = menu.contains(document.activeElement);
    menu.classList.remove('show');
    // inert as well as the CSS visibility, and deliberately not instead of it.
    // The stylesheet hides the closed sheet with `visibility:hidden` on a .24s
    // delay so the close animation still plays — but that means the tab stops
    // only disappear once the transition COMPLETES, and a transition that is
    // interrupted or never runs leaves nine focusable links behind. inert takes
    // effect on the same frame and needs no animation, so the tab order is
    // correct even mid-close. The CSS still carries the no-JS case, where the
    // menu can never be opened at all.
    menu.inert = true;
    navBtn.setAttribute('aria-expanded','false');
    if (inside) navBtn.focus();
  }
  if (menu) menu.inert = true;          // closed is the state it ships in
  if (navBtn && menu){
    navBtn.addEventListener('click', function(e){
      e.stopPropagation();
      var open = navBtn.getAttribute('aria-expanded') === 'true';
      if (open){ closeMenu(); return; }
      var r = navBtn.getBoundingClientRect();
      menu.style.top = (r.bottom + 10) + 'px';
      // A fixed box cannot be scrolled to by the page, so bound it to what is
      // actually on screen and let it scroll inside itself. Without this the
      // sheet runs off a landscape phone and its lower half is unreachable.
      menu.style.maxHeight = Math.max(120, window.innerHeight - (r.bottom + 10) - 12) + 'px';
      menu.inert = false;
      menu.classList.add('show');
      navBtn.setAttribute('aria-expanded','true');
      // Move into the sheet, or a keyboard user has to tab the entire page to
      // reach a menu that sits after the footer. :focus-visible means a pointer
      // user never sees a ring for this.
      var firstLink = menu.querySelector('a');
      if (firstLink) firstLink.focus();
    });
    menu.addEventListener('click', function(e){
      if (e.target.closest('a')) closeMenu();
    });
    document.addEventListener('click', function(e){
      if (menu.classList.contains('show') && !menu.contains(e.target)) closeMenu();
    });
    window.addEventListener('resize', closeMenu);
  }

  // ── contact popover ────────────────────────
  var pop = document.getElementById('contactPop');
  var triggers = document.querySelectorAll('[data-contact]');
  if (pop && triggers.length){
    var openBy = null;

    var place = function(trigger){
      var r = trigger.getBoundingClientRect();
      var pw = pop.offsetWidth, ph = pop.offsetHeight;
      var left = r.left + r.width/2 - pw/2;
      left = Math.max(12, Math.min(left, window.innerWidth - pw - 12));
      var top = r.bottom + 11;
      var flip = top + ph > window.innerHeight - 12;
      if (flip) top = Math.max(12, r.top - ph - 11);
      pop.classList.toggle('flip', flip);
      pop.style.left = left + 'px';
      pop.style.top = top + 'px';
      var tailX = r.left + r.width/2 - left;
      pop.style.setProperty('--tail-x', Math.max(16, Math.min(tailX, pw - 16)) + 'px');
    };
    var openPop = function(trigger){
      pop.classList.add('show');
      place(trigger);
      pop.setAttribute('aria-hidden','false');
      trigger.setAttribute('aria-expanded','true');
      openBy = trigger;
    };
    var closePop = function(){
      if (!openBy) return;
      pop.classList.remove('show');
      pop.setAttribute('aria-hidden','true');
      openBy.setAttribute('aria-expanded','false');
      openBy = null;
    };

    [].forEach.call(triggers, function(t){
      t.addEventListener('click', function(e){
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
        if (openBy === t){ closePop(); return; }
        closePop();
        openPop(t);
      });
    });
    document.addEventListener('click', function(e){
      if (openBy && !pop.contains(e.target)) closePop();
    });
    document.addEventListener('keydown', function(e){
      if (e.key !== 'Escape') return;
      if (openBy){ var t = openBy; closePop(); t.focus(); }
      closeMenu();
    });
    window.addEventListener('resize', closePop);
    window.addEventListener('scroll', function(){ if (openBy) place(openBy); }, {passive:true});
  }

  // ── reveal on scroll ───────────────────────
  var els = document.querySelectorAll('.reveal');
  if (els.length){
    if (!('IntersectionObserver' in window)){
      [].forEach.call(els, function(el){ el.classList.add('in'); });
    } else {
      var io = new IntersectionObserver(function(entries){
        entries.forEach(function(en){
          if (en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target); }
        });
      }, {threshold:.15});
      [].forEach.call(els, function(el){ io.observe(el); });
    }
  }

  // ── nav indicator ───────────────────────────
  // One rail that travels between items. It parks on the current page's link
  // and follows the pointer while the nav is hovered, then returns. Fine
  // pointers only: on touch there is no hover to follow, and a rail that
  // jumps on tap would read as a glitch.
  (function(){
    var nav = document.querySelector('.site-hdr nav, header nav');
    if (!nav) return;
    var rail = nav.querySelector('.nav-rail');
    if (!rail) return;
    var links = [].slice.call(nav.querySelectorAll('a'));
    if (!links.length) return;

    function park(el){
      if (!el) { rail.classList.remove('on'); return; }
      var n = nav.getBoundingClientRect(), b = el.getBoundingClientRect();
      rail.style.setProperty('--rail-x', (b.left - n.left - 10) + 'px');
      rail.style.setProperty('--rail-w', (b.width + 20) + 'px');
      rail.classList.add('on');
    }
    var current = nav.querySelector('a[aria-current]');
    var home = function(){ park(current); };

    if (window.matchMedia('(pointer: fine)').matches){
      links.forEach(function(a){ a.addEventListener('pointerenter', function(){ park(a); }); });
      nav.addEventListener('pointerleave', home);
    }
    home();
    addEventListener('resize', home, {passive:true});
  })();

  // ── header compaction ───────────────────────
  // A single class flip past a threshold, with hysteresis, so a header does
  // not oscillate when the user rests near the boundary.
  (function(){
    var root = document.documentElement, on = false, raf = 0;
    function check(){
      raf = 0;
      var y = scrollY;
      if (!on && y > 72){ on = true; root.classList.add('is-scrolled'); }
      else if (on && y < 40){ on = false; root.classList.remove('is-scrolled'); }
    }
    addEventListener('scroll', function(){ if (!raf) raf = requestAnimationFrame(check); }, {passive:true});
    check();
  })();

  // ── service worker ─────────────────────────
  // Makes the site a real installable PWA, so Android mints a proper
  // current-SDK web app instead of a legacy shortcut APK that Play
  // Protect flags as "built for an older version of Android".
  if ('serviceWorker' in navigator && location.protocol === 'https:'){
    navigator.serviceWorker.register('/sw.js').catch(function(){});
  }
})();
