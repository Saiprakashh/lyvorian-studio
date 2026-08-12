/* home.js — homepage-only behaviour. Shared behaviour lives in site.js. */
// Scroll progress bar + back-to-top visibility
(function(){
  var bar = document.getElementById('scrollProgress');
  var toTop = document.getElementById('toTop');
  function onScroll(){
    var h = document.documentElement;
    var scrolled = h.scrollTop;
    var max = h.scrollHeight - h.clientHeight;
    var pct = max > 0 ? (scrolled / max) * 100 : 0;
    bar.style.width = pct + '%';
    if (scrolled > 480) toTop.classList.add('show'); else toTop.classList.remove('show');
  }
  window.addEventListener('scroll', onScroll, {passive:true});
  toTop.addEventListener('click', function(){
    window.scrollTo({top:0, behavior:'smooth'});
  });
  onScroll();
})();

// Cursor glow
(function(){
  var glow = document.getElementById('glow');
  if (window.matchMedia('(hover: hover)').matches) {
    window.addEventListener('mousemove', function(e){
      glow.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px) translate(-50%,-50%)';
    }, {passive:true});
  }
})();

// Scroll reveal
(function(){
  var els = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) { els.forEach(function(el){el.classList.add('in');}); return; }
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(en){
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    });
  }, {threshold:.15});
  els.forEach(function(el){ io.observe(el); });
})();

// Story quote — word-by-word blur-in on scroll
(function(){
  var text = 'Lyvorian Studio isn’t a company yet — it’s one person building one product at a time, all the way through, before starting the next. No funding round. No growth hacks. Just software finished carefully enough that it doesn’t need an excuse.';
  var el = document.getElementById('storyQuote');
  var words = text.split(' ');
  el.innerHTML = words.map(function(w,i){
    return '<span class="word" style="transition-delay:' + (i*22) + 'ms">' + w + '</span>';
  }).join(' ');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, {threshold:.4});
    io.observe(el);
  } else { el.classList.add('in'); }
})();

// Floating embers in hero
(function(){
  var host = document.getElementById('embers');
  var n = window.innerWidth < 820 ? 8 : 16;
  for (var i=0;i<n;i++){
    var e = document.createElement('div');
    e.className = 'ember';
    var size = 2 + Math.random()*3;
    e.style.width = size+'px'; e.style.height = size+'px';
    e.style.left = (10+Math.random()*80)+'%';
    e.style.bottom = (0+Math.random()*30)+'%';
    e.style.setProperty('--drift', (Math.random()*60-30)+'px');
    e.style.animation = 'rise ' + (6+Math.random()*5) + 's ease-in ' + (Math.random()*6) + 's infinite';
    host.appendChild(e);
  }
})();

// Card 3D tilt
(function(){
  var card = document.getElementById('ftCard');
  if (!card || !window.matchMedia('(hover: hover)').matches) return;
  card.addEventListener('mousemove', function(e){
    var r = card.getBoundingClientRect();
    var x = (e.clientX - r.left) / r.width - .5;
    var y = (e.clientY - r.top) / r.height - .5;
    card.style.transform = 'perspective(700px) rotateY(' + (x*7) + 'deg) rotateX(' + (-y*7) + 'deg) translateY(-4px)';
  });
  card.addEventListener('mouseleave', function(){
    card.style.transform = 'perspective(700px) rotateY(0) rotateX(0) translateY(0)';
  });
})();

// Logo 3D tilt (follows cursor)
(function(){
  var wrap = document.querySelector('.logo-3d');
  var logo = document.getElementById('logoWord');
  if (!wrap || !logo || !window.matchMedia('(hover: hover)').matches) return;
  wrap.addEventListener('mousemove', function(e){
    var r = wrap.getBoundingClientRect();
    var x = (e.clientX - r.left) / r.width - .5;
    var y = (e.clientY - r.top) / r.height - .5;
    logo.style.transform = 'rotateY(' + (x*26) + 'deg) rotateX(' + (-y*22) + 'deg) translateZ(6px)';
  });
  wrap.addEventListener('mouseleave', function(){
    logo.style.transform = 'rotateY(0) rotateX(0) translateZ(0)';
  });
})();

