# -*- coding: utf-8 -*-
"""Catch index.html and share-an-idea.html drifting apart.

Several blocks are duplicated between the two pages by hand — the three rules,
the roadmap, the studio notes, the footer link sets. They match today because
they were copied verbatim, and nothing keeps them matching tomorrow. This site
has no build step, so there is no way to single-source them; the next best
thing is to notice the moment they diverge.

Run it after editing either page:

    python tools/check-mirror.py

Exit code 0 = in sync, 1 = drift (so it can gate a commit hook or CI).
"""
import io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(name):
    s = io.open(os.path.join(ROOT, name), encoding='utf-8').read()
    return re.sub(r'<script[^>]*>.*?</script>', ' ', s, flags=re.S)


def texts(html, pattern):
    """Normalised inner text of every match, so whitespace and markup differences
    between the two pages do not read as content drift."""
    out = []
    for m in re.finditer(pattern, html, re.S | re.I):
        t = re.sub(r'<[^>]+>', ' ', m.group(1))
        t = re.sub(r'&mdash;', '—', t)
        t = re.sub(r'&amp;', '&', t)
        t = re.sub(r'&rarr;', '→', t)
        t = re.sub(r'\s+', ' ', t).strip()
        if t:
            out.append(t)
    return out


idx, prev = load('index.html'), load('share-an-idea.html')

# One pattern per page, because the two pages are different designs. These
# follow the DESIGN, not the filename: index.html now carries what used to be
# descent.html, and share-an-idea.html carries the old homepage's markup.
# Getting these the wrong way round makes both sides match zero items and the
# check reports "in sync" while comparing nothing.
CHECKS = [
    ('the three rules',
     r'class="rule-card"[^>]*>.*?<h3>.*?</h3>\s*<p>(.*?)</p>',
     r'class="value-desc"[^>]*>(.*?)</p>'),
    ('roadmap entries',
     r'class="road-desc"[^>]*>(.*?)</p>',
     r'class="roadmap-desc"[^>]*>(.*?)</p>'),
    ('studio notes',
     r'class="log-item"><span>[^<]*</span><p>(.*?)</p>',
     r'class="note-item"><span class="note-date">[^<]*</span><span>(.*?)</span>'),
]

# A comparison of nothing is not a pass. If either side extracts zero items the
# pattern no longer matches its page, and the check must say so.
GUARD_EMPTY = True

problems = 0
for label, pat_idx, pat_prev in CHECKS:
    a, b = texts(idx, pat_idx), texts(prev, pat_prev)
    if GUARD_EMPTY and not a and not b:
        print('  FAIL  %-18s both sides matched 0 items — the patterns no longer '
              'fit these pages, so this check is proving nothing' % label)
        problems += 1
        continue
    if a == b:
        print('  OK    %-18s %d item(s) match' % (label, len(a)))
        continue
    problems += 1
    print('  DRIFT %-18s index=%d preview=%d' % (label, len(a), len(b)))
    for i in range(max(len(a), len(b))):
        x = a[i] if i < len(a) else '(missing)'
        y = b[i] if i < len(b) else '(missing)'
        if x != y:
            print('        [%d] index.html : %s' % (i, x[:96]))
            print('            descent    : %s' % y[:96])

# Footer targets: the same set of pages should be reachable from both feet.
# A page never links to itself, so each page's own filename is excluded —
# otherwise share-an-idea.html's link home to index.html reads as false drift.
def foot_links(html, own):
    m = re.search(r'<footer.*?</footer>', html, re.S | re.I)
    if not m:
        return set()
    return {h for h in re.findall(r'href="([^"#]+\.html)"', m.group(0))
            if h not in (own, 'index.html', 'share-an-idea.html')}

fa, fb = foot_links(idx, 'index.html'), foot_links(prev, 'share-an-idea.html')
if fa == fb:
    print('  OK    %-18s %d target(s) match' % ('footer links', len(fa)))
else:
    problems += 1
    print('  DRIFT %-18s' % 'footer links')
    if fa - fb: print('        only in index.html : %s' % ', '.join(sorted(fa - fb)))
    if fb - fa: print('        only in descent    : %s' % ', '.join(sorted(fb - fa)))

print()
print('in sync' if not problems else '%d block(s) have drifted' % problems)
sys.exit(1 if problems else 0)
