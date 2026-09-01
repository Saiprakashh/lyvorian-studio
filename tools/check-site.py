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
from collections import Counter, defaultdict

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


def strip_comments(s):
    """Blank out HTML comments, keeping length so offsets stay valid."""
    return re.sub(r'<!--.*?-->', lambda m: ' ' * len(m.group(0)), s, flags=re.S)


# ── 1. every local reference resolves ────────────────────────────────────
def check_references():
    """A dangling href/src is a 404 the visitor finds, not the author."""
    global checked
    ref_re = re.compile(r'(?:href|src)\s*=\s*"([^"]+)"')
    url_re = re.compile(r'url\(\s*[\'"]?([^\'")]+)[\'"]?\s*\)')

    targets = [(p, ref_re) for p in pages()]
    targets += [(p, url_re) for p in glob.glob('*.css') + glob.glob('assets/*.css')]

    for path, rx in targets:
        s = read(path)
        base = os.path.dirname(path)
        for m in rx.finditer(s):
            raw = m.group(1).strip()
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
        for m in re.finditer(r'href\s*=\s*"#([^"]+)"', s):
            frag = m.group(1)
            if not frag:
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
    s_nc = re.sub(r'/\*.*?\*/', lambda m: ' ' * len(m.group(0)), s, flags=re.S)
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
