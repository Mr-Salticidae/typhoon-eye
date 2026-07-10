#!/usr/bin/env python3
"""Preflight checks for Bilibili Toy static packages."""
from __future__ import annotations
import argparse, re, struct, sys, urllib.parse, zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

MAX_MB = 20.0
ATTR_RE = re.compile(r'''\b(?:src|href|poster|data)\s*=\s*(["'])([^"']+)\1''', re.I)
CSS_RE = re.compile(r'''url\(\s*["']?([^'"\)]+)''', re.I)
HASH_RE = re.compile(r'''<a\b[^>]*href\s*=\s*["']#(?![!/])''', re.I)
TITLE_RE = re.compile(r'<title[^>]*>.*?</title>', re.I | re.S)

@dataclass
class Finding:
    level: str
    file: str
    message: str

class Report:
    def __init__(self): self.items: list[Finding] = []
    def error(self, f, m): self.items.append(Finding('ERROR', f, m))
    def warn(self, f, m): self.items.append(Finding('WARN', f, m))
    @property
    def failed(self): return any(x.level == 'ERROR' for x in self.items)

def args():
    p = argparse.ArgumentParser()
    p.add_argument('path')
    p.add_argument('--poster')
    p.add_argument('--require-poster', action='store_true')
    p.add_argument('--slug')
    p.add_argument('--require-root-index', action='store_true')
    p.add_argument('--max-zip-mb', type=float, default=MAX_MB)
    return p.parse_args()

def ignored(rel: str) -> bool:
    parts = PurePosixPath(rel).parts
    return any(x.startswith('.') or x in {'node_modules','__MACOSX'} for x in parts) or (parts and parts[-1] in {'toy.yaml','.DS_Store'})

def collect(root: Path, r: Report):
    if root.suffix.lower() == '.zip':
        try:
            z = zipfile.ZipFile(root)
            files = {i.filename.replace('\\','/').lstrip('/') for i in z.infolist() if not i.is_dir() and not ignored(i.filename)}
            return files, lambda rel: z.read(rel), z
        except Exception as e:
            r.error(str(root), f'unreadable ZIP: {e}'); return set(), lambda _: b'', None
    if not root.is_dir():
        r.error(str(root), 'path must be a directory or ZIP'); return set(), lambda _: b'', None
    files = {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() and not ignored(p.relative_to(root).as_posix())}
    return files, lambda rel: (root / rel).read_bytes(), None

def image_size(path: Path):
    b = path.read_bytes()
    if b.startswith(b'\x89PNG\r\n\x1a\n') and len(b) >= 24: return struct.unpack('>II', b[16:24])
    if b.startswith(b'\xff\xd8'):
        i = 2
        while i + 9 < len(b):
            if b[i] != 0xff: i += 1; continue
            marker = b[i+1]; i += 2
            if marker in {0xd8,0xd9}: continue
            if i + 2 > len(b): break
            n = int.from_bytes(b[i:i+2], 'big')
            if marker in {0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf}:
                return int.from_bytes(b[i+5:i+7],'big'), int.from_bytes(b[i+3:i+5],'big')
            i += n
    return None

def check_ref(rel, url, files, r):
    url = url.strip()
    if not url or url.startswith(('#','data:','blob:','javascript:','mailto:','tel:')): return
    if url.startswith(('http://','https://','//')):
        if rel.endswith(('.html','.htm')): r.warn(rel, f'direct external URL should be click-tested in Toy: {url}')
        return
    if url.startswith('/'):
        r.error(rel, f'root-relative asset is unsafe under /toy/<slug>/: {url}'); return
    clean = urllib.parse.unquote(url.split('#',1)[0].split('?',1)[0])
    target = (PurePosixPath(rel).parent / clean).as_posix()
    while target.startswith('./'): target = target[2:]
    if target.startswith('../'): r.warn(rel, f'asset points outside package: {url}')
    elif target not in files: r.error(rel, f'missing local asset: {url} -> {target}')

def main():
    a = args(); root = Path(a.path).expanduser(); r = Report()
    files, read, closer = collect(root, r)
    try:
        lower = {x.lower() for x in files}
        if a.require_root_index and 'index.html' not in lower: r.error('.', 'missing root index.html')
        elif 'index.html' not in lower: r.warn('.', 'root index.html not found')
        if 'package.json' in files and any(x.startswith(('src/','app/','pages/')) for x in files):
            r.warn('.', 'looks like a framework source root; upload static build output instead')
        if a.slug and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]*', a.slug): r.error('slug', 'invalid slug')
        total = sum((root / x).stat().st_size for x in files) if root.is_dir() else root.stat().st_size
        if total > a.max_zip_mb * 1024 * 1024: r.warn('.', f'package is {total/1024/1024:.1f} MB; recommended under {a.max_zip_mb:g} MB')
        for rel in sorted(files):
            if not rel.lower().endswith(('.html','.htm','.css')): continue
            text = read(rel).decode('utf-8','replace')
            if rel.lower().endswith(('.html','.htm')):
                if not TITLE_RE.search(text): r.warn(rel, 'missing <title>')
                if HASH_RE.search(text): r.error(rel, 'native href="#..." is unsupported; use scrollIntoView')
                for token in ('location.hash','history.pushState','history.replaceState'):
                    if token in text: r.warn(rel, f'URL mutation may break Toy navigation: {token}')
                for m in ATTR_RE.finditer(text): check_ref(rel, m.group(2), files, r)
            for m in CSS_RE.finditer(text): check_ref(rel, m.group(1), files, r)
        if a.poster:
            p = Path(a.poster).expanduser()
            if not p.is_file(): r.error('poster', 'poster file not found')
            elif p.suffix.lower() not in {'.png','.jpg','.jpeg'}: r.error('poster', 'poster must be png, jpg, or jpeg')
            else:
                dim = image_size(p)
                if not dim: r.warn('poster', 'could not read image dimensions')
                elif abs(dim[0]/dim[1] - 4/3) > 0.08: r.warn('poster', f'cover is {dim[0]}x{dim[1]}; 4:3 is recommended')
        elif a.require_poster: r.error('poster', 'poster is required')
    finally:
        if closer: closer.close()
    if r.items:
        for x in r.items: print(f'{x.level}: {x.file}: {x.message}')
    else: print('OK: no static-package issues found')
    print(f'Summary: {sum(x.level=="ERROR" for x in r.items)} error(s), {sum(x.level=="WARN" for x in r.items)} warning(s)')
    return 1 if r.failed else 0

if __name__ == '__main__': sys.exit(main())
