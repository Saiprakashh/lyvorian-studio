# -*- coding: utf-8 -*-
"""check-site.py — static checks over every page in the repo.

There is no build step here, so nothing catches a dangling href, a duplicated
id, or an aria-controls pointing at an element that was renamed. Those failures
are invisible until someone clicks the thing. This runs the checks a build would.

Deliberately conservative: a check that cannot be made reliable is not made at
all, because a suite that cries wolf gets ignored and then a real failure hides
in the noise. Every rule below either proves a fact about the file or says
nothing.

    python tools/check-site.py            all checks
    python tools/check-site.py --list     what it checks, and why

Exit code is the number of failing checks, so CI can gate on it.
"""
import io
import os
import re
import sys
import glob
import html
from collections import Counter, defaultdict

# Windows hands this script a cp1252 stdout, so printing any character from the
# site's own copy — a ✕, an em dash, the ↗ on the office buttons — raised
# UnicodeEncodeError and killed the run mid-report. The checker then exits
# non-zero with a traceback instead of its findings, which reads like a broken
# tool rather than a failing site. Nothing upstream guarantees the messages are
# ASCII, because they quote the pages.
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except (AttributeError, ValueError):
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# --root lets the suite be pointed at a fixture directory, which is how its own
# checks are proved to still fail (tools/selftest-check-site.py). A suite that
# has only ever been seen green is not evidence of anything.
if '--root' in sys.argv:
    ROOT = sys.argv[sys.argv.index('--root') + 1]
os.chdir(ROOT)

VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
        'meta', 'param', 'source', 'track', 'wbr'}

# Tags the HTML parser is allowed to auto-close, so an unclosed <li> or <p> is
# not reported as an imbalance. These are legal per the HTML spec.
OPTIONAL_CLOSE = {'li', 'p', 'td', 'th', 'tr', 'option', 'dt', 'dd', 'thead', 'tbody'}

failures = []
checked = 0


def fail(check, path, line, msg):
    failures.append((check, path, line, msg))


def read(p):
    return io.open(p, encoding='utf-8').read()


def lineno(text, idx):
    return text.count('\n', 0, idx) + 1


def pages():
    return sorted(glob.glob('*.html'))


def blank_out(m):
    """Replace a match with spaces, keeping BOTH its length and its newlines.

    Length preservation keeps offsets valid. Newline preservation keeps lineno()
    truthful, which the obvious ' ' * len(m.group(0)) does not: it turns every
    newline inside the match into a space, so every line number after a
    multi-line comment comes out short. Measured on this repo, that idiom put
    assets/site.css's `@media print` at line 367 when it is on line 447. A
    finding that cites unrelated correct code reads as noise, and a suite that
    reads as noise stops being read.
    """
    return re.sub(r'[^\n]', ' ', m.group(0))


def strip_comments(s):
    """Blank out HTML comments, keeping length and line numbers valid."""
    return re.sub(r'<!--.*?-->', blank_out, s, flags=re.S)


# ── 1. every local reference resolves ────────────────────────────────────
def check_references():
    """A dangling href/src is a 404 the visitor finds, not the author."""
    global checked
    ref_re = re.compile(r'(?:href|src)\s*=\s*"([^"]+)"')
    url_re = re.compile(r'url\(\s*[\'"]?([^\'")]+)[\'"]?\s*\)')

    # srcset is a comma-separated list of "url descriptor" pairs, so the plain
    # href/src pattern never looked inside one. Six homepage images carry a
    # srcset, and a typo in a variant filename is invisible: the browser simply
    # picks another candidate, so the page looks right to whoever has the real
    # file cached and 404s for everyone else.
    set_re = re.compile(r'srcset\s*=\s*"([^"]+)"')

    targets = [(p, ref_re) for p in pages()]
    targets += [(p, set_re) for p in pages()]
    targets += [(p, url_re) for p in glob.glob('*.css') + glob.glob('assets/*.css')]

    for path, rx in targets:
        s = read(path)
        base = os.path.dirname(path)
        for m in rx.finditer(s):
            group = m.group(1).strip()
            # one url per comma for srcset; everything else is a single value
            raws = ([c.strip().split()[0] for c in group.split(',') if c.strip()]
                    if rx is set_re else [group])
            for raw in raws:
                if (not raw or raw.startswith(('http://', 'https://', 'mailto:', 'tel:',
                                               'data:', '#', '//'))):
                    continue
                checked += 1
                f = raw.split('?')[0].split('#')[0]
                # A leading slash is site-root-relative, not relative to the file.
                # 404.html uses those deliberately: the server may serve it at any
                # URL depth, so relative paths there would break. Resolving them
                # against the page's own directory reported all 13 as missing.
                if f.startswith('/'):
                    cand = os.path.normpath(f.lstrip('/'))
                else:
                    cand = os.path.normpath(os.path.join(base, f))
                if not os.path.exists(cand):
                    fail('references', path, lineno(s, m.start()),
                         '%s -> missing %s' % (raw, cand))