// App gallery ("Preview the app") + lightbox. One gallery per app —
// future apps just need a button[data-gallery] and a matching .gallery element.
(function(){
  var lb = document.getElementById('lightbox');
  var lbImg = document.getElementById('lbImg');
  var lbCaption = document.getElementById('lbCaption');
  var openGallery = null, items = [], idx = 0;

  function setOverflow(){ document.body.style.overflow = (openGallery || lb.classList.contains('open')) ? 'hidden' : ''; }

  function show(i){
    idx = (i + items.length) % items.length;
    lbImg.src = items[idx].src;
    lbImg.alt = items[idx].alt;
    lbCaption.textContent = items[idx].label + ' — ' + (idx+1) + ' / ' + items.length;
  }
  function openLb(i){ show(i); lb.classList.add('open'); setOverflow(); }
  function closeLb(){ lb.classList.remove('open'); setOverflow(); }

  document.querySelectorAll('.btn-preview[data-gallery]').forEach(function(btn){
    var gal = document.getElementById('gallery-' + btn.getAttribute('data-gallery'));
    if (!gal) return;
    var shots = Array.prototype.slice.call(gal.querySelectorAll('.shot'));
    var galItems = shots.map(function(s){
      var img = s.querySelector('img');
      // screenshots carry data-src, not src: .gallery is position:fixed inset:0,
      // so it always overlaps the viewport and loading="lazy" would never defer
      // them — they'd download on every visit for a gallery most people never open
      return {src: img.getAttribute('data-src') || img.getAttribute('src'),
              alt: img.getAttribute('alt'), label: s.getAttribute('data-label') || ''};
    });
    function hydrate(){
      shots.forEach(function(s){
        var img = s.querySelector('img');
        if (!img.getAttribute('src') && img.getAttribute('data-src')){
          img.setAttribute('src', img.getAttribute('data-src'));
        }
      });
    }
    btn.addEventListener('click', function(){
      hydrate();
      openGallery = gal; items = galItems;
      gal.classList.add('open'); setOverflow();
    });
    shots.forEach(function(s, i){
      s.addEventListener('click', function(){ openLb(i); });
      s.addEventListener('keydown', function(e){ if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLb(i); } });
    });
    gal.querySelector('.gallery-close').addEventListener('click', function(){
      gal.classList.remove('open'); openGallery = null; setOverflow();
    });
    gal.addEventListener('click', function(e){
      if (e.target === gal || e.target.classList.contains('gallery-inner')) {
        gal.classList.remove('open'); openGallery = null; setOverflow();
      }
    });
  });

  document.getElementById('lbClose').addEventListener('click', closeLb);
  document.getElementById('lbPrev').addEventListener('click', function(e){ e.stopPropagation(); show(idx-1); });
  document.getElementById('lbNext').addEventListener('click', function(e){ e.stopPropagation(); show(idx+1); });
  lb.addEventListener('click', function(e){ if (e.target === lb) closeLb(); });
  document.addEventListener('keydown', function(e){
    if (lb.classList.contains('open')) {
      if (e.key === 'Escape') closeLb();
      else if (e.key === 'ArrowLeft') show(idx-1);
      else if (e.key === 'ArrowRight') show(idx+1);
    } else if (openGallery && e.key === 'Escape') {
      openGallery.classList.remove('open'); openGallery = null; setOverflow();
    }
  });
})();

