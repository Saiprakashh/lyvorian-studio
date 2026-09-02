# -*- coding: utf-8 -*-
"""selftest-check-site.py — proves check-site.py can still fail.

check-site.py went green only after several of its own rules were corrected,
which is precisely how a suite that detects nothing gets built. A green run is
worth nothing unless the same code is known to go red on a real fault.

So: build a throwaway site in a temp directory, inject one known fault at a
time, and assert the matching check reports it. If any injected fault comes back
clean, that check is asleep and the suite is lying about the real site.

    python tools/selftest-check-site.py
"""
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CHECKER = os.path.join(HERE, 'check-site.py')

GOOD_PAGE = '''<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Fixture</title>
<link rel="stylesheet" href="assets/site.css"/>
<meta http-equiv="Content-Security-Policy" content="script-src 'self' 'sha256-CihokcEcBW4atb/CW/XWsvWwbTjqwQlE9nj9ii5ww5M=' 'sha256-8qh7h0fiqWRSuWtywGnY9Afvl+upErsfWgIoj/znuPY='"/>
<style>html{display:none}</style>
<script>if(self===top){document.documentElement.style.display='block'}</script>
<noscript><style>html{display:block}</style></noscript>
<script>console.log(1)</script>
</head>
<body>
<main>
  <h1>Heading</h1>
  <p>Some words here.</p>
  <a href="#target">Jump</a>
  <button aria-controls="panel" aria-expanded="false">Toggle</button>
  <div id="panel">Panel</div>
  <section id="target">
    <img src="assets/pic.webp" alt="A picture" width="10" height="10"/>
  </section>
</main>
</body>
</html>
'''

# Each fault: (check name it must trip, how to break the fixture), with an
# optional label in the middle when one check needs several faults to be called
# proven — media-dead has three separate jobs and a green run on one of them says
# nothing about the other two.
FAULTS = [
    ('references',
     lambda d: patch(d, 'index.html', 'assets/site.css', 'assets/gone.css')),
    ('anchors',
     lambda d: patch(d, 'index.html', 'href="#target"', 'href="#nowhere"')),
    ('duplicate-ids',
     lambda d: patch(d, 'index.html', '<div id="panel">Panel</div>',
                     '<div id="panel">Panel</div><div id="panel">Again</div>')),
    ('aria-refs',
     lambda d: patch(d, 'index.html', 'aria-controls="panel"', 'aria-controls="ghost"')),
    ('tag-balance',
     lambda d: patch(d, 'index.html', '<section id="target">',
                     '<section id="target"><div>')),
    ('nested-anchors',
     lambda d: patch(d, 'index.html', '<a href="#target">Jump</a>',
                     '<a href="#target">Jump <a href="#target">inner</a></a>')),
    ('headings',
     lambda d: patch(d, 'index.html', '<h1>Heading</h1>',
                     '<h1>Heading</h1><h1>Second</h1>')),
    ('images',
     lambda d: patch(d, 'index.html', ' width="10" height="10"', '')),
    ('cache-keys',
     lambda d: patch(d, 'index.html', 'href="assets/site.css"',
                     'href="assets/nope.css?v=1"')),
    ('footer',
     lambda d: patch(d, 'other.html', '<a href="third.html">Third</a>', '')),
    ('csp',
     lambda d: patch(d, 'index.html', 'console.log(1)', 'console.log(2)')),
    ('framebuster',
     lambda d: patch(d, 'index.html',
                     '<noscript><style>html{display:block}</style></noscript>', '')),
    ('word-span-guard',
     lambda d: append(d, 'assets/descent.css',
                      '\n.plan-steps span { display: block; }\n')),

    # The shape of commit ea92642: an inner condition contradicting the one it
    # is nested in. This is the fault the check exists for.
    ('media-dead', 'contradiction in a stylesheet',
     lambda d: append(d, 'assets/descent.css',
                      '\n@media (pointer: fine) {\n'
                      '  @media (pointer: coarse) { .dead { color: red; } }\n}\n')),

    # 8 pages carry @media inside inline <style>. If the check only ever reads
    # .css files it looks just as green while covering none of them.
    ('media-dead', 'contradiction in an inline <style>',
     lambda d: patch(d, 'index.html', '<style>html{display:none}</style>',
                     '<style>html{display:none}</style>'
                     '<style>@media (max-width: 500px) {'
                     ' @media (min-width: 900px) { .dead { color: red; } } }</style>')),

    # Silence on an unparseable file is how a check ends up covering nothing and
    # still printing "ok". It has to say so out loud.
    ('media-dead', 'unparseable CSS is reported, not skipped',
     lambda d: append(d, 'assets/descent.css', '\n.z { content: "never closed ;\n')),
]