# ── 2. in-page anchors point at an id that exists ────────────────────────
def check_anchors():
    """#work in the nav is silent when the section id changes; the link just
    does nothing."""
    global checked
    for path in pages():
        s = strip_comments(read(path))
        ids = set(re.findall(r'\bid\s*=\s*"([^"]+)"', s))
        # [^"]* not [^"]+ — the + form cannot match href="#" at all, which made
        # the empty-fragment branch below unreachable dead code.
        for m in re.finditer(r'href\s*=\s*"#([^"]*)"', s):
            frag = m.group(1)
            if not frag:
                # href="#" is a link to nowhere: it scrolls to the top and
                # appends a bare # to the URL. Skipping it as "no fragment to
                # resolve" let a dead site-logo link survive a full review.
                checked += 1
                fail('anchors', path, lineno(s, m.start()),
                     'href="#" points nowhere — give it a real target')
                continue
            checked += 1
            if frag not in ids:
                fail('anchors', path, lineno(s, m.start()),
                     'href="#%s" but no element has that id' % frag)


# ── 3. ids are unique within a page ──────────────────────────────────────
def check_duplicate_ids():
    """getElementById returns the first match, so a duplicate silently wires
    behaviour to the wrong element."""
    global checked
    for path in pages():
        s = strip_comments(read(path))
        found = re.findall(r'\bid\s*=\s*"([^"]+)"', s)
        checked += len(found)
        for i, n in Counter(found).items():
            if n > 1:
                fail('duplicate-ids', path, 0, 'id="%s" appears %d times' % (i, n))


# ── 4. aria references resolve ───────────────────────────────────────────
def check_aria_refs():
    """aria-controls pointing at a removed id leaves a screen reader announcing
    a relationship the page does not have."""
    global checked
    attrs = ('aria-controls', 'aria-labelledby', 'aria-describedby')
    for path in pages():
        s = strip_comments(read(path))
        ids = set(re.findall(r'\bid\s*=\s*"([^"]+)"', s))
        for a in attrs:
            for m in re.finditer(r'%s\s*=\s*"([^"]+)"' % a, s):
                for tok in m.group(1).split():
                    checked += 1
                    if tok not in ids:
                        fail('aria-refs', path, lineno(s, m.start()),
                             '%s="%s" but no element has id="%s"' % (a, m.group(1), tok))


# ── 5. tag balance ───────────────────────────────────────────────────────
def check_tag_balance():
    """An unclosed div silently swallows the rest of the page into itself; the
    layout breaks far from the actual mistake."""
    global checked
    tag_re = re.compile(r'<(/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(/?)>')
    for path in pages():
        s = strip_comments(read(path))
        # drop script/style bodies: '<' inside them is not markup
        s = re.sub(r'<script\b[^>]*>.*?</script>',
                   lambda m: ' ' * len(m.group(0)), s, flags=re.S | re.I)
        s = re.sub(r'<style\b[^>]*>.*?</style>',
                   lambda m: ' ' * len(m.group(0)), s, flags=re.S | re.I)
        stack = []
        for m in tag_re.finditer(s):
            closing, name, _attrs, selfclose = m.group(1), m.group(2).lower(), m.group(3), m.group(4)
            if name in VOID or selfclose:
                continue
            if not closing:
                stack.append((name, lineno(s, m.start())))
            else:
                checked += 1
                # pop through tags the spec lets the parser auto-close
                while stack and stack[-1][0] != name and stack[-1][0] in OPTIONAL_CLOSE:
                    stack.pop()
                if not stack:
                    fail('tag-balance', path, lineno(s, m.start()),
                         '</%s> with nothing open' % name)
                elif stack[-1][0] != name:
                    open_name, open_line = stack[-1]
                    fail('tag-balance', path, lineno(s, m.start()),
                         '</%s> closes while <%s> (line %d) is still open'
                         % (name, open_name, open_line))
                    stack.pop()
                else:
                    stack.pop()
        for name, ln in stack:
            if name not in OPTIONAL_CLOSE:
                fail('tag-balance', path, ln, '<%s> never closed' % name)


# ── 6. no anchor inside an anchor ────────────────────────────────────────
def check_nested_anchors():
    """The browser drops one of them, so one of the two links stops working."""
    global checked
    for path in pages():
        s = strip_comments(read(path))
        depth = 0
        for m in re.finditer(r'<(/?)a\b[^>]*>', s, re.I):
            if m.group(1):
                depth = max(0, depth - 1)
            else:
                checked += 1
                if depth:
                    fail('nested-anchors', path, lineno(s, m.start()),
                         '<a> opened while another <a> is still open')
                depth += 1


# ── 7. exactly one h1 ────────────────────────────────────────────────────
def check_single_h1():
    global checked
    for path in pages():
        s = strip_comments(read(path))
        n = len(re.findall(r'<h1\b', s, re.I))
        checked += 1
        if n > 1:
            fail('headings', path, 0, '%d <h1> elements (expected at most 1)' % n)


# ── 8. images carry alt, and intrinsic size ──────────────────────────────
def check_images():
    """Without width/height the page reflows as each image arrives; without alt
    the image is invisible to a screen reader."""
    global checked
    for path in pages():
        s = strip_comments(read(path))
        for m in re.finditer(r'<img\b[^>]*>', s, re.I):
            tag = m.group(0)
            checked += 1
            if not re.search(r'\balt\s*=', tag):
                fail('images', path, lineno(s, m.start()), 'img without alt: %s' % tag[:70])
            # An empty src is a placeholder that script fills in (the lightbox
            # image). It has no intrinsic size to declare and is sized by CSS,
            # so demanding width/height on it is noise, not a finding.
            if re.search(r'\bsrc\s*=\s*""', tag):
                continue
            has_wh = re.search(r'\bwidth\s*=', tag) and re.search(r'\bheight\s*=', tag)
            styled = re.search(r'style\s*=\s*"[^"]*(?:width|height)', tag)
            if not has_wh and not styled:
                fail('images', path, lineno(s, m.start()),
                     'img without width/height: %s' % tag[:70])


