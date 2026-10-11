#!/usr/bin/env python3
"""Produce a clean, versioned artifact from an explicit source allowlist."""
import json
import pathlib
import re
import sys
import zipfile

root = pathlib.Path(__file__).resolve().parent.parent
destination = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else root.parent / 'Downloads/secure_course_search_v1.10_per_user_infinity.zip')
if destination.exists():
    raise SystemExit('Destination exists; inspect it before choosing a new output path.')
files = ['package.json', 'server.js', 'README.md', '.env.example', '.gitignore', '.railway/README.md',
         'data/labels.json', 'data/playback-hosts.json', 'scripts/setup.js', 'scripts/import_csv.py',
         'scripts/README.txt', 'scripts/package.py']
for directory in ['public', 'lib', 'tests']:
    files.extend(str(p.relative_to(root)) for p in (root / directory).rglob('*') if p.is_file() and p.suffix in ['.js', '.cjs', '.html', '.css'])
rows = json.loads((root / 'data/courses.json').read_text())
for row in rows:
    url = str(row.get('download') or row.get('path') or '').split('?')[0]
    video = bool(row.get('isVideo') or row.get('embedUrl')) or bool(re.search(r'video|youtube|session|lecture|vid', str(row.get('type') or ''), re.I)) or bool(re.search(r'\.(mp4|webm|m3u8|mov|m4v)$', url, re.I)) or bool(re.match(r'https://vz-[a-f0-9]+-[a-f0-9]+\.b-cdn\.net/', url, re.I))
    if video:
        row['isVideo'] = True
        row['hasLink'] = bool(row.get('hasLink') or row.get('download') or row.get('embedUrl'))
        for field in ['download', 'path', 'embedUrl', 'embedManual', 'embedUpdatedAt']:
            row.pop(field, None)
with zipfile.ZipFile(destination, 'x', zipfile.ZIP_DEFLATED) as archive:
    for name in sorted(set(files)):
        archive.write(root / name, 'secure_course_search/' + name)
    archive.writestr('secure_course_search/data/courses.json', json.dumps(rows, ensure_ascii=False, separators=(',', ':')))
    archive.writestr('secure_course_search/data/access-codes.json', '[]\n')
print(destination)