def patch(d, name, old, new):
    p = os.path.join(d, name)
    s = io.open(p, encoding='utf-8').read()
    assert old in s, 'fixture missing %r' % old
    io.open(p, 'w', encoding='utf-8', newline='').write(s.replace(old, new, 1))


def append(d, name, extra):
    p = os.path.join(d, name)
    s = io.open(p, encoding='utf-8').read() if os.path.exists(p) else ''
    io.open(p, 'w', encoding='utf-8', newline='').write(s + extra)


def build(d):
    """A minimal site the checker considers clean."""
    os.makedirs(os.path.join(d, 'assets'), exist_ok=True)
    os.makedirs(os.path.join(d, 'tools'), exist_ok=True)
    io.open(os.path.join(d, 'index.html'), 'w', encoding='utf-8',
            newline='').write(GOOD_PAGE)
    for f in ('assets/site.css', 'assets/pic.webp'):
        io.open(os.path.join(d, f), 'w', encoding='utf-8', newline='').write('/* x */')

    # the footer check compares pages against each other, so it needs a second
    # page with a footer before it has anything to say
    foot = ('<footer><a href="index.html">Home</a>'
            '<a href="other.html">Other</a><a href="third.html">Third</a></footer>')
    io.open(os.path.join(d, 'other.html'), 'w', encoding='utf-8', newline='').write(
        GOOD_PAGE.replace('</body>', foot + '</body>'))
    io.open(os.path.join(d, 'third.html'), 'w', encoding='utf-8', newline='').write(
        GOOD_PAGE.replace('</body>', foot + '</body>'))

    # the word-span check only runs when all three of these exist, and it reads
    # the split roots out of the script
    # the word-span check reads index.html, so the fixture's index.html is the
    # one that must carry a .plan-steps marker for the injected fault to bite
    io.open(os.path.join(d, 'index.html'), 'w', encoding='utf-8',
            newline='').write(GOOD_PAGE
                .replace('<main>', '<main><div class="plan-steps"><span>01</span></div>')
                .replace('</body>', foot + '</body>'))
    io.open(os.path.join(d, 'assets/descent.js'), 'w', encoding='utf-8', newline='').write(
        "['main', 'footer.foot', '.mm'].forEach(function (sel) { split(sel); });\n")
    io.open(os.path.join(d, 'assets/descent.css'), 'w', encoding='utf-8',
            newline='').write('.ok { color: red; }\n')


def run(d):
    r = subprocess.run([sys.executable, CHECKER, '--root', d],
                       capture_output=True, text=True)
    return r.stdout + r.stderr


def main():
    base = tempfile.mkdtemp(prefix='lyv-selftest-')
    try:
        # 1. the clean fixture must pass, or every later result is meaningless
        clean = os.path.join(base, 'clean')
        os.makedirs(clean)
        build(clean)
        out = run(clean)
        if 'all checks passed' not in out:
            print('  FIXTURE NOT CLEAN — the suite reports problems in a file '
                  'that has none, so it cannot be trusted:\n')
            print(out)
            return 1
        print('  ok    clean fixture passes')

        # 2. every injected fault must be caught by its own check
        bad = 0
        for n, entry in enumerate(FAULTS):
            check, inject = entry[0], entry[-1]
            label = entry[1] if len(entry) == 3 else check
            d = os.path.join(base, 'f%02d_%s' % (n, check))
            shutil.copytree(clean, d)
            inject(d)
            out = run(d)
            caught = re.search(r'^\s*FAIL\s+%s\b' % re.escape(check), out, re.M)
            if caught:
                print('  ok    %-18s catches its fault' % label)
            else:
                bad += 1
                print('  ASLEEP %-17s injected fault NOT reported' % label)
                print('         ---- output ----')
                for ln in out.splitlines():
                    print('         ' + ln)
        print()
        if bad:
            print('  %d check(s) asleep — a green run proves nothing for those' % bad)
        else:
            print('  all %d checks proven to fail on a real fault' % len(FAULTS))
        return bad
    finally:
        shutil.rmtree(base, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