def _classes_inside_roots(html, roots):
    """Class names appearing anywhere inside the given root selectors.

    Roots look like 'main', 'footer.foot', '.mm' — a tag, a tag+class, or a
    bare class. Uses a depth-tracking parser so a root's own closing tag is
    found past nested elements of the same name.
    """
    from html.parser import HTMLParser

    want = []
    for r in roots:
        tag, _, cls = r.partition('.')
        want.append((tag or None, cls or None))

    class P(HTMLParser):
        def __init__(self):
            HTMLParser.__init__(self, convert_charrefs=True)
            self.depth = 0          # nesting depth inside an active root
            self.root_tag = None
            self.found = set()

        def handle_starttag(self, tag, attrs):
            if tag in VOID:
                return
            d = dict(attrs)
            classes = (d.get('class') or '').split()
            if self.root_tag is None:
                for wt, wc in want:
                    if (wt is None or wt == tag) and (wc is None or wc in classes):
                        self.root_tag, self.depth = tag, 1
                        return
            elif tag == self.root_tag:
                self.depth += 1
            if self.root_tag is not None:
                self.found.update(classes)

        def handle_endtag(self, tag):
            if self.root_tag is not None and tag == self.root_tag:
                self.depth -= 1
                if self.depth <= 0:
                    self.root_tag = None

    p = P()
    p.feed(html)
    return p.found


# ── 9. the word-span trap ────────────────────────────────────────────────
def check_word_span_guards():
    """descent.js wraps every word in <span class="w"> inside a <span class="wg">.
    Any descendant selector ending in a bare `span` therefore also matches words,
    which has broken this page four separate times — a number marker turned a
    word into a 24px grid box and pushed the page wide on a phone.

    Only the homepage loads descent.css, and only the homepage is word-split,
    so the rule applies to that stylesheet."""
    global checked
    path = 'assets/descent.css'
    page = 'index.html'
    if not (os.path.exists(path) and os.path.exists(page) and os.path.exists('assets/descent.js')):
        return

    # Only markup inside the roots descent.js splits can contain word spans.
    # Read the roots from the script rather than hardcoding them, so the check
    # follows the code if the roots change.
    js = read('assets/descent.js')
    rm = re.search(r'\[([^\]]*)\]\.forEach\(function \(sel\)', js)
    roots = re.findall(r"'([^']+)'", rm.group(1)) if rm else ['main']

    # Regex cannot find a root's closing tag through nested elements of the same
    # name — matching <div> for the ".mm" root swallowed the header and reported
    # .nav-toggle as if it were word-split. Track real depth instead.
    split_classes = _classes_inside_roots(strip_comments(read(page)), roots)

    # Only these break layout. A rule that merely recolours a word is harmless —
    # .room-slab:hover span sets colour, and tinting the words is the intended
    # effect anyway.
    LAYOUT = ('display', 'width', 'height', 'position', 'flex', 'grid',
              'margin', 'padding', 'float', 'inset', 'place-items')

    s = read(path)
    s_nc = re.sub(r'/\*.*?\*/', blank_out, s, flags=re.S)
    for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', s_nc):
        sel, body = m.group(1).strip(), m.group(2)
        if not sel or sel.startswith('@'):
            continue
        props = [d.split(':')[0].strip() for d in body.split(';') if ':' in d]
        if not any(p.startswith(LAYOUT) for p in props):
            continue
        for part in sel.split(','):
            part = part.strip()
            if not re.search(r'(^|\s|>)span\s*$', part) or '.w' in part:
                continue
            # does the ancestor part of the selector even exist inside a
            # word-split root? .nav-toggle lives in the header, before <main>,
            # so no word span can ever match it.
            anc = re.findall(r'\.([A-Za-z][\w-]*)', part)
            if anc and not any(c in split_classes for c in anc):
                continue
            checked += 1
            fail('word-span-guard', path, lineno(s_nc, m.start()),
                 'selector "%s" sets %s and also matches injected word spans; '
                 'add :not(.w):not(.wg)'
                 % (part, ', '.join(p for p in props if p.startswith(LAYOUT))))


# ── 10. cache-busted assets exist ────────────────────────────────────────
def check_cache_keys():
    """A bumped ?v= on a path that moved serves a 404 with a fresh name."""
    global checked
    for path in pages():
        s = read(path)
        for m in re.finditer(r'(?:href|src)\s*=\s*"([^"?]+)\?v=([^"]+)"', s):
            checked += 1
            f = m.group(1)
            if f.startswith(('http', '//', 'data:')):
                continue
            # same site-root rule as check_references
            cand = os.path.normpath(f.lstrip('/')) if f.startswith('/') \
                else os.path.normpath(os.path.join(os.path.dirname(path), f))
            if not os.path.exists(cand):
                fail('cache-keys', path, lineno(s, m.start()),
                     'versioned asset missing: %s?v=%s' % (m.group(1), m.group(2)))


