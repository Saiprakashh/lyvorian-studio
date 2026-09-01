# -*- coding: utf-8 -*-
"""check-sri.py — does each pinned external script still match its SRI hash?

The site pins its one third-party script by hash. That is the right call: an
unpinned rolling build from a host we do not control runs with full privilege
in our origin, on the same page as the feedback form. But pinning has a failure
mode of its own — if the CDN ever serves different bytes, the browser refuses
the script and says nothing to us. Analytics simply stops. There is no error,
no broken layout, no console message on the visitor's machine we would ever
see; the numbers just flatten.

check-site.py cannot cover this. It verifies INLINE script hashes, which it
computes from files on disk, and it must stay offline and deterministic. This
one has to reach the network, so it lives apart and is run deliberately.

    python tools/check-sri.py              check every pinned script
    python tools/check-sri.py --selftest   prove it can actually report drift

Exit codes: 0 all matched, 1 drift, 2 could not verify (network, HTTP error).
A run that could not reach the CDN is NOT a pass — it exits 2 and says so,
because a check that returns the same answer whether or not it worked is worth
nothing.
"""
import base64
import glob
import hashlib
import io
import os
import re
import sys
import urllib.request
import urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# --root points the check at a fixture directory, which is how the
# "unreachable is not a pass" branch is proved to work without taking the
# machine offline.
if '--root' in sys.argv:
    ROOT = sys.argv[sys.argv.index('--root') + 1]
os.chdir(ROOT)

ALGOS = {'sha256': hashlib.sha256, 'sha384': hashlib.sha384, 'sha512': hashlib.sha512}
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120.0 Safari/537.36')


def pinned_scripts():
    """(page, url, [integrity tokens]) for every external script carrying SRI."""
    out = []
    tag = re.compile(r'<script\b[^>]*>', re.I)
    for page in sorted(glob.glob('*.html')):
        s = io.open(page, encoding='utf-8').read()
        for m in tag.finditer(s):
            t = m.group(0)
            src = re.search(r'\bsrc\s*=\s*"([^"]+)"', t)
            integ = re.search(r'\bintegrity\s*=\s*"([^"]+)"', t)
            if not src or not integ:
                continue
            url = src.group(1)
            if url.startswith('//'):
                url = 'https:' + url
            if not url.startswith('http'):
                continue                      # same-origin scripts are not pinned
            out.append((page, url, integ.group(1).split()))
    return out


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=25) as r:
        if r.status != 200:
            raise urllib.error.HTTPError(url, r.status, 'not 200', r.headers, None)
        return r.read()


def digest(body, algo):
    return algo + '-' + base64.b64encode(ALGOS[algo](body).digest()).decode()


def check(expected_override=None):
    """expected_override: force a wrong hash, to prove drift is detected."""
    items = pinned_scripts()
    if not items:
        print('  no externally-hosted scripts carry an integrity attribute')
        return 0

    # one fetch per distinct URL, even when several pages pin the same script
    bodies, unreachable = {}, {}
    for _page, url, _tokens in items:
        if url in bodies or url in unreachable:
            continue
        try:
            bodies[url] = fetch(url)
        except Exception as e:                # noqa: BLE001 - any failure is "unverified"
            unreachable[url] = '%s: %s' % (type(e).__name__, e)

    drift, unverified = 0, 0
    for page, url, tokens in items:
        if url in unreachable:
            unverified += 1
            print('  ??    %-26s %s' % (page, url))
            print('        could NOT verify — %s' % unreachable[url])
            continue

        body = bodies[url]
        # per spec any one matching token satisfies the check
        matched, computed = False, []
        for tok in tokens:
            algo = tok.split('-', 1)[0].lower()
            if algo not in ALGOS:
                computed.append('unsupported algorithm %r' % algo)
                continue
            got = digest(body, algo)
            computed.append(got)
            want = expected_override or tok
            if got == want:
                matched = True
        if matched:
            print('  ok    %-26s %s' % (page, url))
            print('        %s (%d bytes)' % (tokens[0][:34] + '…', len(body)))
        else:
            drift += 1
            print('  DRIFT %-26s %s' % (page, url))
            print('        pinned : %s' % (expected_override or tokens[0]))
            print('        served : %s' % (computed[0] if computed else '(none)'))
            print('        The browser is refusing this script right now. Recompute')
            print('        the hash from the served file, or pin a different build.')

    print()
    if unverified:
        print('  %d script(s) COULD NOT BE VERIFIED — this is not a pass' % unverified)
        return 2
    if drift:
        print('  %d script(s) drifted from their pinned hash' % drift)
        return 1
    print('  all %d pinned script(s) match' % len(items))
    return 0


def selftest():
    """A green run means nothing unless the same code goes red on real drift.

    Feed the checker a deliberately wrong hash against the live file: it must
    report DRIFT. Then run it normally, where it must report a match.
    """
    print('  1. with a deliberately wrong pinned hash, it must report DRIFT')
    wrong = 'sha384-' + base64.b64encode(hashlib.sha384(b'not the real file').digest()).decode()
    rc = check(expected_override=wrong)
    if rc != 1:
        print('\n  ASLEEP — a wrong hash did not produce a drift result (rc=%d).' % rc)
        print('  If rc=2 the CDN was unreachable and this proves nothing; retry online.')
        return 1

    print()
    print('  2. with the real pinned hash, it must report a match')
    rc = check()
    if rc != 0:
        print('\n  the real hash did not match (rc=%d) — see above' % rc)
        return rc

    print()
    print('  proven: this check reports drift when the bytes differ, and passes')
    print('  when they do not.')
    return 0


if __name__ == '__main__':
    sys.exit(selftest() if '--selftest' in sys.argv else check())