// Ideas box — chip select, live char count, mailto draft + toast
(function(){
  var form = document.getElementById('ideasForm');
  if (!form) return;
  var picked = 'App idea';
  var msgEl = document.getElementById('ideaMsg');
  var countEl = document.getElementById('charCount');
  var toast = document.getElementById('ideaToast');
  var toastTimer = null;
  // category now comes from the radio cards in step 1
  function currentCat(){
    var r = form.querySelector('input[name="fbCat"]:checked');
    return r ? r.value : 'General feedback';
  }
  form.addEventListener('change', function(e){
    if (e.target.name === 'fbCat') picked = currentCat();
  });
  picked = currentCat();
  msgEl.addEventListener('input', function(){
    var n = msgEl.value.length;
    countEl.textContent = n + ' / 1200';
    countEl.classList.toggle('warm', n > 1050);
  });
  function showToast(text, ok){
    toast.querySelector('svg').style.display = ok ? '' : 'none';
    toast.childNodes[toast.childNodes.length-1].textContent = ' ' + text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toast.classList.remove('show'); }, 4800);
  }
  form.addEventListener('submit', function(e){
    e.preventDefault();
    var msg = msgEl.value.trim();
    if (!msg) return;
    if (document.getElementById('ideaHoney').value) return; // bot
    var nameEl = document.getElementById('ideaName');
    var name = nameEl ? nameEl.value.trim() : '';
    var email = document.getElementById('ideaEmail').value.trim();
    var btn = document.getElementById('sendBtn');
    btn.disabled = true;
    btn.firstChild.textContent = 'Sending… ';
    fetch('https://formsubmit.co/ajax/support@lyvorianstudio.co.in', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
      body: JSON.stringify({
        _subject: '💡 New ' + picked + ' — Lyvorian Studio site' + (name ? ' (from ' + name + ')' : ''),
        _template: 'box',
        _captcha: 'false',
        _replyto: email || undefined,
        'Idea type': picked,
        'From': name || 'Anonymous visitor',
        'Reply-to email': email || 'Not shared',
        'Their message': msg,
        'Submitted from': 'lyvorianstudio.co.in'
      })
    }).then(function(r){ return r.json(); }).then(function(d){
      if (d.success === 'true' || d.success === true){
        showToast('Sent straight to the studio — thank you!', true);
        var done = document.getElementById('fbDone');
        if (done){ form.hidden = true; done.hidden = false; done.focus(); }
        form.reset();
        countEl.textContent = '0 / 1200';
        try { localStorage.removeItem('lyv-fb-draft'); } catch(_){}
      } else { throw new Error(); }
    }).catch(function(){
      showToast('Could not send right now — please email support@lyvorianstudio.co.in', false);
    }).finally(function(){
      btn.disabled = false;
      btn.firstChild.textContent = 'Send it over ';
    });
  });
})();

// Click sparkle burst — bright gold particles + spinning stars
(function(){
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var STAR = '<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path d="M10 0l2.4 7.6L20 10l-7.6 2.4L10 20l-2.4-7.6L0 10l7.6-2.4z"/></svg>';
  document.addEventListener('click', function(e){
    var x = e.clientX, y = e.clientY;
    if (x === 0 && y === 0) return; // keyboard-triggered click
    // radiating dots
    for (var i = 0; i < 10; i++){
      var s = document.createElement('div');
      s.className = 'sparkle';
      var ang = (Math.PI * 2 / 10) * i + Math.random() * .6;
      var dist = 34 + Math.random() * 42;
      s.style.left = x + 'px'; s.style.top = y + 'px';
      s.style.setProperty('--sx', Math.cos(ang) * dist + 'px');
      s.style.setProperty('--sy', Math.sin(ang) * dist + 'px');
      var dur = .5 + Math.random() * .3;
      s.style.animation = 'sparkleFly ' + dur + 's cubic-bezier(.16,.8,.28,1) forwards';
      document.body.appendChild(s);
      setTimeout(function(el){ return function(){ el.remove(); }; }(s), dur * 1000 + 60);
    }
    // spinning stars
    for (var j = 0; j < 3; j++){
      var st = document.createElement('div');
      st.className = 'sparkle-star';
      st.innerHTML = STAR;
      st.style.left = (x + (Math.random() * 36 - 18)) + 'px';
      st.style.top = (y + (Math.random() * 36 - 18)) + 'px';
      var sdur = .55 + Math.random() * .25;
      st.style.animation = 'starPop ' + sdur + 's ease-out ' + (j * .06) + 's both';
      document.body.appendChild(st);
      setTimeout(function(el){ return function(){ el.remove(); }; }(st), sdur * 1000 + 260);
    }
  }, {passive:true});
})();