# ── 11. the footer offers the same pages everywhere ──────────────────────
def check_footer_consistency():
    """Every page carries a hand-maintained copy of the footer, so one page can
    quietly end up offering a different set of destinations than the rest.

    Inherited from tools/check-mirror.py, which compared exactly two pages. That
    script guarded content duplicated between the homepage and its predecessor;
    that duplication is gone, but the footer is still copied across all 20 pages,
    so the check is worth more applied to all of them than to a pair.

    A page never links to itself, and the homepage link is not required
    everywhere, so both are excluded before comparing.
    """
    global checked
    def foot_links(html, own):
        m = re.search(r'<footer.*?</footer>', html, re.S | re.I)
        if not m:
            return None
        return {h for h in re.findall(r'href="([^"#]+\.html)"', m.group(0))
                if h not in (own, 'index.html')}

    feet = {}
    for path in pages():
        links = foot_links(read(path), path)
        # `is not None`, not a truthiness test: foot_links returns None when the
        # page has no footer at all and a set when it does. An empty set means a
        # footer that lost every link — the loudest version of the failure this
        # check exists for, and a plain `if links:` skipped exactly that page.
        if links is not None:
            feet[path] = links
    if len(feet) < 2:
        return

    # The reference is the union of what the feet offer. Comparing against a
    # fixed set reported every page as "missing" itself, because a page's own
    # filename is excluded from its set but contributed to the reference by all
    # the others — so the expectation has to drop that page too.
    common = set()
    for v in feet.values():
        common |= v
    for path, links in sorted(feet.items()):
        checked += 1
        expected = common - {path}
        if links != expected:
            missing = sorted(expected - links)
            extra = sorted(links - expected)
            bits = []
            if missing:
                bits.append('missing ' + ', '.join(missing))
            if extra:
                bits.append('extra ' + ', '.join(extra))
            fail('footer', path, 0, 'footer differs from the other pages: ' + '; '.join(bits))


# ── 12. the CSP still covers what each page loads ────────────────────────
def check_csp():
    """script-src is hash-based, with no 'unsafe-inline' to fall back on.

    That makes it exact and brittle in the same breath: edit one character of an
    inline script and its sha256 no longer matches, so the browser silently
    refuses to run it. On these pages that script is the theme bootstrap, so the
    symptom is a flash of the wrong theme on every page — easy to miss locally
    and shipped before anyone notices. Same for adding a new external script
    host and forgetting to list it.

    So: recompute every inline script's hash from the file on disk and require
    the page's own policy to contain it.
    """
    global checked
    import hashlib
    import base64

    for path in pages():
        s = read(path)
        m = re.search(r'<meta http-equiv="Content-Security-Policy" content="([^"]+)"', s)
        inline, ext = [], set()
        for sm in re.finditer(r'<script\b([^>]*)>(.*?)</script>', s, re.S | re.I):
            attrs, body = sm.group(1), sm.group(2)
            src = re.search(r'src\s*=\s*"(https?://[^/"]+)', attrs)
            if src:
                ext.add(src.group(1))
                continue
            if re.search(r'src\s*=', attrs) or not body.strip():
                continue
            if re.search(r'type\s*=\s*"[^"]*json', attrs):   # ld+json is data
                continue
            inline.append((sm.start(), body))

        if not m:
            # only a page that actually loads something needs a policy
            if inline or ext:
                fail('csp', path, 0, 'page runs scripts but has no CSP meta tag')
            continue

        policy = m.group(1)
        for pos, body in inline:
            checked += 1
            h = 'sha256-' + base64.b64encode(
                hashlib.sha256(body.encode('utf-8')).digest()).decode()
            if h not in policy:
                fail('csp', path, lineno(s, pos),
                     'inline script is not hashed in this page\'s CSP (%s…) — '
                     'it will be blocked; recompute the hash' % h[:24])
        for host in sorted(ext):
            checked += 1
            if host not in policy:
                fail('csp', path, 0, 'external script host %s is not in script-src' % host)


# ── 13. every page carries the clickjacking defence ──────────────────────
def check_framebuster():
    """frame-ancestors is ignored in a meta CSP and GitHub Pages cannot send
    headers, so the clickjacking defence is a hide-by-default frame-buster in
    the markup of each page.

    Being per-page markup, it is exactly the kind of thing a new page is created
    without — and its absence is invisible, because the page looks perfectly
    normal unframed. The three parts have to travel together: the style that
    hides the document, the script that reveals it when unframed, and the
    <noscript> that restores it when scripting is off. Two out of three is
    either no protection or a permanently blank page.
    """
    global checked
    HIDE = 'html{display:none}'
    REVEAL = 'self===top'
    NOSCRIPT = '<noscript><style>html{display:block}</style></noscript>'

    for path in pages():
        s = read(path)
        # only pages that carry a policy are real pages; the Search Console
        # token file is 53 bytes of text with nothing to protect
        if 'Content-Security-Policy' not in s:
            continue
        checked += 1
        missing = [n for n, tok in
                   (('hide style', HIDE), ('reveal script', REVEAL), ('noscript fallback', NOSCRIPT))
                   if tok not in s]
        if missing:
            fail('framebuster', path, 0,
                 'clickjacking defence incomplete — missing: %s' % ', '.join(missing))


# ── 14. no @media block is dead on arrival ───────────────────────────────
# Nested @media conditions AND together, so an inner condition that contradicts
# an enclosing one produces a block that can never match in any configuration.
# That is exactly commit ea92642: a `@media (pointer: coarse)` block was appended
# inside a `@media (hover: hover) and (pointer: fine)` block whose brace opened
# on the same line as a rule. The stylesheet parsed, the braces balanced, and all
# 13 checks stayed green while the rule was dead on every device. Only measuring
# the rendered element found it.
#
# The whole risk here is a parser that invents nesting that is not there, so the
# scan is conservative twice over: it proves the source parseable before saying
# anything, and it abstains on any condition it cannot fully model. Silence on a
# condition costs a miss; a wrong reading costs the suite's credibility.

