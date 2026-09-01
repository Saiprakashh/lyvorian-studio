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

# Each fault: (check name it must trip, how to break the fixture)
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
    ('word-span-guard',
     lambda d: append(d, 'assets/descent.css',
                      '\n.plan-steps span { display: block; }\n')),
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

    # the word-span check only runs when all three of these exist, and it reads
    # the split roots out of the script
    io.open(os.path.join(d, 'descent.html'), 'w', encoding='utf-8',
            newline='').write(GOOD_PAGE.replace('Fixture', 'Descent').replace(
                '<main>', '<main><div class="plan-steps"><span>01</span></div>'))
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
        for check, inject in FAULTS:
            d = os.path.join(base, 'f_' + check)
            shutil.copytree(clean, d)
            inject(d)
            out = run(d)
            caught = re.search(r'^\s*FAIL\s+%s\b' % re.escape(check), out, re.M)
            if caught:
                print('  ok    %-18s catches its fault' % check)
            else:
                bad += 1
                print('  ASLEEP %-17s injected fault NOT reported' % check)
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