// Custom cursor — a precise dot, plus a ring that takes the shape of
// whatever you are about to click. See the notes above .cursor-ring in
// home.css for the reasoning; this file owns transform, CSS owns the rest.
(function(){
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var dot  = document.getElementById('cursorDot');
  var ring = document.getElementById('cursorRing');
  if (!dot || !ring) return;

  var HIT  = 'a,button,.shot,label,summary,[role="button"]';
  var TEXT = 'input,textarea,select,[contenteditable="true"]';
  // Beyond this, snapping to the element's own box would throw a ring most of
  // the way across the screen — card-stretch links cover a whole card. Those
  // still light up, they just keep the default ring size. The height cap is
  // generous enough to include the tall gallery thumbnails (164x303), which
  // are worth outlining; full cards are excluded on width alone (429).
  var MAX_W = 340, MAX_H = 320;

  document.body.classList.add('custom-cursor');

  var mx = -200, my = -200;          // pointer, exact
  var rx = mx, ry = my;              // ring, lagging
  var target = null, radius = '50%', morph = false;
  var pressing = false, awake = false, idleTimer = null;

  function put(el, x, y, extra){
    el.style.transform = 'translate(' + x + 'px,' + y + 'px) translate(-50%,-50%)' + (extra || '');
  }

  // Sizing is a state change, not an animation, so it is applied here rather
  // than waited on in the frame loop: the outline is correct on the very first
  // paint after hover, and it does not depend on rAF running at all.
  function fit(b){
    var w = Math.round(b.width + 10) + 'px';
    if (ring.style.width === w) return;
    ring.style.width = w;
    ring.style.height = Math.round(b.height + 10) + 'px';
    ring.style.borderRadius = radius;
  }

  function attach(el){
    var b = el.getBoundingClientRect();
    if (!b.width) return;
    target = el;
    morph  = b.width <= MAX_W && b.height <= MAX_H;
    var br = getComputedStyle(el).borderRadius;
    radius = (!br || br === '0px') ? '9px' : br;
    ring.classList.add('snap');
    dot.classList.add('quiet');
    if (morph) fit(b);
  }

  function detach(){
    if (!target) return;
    target = null; morph = false; radius = '50%';
    ring.classList.remove('snap');
    ring.style.width = ring.style.height = ring.style.borderRadius = '';
    dot.classList.remove('quiet');
  }

  window.addEventListener('pointermove', function(e){
    mx = e.clientX; my = e.clientY;
    if (!awake){ awake = true; rx = mx; ry = my; dot.classList.remove('off'); ring.classList.remove('off'); }
    put(dot, mx, my);
    ring.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function(){ ring.classList.add('idle'); }, 2200);
  }, {passive:true});

  document.addEventListener('mouseover', function(e){
    if (e.target.closest(TEXT)){ detach(); dot.classList.add('off'); ring.classList.add('off'); return; }
    dot.classList.remove('off'); ring.classList.remove('off');
    var t = e.target.closest(HIT);
    if (t && t !== target) attach(t);
  });
  // only let go once the pointer has really left the element, not merely
  // crossed onto one of its children
  document.addEventListener('mouseout', function(e){
    if (target && !(e.relatedTarget && target.contains(e.relatedTarget))) detach();
  });
  document.addEventListener('mouseleave', function(){
    awake = false; dot.classList.add('off'); ring.classList.add('off');
  });
  document.addEventListener('mousedown', function(){ pressing = true;  ring.classList.add('press'); });
  document.addEventListener('mouseup',   function(){ pressing = false; ring.classList.remove('press'); });

  (function frame(){
    if (target){
      var b = target.getBoundingClientRect();
      if (!b.width){ detach(); }                    // filtered out from under us
      else {
        if (morph) fit(b);                          // keeps up if it resizes
        // settle onto the target's centre rather than chasing the pointer
        rx += (b.left + b.width  / 2 - rx) * .24;
        ry += (b.top  + b.height / 2 - ry) * .24;
        put(ring, rx, ry, pressing ? ' scale(.97)' : '');
      }
    }
    if (!target){
      var vx = mx - rx, vy = my - ry;
      rx += vx * .17; ry += vy * .17;
      // squash and stretch straight off the lag vector: the further the ring
      // is behind the pointer, the more it elongates along that line
      var k = Math.min(Math.sqrt(vx * vx + vy * vy) / 260, .28);
      put(ring, rx, ry,
        ' rotate(' + (Math.atan2(vy, vx) * 180 / Math.PI).toFixed(1) + 'deg)' +
        ' scale(' + (1 + k).toFixed(3) + ',' + (1 - k).toFixed(3) + ')' +
        (pressing ? ' scale(.88)' : ''));
    }
    requestAnimationFrame(frame);
  })();
})();

// Track clicks on the Finance Tracker CTAs as events
(function(){
  document.querySelectorAll('a[href^="https://app.lyvorianstudio.co.in"]').forEach(function(a){
    a.addEventListener('click', function(){
      if (window.goatcounter && window.goatcounter.count)
        window.goatcounter.count({path:'try-finance-tracker', title:'CTA click', event:true});
    });
  });
})();