# Discrete features whose values are genuinely mutually exclusive: a UA reports
# exactly one of them. Deliberately short, because the interesting mistakes are
# the features that LOOK exclusive and are not. any-pointer/any-hover are
# set-valued — a laptop with a touchscreen matches `any-pointer: coarse` AND
# `any-pointer: fine` — and color-gamut/dynamic-range are cumulative supersets,
# where a P3 display also matches srgb. All are excluded: treating any of them as
# exclusive would flag working CSS. prefers-contrast: custom is not provably
# exclusive of more/less, so that feature is out too. `prefers-color-scheme:
# no-preference` was dropped from the spec and so is not listed; a query using it
# simply falls through as an unmodelled value rather than being called a defect.
DISCRETE_MQ = {
    'pointer': ('none', 'coarse', 'fine'),
    'hover': ('none', 'hover'),
    'orientation': ('portrait', 'landscape'),
    'prefers-color-scheme': ('light', 'dark'),
    'prefers-reduced-motion': ('no-preference', 'reduce'),
    'prefers-reduced-transparency': ('no-preference', 'reduce'),
    'forced-colors': ('none', 'active'),
    'scripting': ('none', 'initial-only', 'enabled'),
    'update': ('none', 'slow', 'fast'),
    'overflow-inline': ('none', 'scroll'),
}

# Four separate quantities, never compared with one another: a small window on a
# large screen is ordinary, not a contradiction. Only the classic min-/max-/exact
# forms in px are modelled — aspect-ratio, resolution and the integer features
# are not modelled at all.
RANGE_MQ = ('width', 'height', 'device-width', 'device-height')

MEDIA_TYPES = ('all', 'print', 'screen', 'speech', 'tty', 'tv', 'projection',
               'handheld', 'braille', 'embossed', 'aural')

# Block at-rules that condition nothing about the viewport, so a @media inside
# one is still a conjunct of the chain and the chain survives them. Everything
# else with a block — @keyframes above all — is opaque: brace depth is still
# tracked through it, but no at-rule inside is recognised, because `0%,100% {`
# is a keyframe selector and not a rule.
TRANSPARENT_AT = ('supports', 'layer', 'container', 'scope')

# Order matters in the first alternation. Comments are consumed BEFORE strings,
# which is not optional: 26 comments in this repo contain an odd number of
# apostrophes ("a page's bare header"), and a strings-first scan opens a string
# at one of them and swallows hundreds of lines of real rules. Unquoted url() is
# consumed before both and excludes a leading quote, so url("x") is still left to
# the string rule. Restricting string bodies to a single line means an
# unterminated quote fails to match and survives into the parseability gate,
# where it is reported, instead of silently eating the rest of the file.
_CSS_MASK = re.compile(r'/\*.*?\*/'
                       r'|url\(\s*[^)"\'\s][^)]*\)'
                       r'|"[^"\n]*"'
                       r"|'[^'\n]*'", re.S)
_CSS_TOKEN = re.compile(r'@[-\w]+|[{};]')
_KEYFRAMES = re.compile(r'^(?:-[a-z]+-)?keyframes$')
_MQ_PX = re.compile(r'^([+-]?(?:\d+\.?\d*|\.\d+))(px)?$')
_STYLE_BLOCK = re.compile(r'<style\b[^>]*>(.*?)</style>', re.I | re.S)


def mask_css(s):
    """Blank comments, strings and unquoted url(), preserving length and lines."""
    return _CSS_MASK.sub(blank_out, s)


class _Frame(object):
    __slots__ = ('kind', 'opaque', 'prelude', 'at', 'line', 'terms',
                 'poison', 'reported')

    def __init__(self, kind, opaque=False, prelude='', at=0, line=0):
        self.kind, self.opaque = kind, opaque
        self.prelude, self.at, self.line = prelude, at, line
        self.terms, self.poison, self.reported = [], False, False


def _mq_px(v):
    """'820.5px' -> 820.5. None means "do not model this term".

    px only, plus the bare 0 that CSS allows for any length. em and rem depend on
    a font size the checker cannot see and vw is defined in terms of the very
    viewport it would be constraining, so they are refused rather than converted:
    a wrong conversion invents a contradiction that is not there. Nothing here is
    ever arithmetic — every value is parsed once and then only compared — so a
    float holds each one exactly as it was written.
    """
    m = _MQ_PX.match(v)
    if not m:
        return None                       # calc(), var(), 40em, 6e2px, 16/9, ...
    n = float(m.group(1))
    if n < 0:
        return None                       # negative is invalid for width/height
    if n and not m.group(2):
        return None                       # only 0 may be written without a unit
    return n


def _mq_bound(feat, val, op):
    """-> ('r', feature, low, high). Either bound may be None, both are inclusive."""
    n = _mq_px(val)
    if n is None:
        return None
    return {'>=': ('r', feat, n, None),
            '<=': ('r', feat, None, n),
            '=': ('r', feat, n, n)}[op]


def _mq_term(t):
    """One parenthesised test -> a modelled term, or None to ignore it.

    Ignoring a term is always sound: a chain is a pure conjunction, so dropping a
    conjunct only widens what could match and can never manufacture a finding.
    """
    if re.search(r'[<>=]', t):
        # Range syntax, (width >= 900px) and its reversed and two-sided forms.
        # Not modelled: reading one of those operators backwards would be a
        # false-positive machine, and nothing in this repo writes them. If that
        # changes, the cost is silence on those queries, never a wrong answer.
        return None
    if ':' not in t:
        return None                       # boolean context, e.g. (hover)
    name, _, val = t.partition(':')
    name, val = name.strip(), val.strip()
    if name in DISCRETE_MQ:
        # An unlisted value is deprecated (hover: on-demand) or invalid. Either
        # way the query matches nothing, but for a reason that has nothing to do
        # with nesting, so diagnosing it here would give the wrong answer.
        return ('d', name, val) if val in DISCRETE_MQ[name] else None
    for pre, op in (('min-', '>='), ('max-', '<=')):
        if name.startswith(pre) and name[len(pre):] in RANGE_MQ:
            return _mq_bound(name[len(pre):], val, op)
    if name in RANGE_MQ:
        return _mq_bound(name, val, '=')
    return None


def _mq_prelude(p):
    """-> (terms, poisoned).

    Poisoned means this condition is not a flat conjunction of simple tests, so
    nothing in the chain it belongs to may be reported. `not` inverts the sense
    of the whole query and a comma makes it a union; either one read as a
    conjunction turns a query matching almost everything into a false report.
    """
    low = ' '.join(p.lower().split())
    if ',' in low:
        return ([], True)
    if re.search(r'(?<![-\w])not(?![-\w])', low):
        return ([], True)
    if re.search(r'(?<![-\w])or(?![-\w])', low):
        return ([], True)

    groups, outside, depth, cur = [], [], 0, ''
    for ch in low:
        if ch == '(':
            depth += 1
            if depth > 1:
                return ([], True)         # calc(), var(), ((a) or (b))
            cur = ''
            continue
        if ch == ')':
            depth -= 1
            if depth < 0:
                return ([], True)
            groups.append(cur)
            continue
        if depth:
            cur += ch
        else:
            outside.append(ch)
    if depth:
        return ([], True)

    toks, n_type = ''.join(outside).split(), 0
    for i, t in enumerate(toks):
        if t == 'and':
            continue
        if t == 'only':
            if i or len(toks) < 2 or toks[1] not in MEDIA_TYPES:
                return ([], True)
        elif t in MEDIA_TYPES:
            n_type += 1
        else:
            return ([], True)             # a token we do not recognise
    if n_type > 1 or toks.count('and') != max(0, len(groups) + n_type - 1):
        return ([], True)                 # not the flat `A and B and C` assumed

    return ([t for t in (_mq_term(' '.join(g.split())) for g in groups) if t], False)


def _mq_matching(masked, open_idx):
    depth = 0
    for i in range(open_idx, len(masked)):
        if masked[i] == '{':
            depth += 1
        elif masked[i] == '}':
            depth -= 1
            if not depth:
                return i
    return None


def _mq_report(path, src, masked, stack, line0):
    """Fold the chain of enclosing @media conditions and prove it satisfiable."""
    global checked
    chain = [f for f in stack if f.kind == 'media']
    if any(f.poison for f in chain):
        return
    if any(f.reported for f in chain[:-1]):
        chain[-1].reported = True         # one finding per dead chain, not N
        return

    disc, iv, facts, hit = {}, {}, 0, None
    for fr in chain:
        for t in fr.terms:
            facts += 1
            if t[0] == 'd':
                _, feat, val = t
                if feat not in disc:
                    disc[feat] = (val, fr)
                elif disc[feat][0] != val and hit is None:
                    hit = ('d', feat, disc[feat], (val, fr))
            else:
                _, feat, lo, hi = t
                cur = iv.setdefault(feat, [None, None, fr, fr])
                if lo is not None and (cur[0] is None or lo > cur[0]):
                    cur[0], cur[2] = lo, fr
                if hi is not None and (cur[1] is None or hi < cur[1]):
                    cur[1], cur[3] = hi, fr
    if not facts:
        return                            # `@media print` alone proves nothing
    checked += 1                          # one assertion: this chain is satisfiable

    if hit is None:
        for feat in sorted(iv):
            lo, hi, lo_fr, hi_fr = iv[feat]
            if lo is None or hi is None:
                continue
            # No epsilon anywhere. CSS pixels are fractional, so max-width:820
            # with min-width:821 really is empty — 820.5 satisfies neither — and
            # must be reported, while min-width:600 with max-width:600 is
            # satisfiable at exactly 600 and must not be.
            if lo > hi:
                hit = ('r', feat, iv[feat])
                break
    if hit is None:
        return

    inner = chain[-1]
    end = _mq_matching(masked, inner.at)
    # A dead block that declares nothing kills nothing. Reporting a no-op spends
    # the reader's attention on a non-defect, which is how a suite starts getting
    # skimmed instead of read.
    if end is None or not re.search(r'\{[^{}]*:', masked[inner.at + 1:end]):
        return
    inner.reported = True

    if hit[0] == 'd':
        _, feat, (v1, f1), (v2, f2) = hit
        what = ('%s is fixed to "%s" (line %d) and to "%s" (line %d), and no '
                'device reports two values of it'
                % (feat, v1, line0 - 1 + f1.line, v2, line0 - 1 + f2.line))
    else:
        _, feat, (lo, hi, lo_fr, hi_fr) = hit
        what = ('%s must be >=%gpx (line %d) and <=%gpx (line %d) at once, and '
                'no viewport is both'
                % (feat, lo, line0 - 1 + lo_fr.line, hi, line0 - 1 + hi_fr.line))
    remedy = ('Move this block out of the enclosing @media, or drop one of the '
              'two terms.' if len(chain) > 1 else
              'Drop or widen one of the two terms.')
    trail = ' > '.join(f.prelude for f in chain)
    if len(trail) > 160:
        trail = trail[:157] + '...'
    fail('media-dead', path, line0 - 1 + inner.line,
         'dead @media: %s, so nothing in this block can ever apply. %s  chain: %s'
         % (what, remedy, trail))