// Product Universe - one readout serves hover, focus and tap, so the same
// information reaches mouse, keyboard and touch without a hover-only tooltip.
(function(){
  var nodes = document.querySelectorAll('.orb-node');
  var out = document.getElementById('orbReadout');
  if (!nodes.length || !out) return;
  var IDLE = out.textContent;
  var pinned = null;

  function show(n){ out.textContent = n.getAttribute('data-desc'); out.classList.add('on'); }
  function clear(){
    if (pinned) return;               // a pinned node keeps its text visible
    out.textContent = IDLE; out.classList.remove('on');
  }
  function unpin(){
    if (!pinned) return;
    pinned.setAttribute('aria-expanded','false');
    pinned = null; clear();
  }
  function pin(n){
    if (pinned === n){ unpin(); return; }
    unpin();
    pinned = n; n.setAttribute('aria-expanded','true'); show(n);
  }

  [].forEach.call(nodes, function(n){
    n.setAttribute('aria-controls','orbReadout');
    n.addEventListener('mouseenter', function(){ if (!pinned) show(n); });
    n.addEventListener('mouseleave', clear);
    n.addEventListener('focus',      function(){ if (!pinned) show(n); });
    n.addEventListener('blur',       clear);
    n.addEventListener('click',      function(){ pin(n); });   // Enter/Space fire click on <button>
  });

  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && pinned){ var t = pinned; unpin(); t.focus(); }
  });
  document.addEventListener('click', function(e){
    if (pinned && !e.target.closest('.orb-node')) unpin();
  });
})();

// Header gains a compact state once the page is scrolled.
(function(){
  var hdr = document.querySelector('header');
  if (!hdr) return;
  var tick = false;
  function apply(){ hdr.classList.toggle('compact', window.scrollY > 40); tick = false; }
  window.addEventListener('scroll', function(){
    if (!tick){ tick = true; window.requestAnimationFrame(apply); }
  }, {passive:true});
  apply();
})();