def _mq_scan(path, src, line0):
    """Walk one block of CSS, reporting any @media chain that cannot be satisfied.

    line0 is the line the source starts on, so a <style> block reports positions
    in its PAGE rather than in the fragment.
    """
    masked = mask_css(src)

    # Prove the source parseable before believing anything derived from it. A
    # leftover /* or quote means an unterminated construct, and unbalanced braces
    # mean the frame stack is fiction — a fictional stack invents nesting that is
    # not in the file, which is the worst failure available here.
    #
    # This is reported rather than skipped. Skipping is how a check ends up
    # covering nothing while still printing "ok", and a check that gives the same
    # answer whether or not it ran is worth nothing. Either the CSS really is
    # malformed or the masker above needs extending; both are worth a human's
    # attention, and neither is a guess about what the CSS means.
    why = None
    if '/*' in masked:
        why = 'unterminated /* comment'
    elif '"' in masked or "'" in masked:
        why = 'unterminated string literal'
    else:
        depth = 0
        for ch in masked:
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth < 0:
                    why = 'a } arrives with no matching {'
                    break
        if why is None and depth:
            why = '%d unclosed block(s) at end of source' % depth
    if why:
        fail('media-dead', path, line0,
             'cannot analyse this CSS (%s), so nothing here is covered — fix the '
             'source, or teach mask_css() the construct' % why)
        return

    stack, pending, opaque = [], None, 0
    for m in _CSS_TOKEN.finditer(masked):
        tok = m.group(0)
        if tok[0] == '@':
            if opaque:
                continue                  # inside @keyframes: percentages, not rules
            if pending is not None:
                return                    # `@media ... @foo {` is not CSS we model
            pending = (tok[1:].lower(), m.start())
        elif tok == ';':
            pending = None                # @import/@charset/@layer a,b; open no block
        elif tok == '{':
            if pending is None:
                fr = _Frame('rule', opaque=bool(opaque))
            else:
                name, at = pending
                pending = None
                if name == 'media':
                    fr = _Frame('media',
                                prelude=' '.join(src[at:m.start()].split()),
                                at=m.start(), line=lineno(src, at))
                    fr.terms, fr.poison = _mq_prelude(
                        masked[at + 1 + len(name):m.start()])
                elif _KEYFRAMES.match(name) or name not in TRANSPARENT_AT:
                    fr = _Frame('at', opaque=True)
                else:
                    fr = _Frame('at')
            if fr.opaque:
                opaque += 1
            stack.append(fr)
            if fr.kind == 'media' and not opaque:
                _mq_report(path, src, masked, stack, line0)
        else:                             # '}'
            if not stack:
                return
            if stack.pop().opaque:
                opaque -= 1


def check_media_dead():
    """A @media nested inside a condition it contradicts is dead in every
    configuration, and nothing says so: the file parses and the braces balance.

    Both surfaces are scanned. The stylesheets are the obvious one, but 8 pages
    carry @media rules inside inline <style> blocks, and the same mistake made
    there would be just as invisible.
    """
    for path in sorted(glob.glob('*.css') + glob.glob('assets/*.css')):
        _mq_scan(path, read(path), 1)
    for path in pages():
        s = read(path)
        for m in _STYLE_BLOCK.finditer(s):
            _mq_scan(path, m.group(1), lineno(s, m.start(1)))


# ── 15. an aria-label must not swallow the words on the control ──────────
def check_link_names():
    """Two ways a link's name goes wrong, both of which happened here.

    WCAG 2.5.3, Label in Name: the accessible name must CONTAIN the text shown
    on the control, so someone driving the page by voice can say what they can
    see. An aria-label REPLACES the name rather than adding to it, which makes
    it easy to improve a link's wording and silently break this. Exactly that:
    three "View project ↗" buttons were labelled "<Product> — view project" and
    the literal arrow — a real text node, not an icon — stopped being part of
    the name.

    SYMBOLS ARE DELIBERATELY NOT STRIPPED. The first version of this comparison
    normalised with [^a-z0-9 ] -> ' ' on both sides, which deleted the arrow
    from the visible text and from the label alike and made the mismatch
    unrepresentable. It passed on the links it should have caught. A test that
    cannot express the failure always passes, and it looks exactly like a test
    that works.

    Whitespace is REMOVED from both sides rather than collapsed, because the
    visible text is reconstructed by deleting tags: the Project Office wordmark
    is one rendered word split across three inline elements, so any rule that
    inserts a space at a tag boundary invents one the reader never sees, and any
    rule that does not invents the opposite problem elsewhere. Ignoring
    whitespace entirely is what the ACT rule does and sidesteps both.

    And WCAG 2.4.4 from the other side: one name must not lead to two
    destinations on the same page. A name repeating is fine when every link
    carrying it goes to the same place — the product cards deliberately do that,
    an invisible overlay and a visible button sharing one name and one href.

    KNOWN BLIND SPOT: this reads static HTML, so any control BUILT BY SCRIPT is
    invisible to it. That is not hypothetical — products.js:126 creates five
    room-exit buttons reading "Back to project corridor" that carried the label
    "Return to the project corridor", and every one of them sailed past a green
    run of this check. They were caught in the browser instead. A page that
    passes here has not been cleared, only its markup has."""
    global checked
    tag_re = re.compile(r'<(a|button)\b([^>]*)>(.*?)</\1\s*>', re.S | re.I)
    attr_re = re.compile(r'([\w-]+)\s*=\s*"([^"]*)"')
    alt_re = re.compile(r'<img\b[^>]*\balt\s*=\s*"([^"]*)"', re.I)

    def norm(s):
        """Lowercase, tags gone, whitespace gone. Nothing else removed."""
        return re.sub(r'\s+', '', html.unescape(re.sub(r'<[^>]+>', '', s))).lower()

    def shown(s):
        return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s))).strip()

    for path in pages():
        s = strip_comments(read(path))
        by_name = defaultdict(set)
        first_line = {}
        for m in tag_re.finditer(s):
            attrs = dict(attr_re.findall(m.group(2)))
            label = attrs.get('aria-label')
            inner = m.group(3)
            visible = norm(inner)

            # 2.5.3 governs "labels that include text or images of text". A
            # control whose whole visible content is a glyph — the lightbox's ✕
            # ‹ ›, the ↑ on back-to-top — has no text label to match, and
            # nobody speaks "‹" to activate Previous. Requiring the glyph inside
            # the name would force "Previous ‹", which is worse for a listener
            # and helps no one. So: skip when there is not a single letter or
            # digit anywhere in the visible content.
            #
            # This is NOT the symbol-stripping mistake the docstring warns
            # about. That one removed symbols from text that also had words, and
            # so lost the difference under test. This decides whether 2.5.3
            # applies at all, and where it does, the comparison stays exact —
            # "View project ↗" has words, so its arrow is still required.
            if label and visible and re.search(r'[^\W_]', shown(inner), re.UNICODE):
                checked += 1
                if visible not in norm(label):
                    fail('link-names', path, lineno(s, m.start()),
                         'aria-label "%s" does not contain the visible text "%s" '
                         '(WCAG 2.5.3 Label in Name)' % (label, shown(inner)))

            if m.group(1).lower() != 'a':
                continue
            href = attrs.get('href', '')
            if not href or href.startswith('#'):
                continue
            alt = alt_re.search(inner)
            name = norm(label) if label else (visible or norm(alt.group(1) if alt else ''))
            if not name:
                continue
            checked += 1
            by_name[name].add(href)
            first_line.setdefault(name, lineno(s, m.start()))

        for name, hrefs in sorted(by_name.items()):
            if len(hrefs) > 1:
                fail('link-names', path, first_line[name],
                     'the name "%s" leads to %d different destinations (%s) — '
                     'a links list cannot tell them apart (WCAG 2.4.4)'
                     % (name, len(hrefs), ', '.join(sorted(hrefs))))


CHECKS = [
    ('references', check_references, 'every local href/src/url() resolves on disk'),
    ('anchors', check_anchors, 'every #fragment matches an id on that page'),
    ('duplicate-ids', check_duplicate_ids, 'ids are unique within a page'),
    ('aria-refs', check_aria_refs, 'aria-controls/labelledby/describedby resolve'),
    ('tag-balance', check_tag_balance, 'tags open and close in order'),
    ('nested-anchors', check_nested_anchors, 'no <a> inside an <a>'),
    ('headings', check_single_h1, 'at most one <h1> per page'),
    ('images', check_images, '<img> has alt and intrinsic width/height'),
    ('word-span-guard', check_word_span_guards, 'no bare span selector catches word spans'),
    ('cache-keys', check_cache_keys, 'versioned assets exist'),
    ('footer', check_footer_consistency, 'every page footer offers the same destinations'),
    ('csp', check_csp, "every inline script is hashed in its page's CSP"),
    ('framebuster', check_framebuster, 'every page carries the clickjacking defence'),
    ('media-dead', check_media_dead, 'no @media is nested inside a condition it contradicts'),
    ('link-names', check_link_names, 'an aria-label keeps the visible words, and one name means one destination'),
]


def main():
    if '--list' in sys.argv:
        for name, _fn, why in CHECKS:
            print('  %-18s %s' % (name, why))
        return 0

    for name, fn, _why in CHECKS:
        fn()

    by_check = defaultdict(list)
    for c, p, ln, msg in failures:
        by_check[c].append((p, ln, msg))

    print('  %d assertions over %d pages\n' % (checked, len(pages())))
    for name, _fn, _why in CHECKS:
        hits = by_check.get(name, [])
        if hits:
            print('  FAIL  %-18s %d problem(s)' % (name, len(hits)))
            for p, ln, msg in hits[:12]:
                print('          %s:%s  %s' % (p, ln, msg))
            if len(hits) > 12:
                print('          ... and %d more' % (len(hits) - 12))
        else:
            print('  ok    %s' % name)

    print()
    if failures:
        print('  %d problem(s)' % len(failures))
    else:
        print('  all checks passed')
    return min(len(failures), 120)


if __name__ == '__main__':
    sys.exit(main())