// Feedback flow — three steps, draft preserved, no data sent until submit.
(function(){
  var form = document.getElementById('ideasForm');
  if (!form || !form.querySelector('.fb-step')) return;
  var steps  = form.querySelectorAll('.fb-step');
  var prog   = form.querySelectorAll('#fbProgress li');
  var srStep = document.getElementById('fbSrStep');
  var prompt = document.getElementById('fbPrompt');
  var msgEl  = document.getElementById('ideaMsg');
  var errEl  = document.getElementById('fbMsgErr');
  var sendBtn= document.getElementById('sendBtn');
  var DRAFT  = 'lyv-fb-draft';
  var at = 1;

  function chosen(){ return form.querySelector('input[name="fbCat"]:checked'); }

  function go(n){
    at = n;
    steps.forEach(function(s){ s.classList.toggle('on', +s.dataset.step === n); });
    prog.forEach(function(p){
      var i = +p.dataset.step;
      p.classList.toggle('on', i === n);
      p.classList.toggle('done', i < n);
      // state is carried by text too, never colour alone
      p.setAttribute('aria-current', i === n ? 'step' : 'false');
    });
    srStep.textContent = 'Step ' + n + ' of 3: ' + ['choose a type','details','contact'][n-1];
    var first = steps[n-1].querySelector('input,textarea,button');
    if (first) first.focus({preventScroll:true});
  }

  function syncCat(){
    var c = chosen(); if (!c) return;
    if (prompt) prompt.textContent = c.dataset.prompt;
    if (msgEl)  msgEl.placeholder  = c.dataset.prompt;
    if (sendBtn) sendBtn.childNodes[0].textContent = c.dataset.submit + ' ';
  }

  form.addEventListener('change', function(e){ if (e.target.name === 'fbCat') syncCat(); });

  form.addEventListener('click', function(e){
    if (e.target.closest('.fb-next')){
      if (at === 2 && msgEl.value.trim().length < 4){
        errEl.hidden = false; msgEl.setAttribute('aria-invalid','true'); msgEl.focus();
        return;
      }
      errEl.hidden = true; msgEl.removeAttribute('aria-invalid');
      go(Math.min(3, at + 1));
    }
    if (e.target.closest('.fb-back')) go(Math.max(1, at - 1));   // values are never cleared
  });

  // draft survives a reload; written locally only, never transmitted
  try {
    var saved = JSON.parse(localStorage.getItem(DRAFT) || '{}');
    if (saved.msg && msgEl){ msgEl.value = saved.msg; msgEl.dispatchEvent(new Event('input')); }
    if (saved.cat){
      var r = form.querySelector('input[name="fbCat"][value="' + saved.cat.replace(/"/g,'') + '"]');
      if (r) r.checked = true;
    }
  } catch(_){}
  form.addEventListener('input', function(){
    try {
      localStorage.setItem(DRAFT, JSON.stringify({
        msg: msgEl ? msgEl.value : '', cat: chosen() ? chosen().value : ''
      }));
    } catch(_){}
  });

  var addName = document.getElementById('fbAddName');
  if (addName) addName.addEventListener('click', function(){
    var w = document.getElementById('fbNameWrap');
    var open = !w.hidden;
    w.hidden = open;
    addName.setAttribute('aria-expanded', String(!open));
    if (!open) w.querySelector('input').focus();
  });

  var again = document.getElementById('fbAgain');
  if (again) again.addEventListener('click', function(){
    document.getElementById('fbDone').hidden = true;
    form.hidden = false; go(1);
  });

  syncCat();
  // start deterministically rather than trusting the markup's initial classes
  // to stay in sync with the progress indicator
  go(1);
})();

// Box № 5 — the glyph cycles, so the undecided card has a pulse of its own.
// Purely decorative: the card reads the same if this never runs.
(function(){
  var el = document.getElementById('teaseGlyph');
  if (!el) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var glyphs = ['?', '✦', '◇', '△'], i = 0;
  setInterval(function(){
    el.classList.add('swap');                 // fade/rotate out
    setTimeout(function(){
      i = (i + 1) % glyphs.length;
      el.textContent = glyphs[i];
      el.classList.remove('swap');            // ...and back in on the new one
    }, 300);
  }, 3400);
})();

// Product filters — client-side, no reload, state carried by aria-pressed too.
(function(){
  var bar = document.querySelector('.pfilters');
  var grid = document.getElementById('pGrid');
  var count = document.getElementById('pCount');
  if (!bar || !grid) return;
  var cards = grid.querySelectorAll('.pcard');

  function apply(key){
    var shown = 0;
    [].forEach.call(cards, function(c){
      var match = key === 'all' || (' ' + c.dataset.status + ' ').indexOf(' ' + key + ' ') > -1;
      c.hidden = !match;
      if (match) shown++;
    });
    [].forEach.call(bar.querySelectorAll('.pfilter'), function(b){
      var on = b.dataset.filter === key;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    // the "In development" button already starts with "in", which produced
    // "…products in in development"
    var label = bar.querySelector('.pfilter.on').textContent.trim().toLowerCase()
                   .replace(/^in\s+/, '');
    count.textContent = key === 'all'
      ? 'Showing all ' + shown + ' products'
      : 'Showing ' + shown + ' ' + (shown === 1 ? 'product' : 'products') + ' in ' + label;
  }

  bar.addEventListener('click', function(e){
    var b = e.target.closest('.pfilter');
    if (b) apply(b.dataset.filter);
  });
})();

/* Studio mark at the orbit centre brightens as the cursor nears it.
   The universe panel is stacked above the mark, so :hover on the image can
   never fire - proximity is measured instead, and the mark stays click-through
   so it never intercepts the orbit nodes or the panel's own controls. */
(function(){
  var mark = document.querySelector('.orbit-mark');
  if (!mark || !window.matchMedia('(hover:hover)').matches) return;
  var RADIUS = 155, lit = false, queued = false, mx = 0, my = 0;

  function test(){
    queued = false;
    var r = mark.getBoundingClientRect();
    if (!r.width) return;
    var dx = mx - (r.left + r.width / 2), dy = my - (r.top + r.height / 2);
    var near = Math.sqrt(dx * dx + dy * dy) < RADIUS;
    if (near !== lit){ lit = near; mark.classList.toggle('lit', near); }
  }
  addEventListener('pointermove', function(e){
    mx = e.clientX; my = e.clientY;
    if (!queued){ queued = true; requestAnimationFrame(test); }
  }, {passive:true});
  addEventListener('scroll', function(){
    if (!queued){ queued = true; requestAnimationFrame(test); }
  }, {passive:true});
})();
