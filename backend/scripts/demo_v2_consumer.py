"""Explicit dev-only fixture creator. Saves one-time lookup keys to a private file.

Run from backend: python3 scripts/demo_v2_consumer.py --photo ./photo.jpg
This creates two actual cases and never starts diagnosis.
"""
import argparse
import json
import os
from pathlib import Path
from urllib.request import Request, urlopen
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://localhost:8080')
    parser.add_argument('--photo', required=True, type=Path)
    parser.add_argument('--output', type=Path, default=Path('.local/v2-consumer-keys.json'))
    args = parser.parse_args()
    if args.output.exists():
        parser.error('output already exists; choose a fresh private output path')
    photo = args.photo.read_bytes()
    if not photo or len(photo) > 10 * 1024 * 1024:
        parser.error('photo must be 1 byte..10MiB')
    mime = 'image/png' if photo.startswith(b'\x89PNG\r\n\x1a\n') else 'image/jpeg'
    args.output.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    saved = []
    # Open the credential file before creating any reception; each successful key is persisted immediately.
    with os.fdopen(descriptor, 'w') as credentials:
        for kind in ('center', 'field'):
            template = Path(__file__).resolve().parent.parent / 'docs/examples' / f'v2-consumer-{kind}.json'
            data = json.loads(template.read_text())
            boundary = 'repair-fixture-' + uuid.uuid4().hex
            body = (f'--{boundary}\r\nContent-Disposition: form-data; name="data"\r\nContent-Type: application/json\r\n\r\n'.encode()
                    + json.dumps(data).encode() + f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="fixture"\r\nContent-Type: {mime}\r\n\r\n'.encode()
                    + photo + f'\r\n--{boundary}--\r\n'.encode())
            request = Request(args.base_url.rstrip('/') + '/public/cases', data=body,
                              headers={'Content-Type': 'multipart/form-data; boundary=' + boundary})
            with urlopen(request, timeout=40) as response:
                saved.append(json.load(response))
            credentials.seek(0)
            credentials.truncate()
            json.dump(saved, credentials, ensure_ascii=False, indent=2)
            credentials.flush()
            os.fsync(credentials.fileno())
            print('Created', kind, saved[-1]['caseNumber'], '(lookup key saved privately)')
    print('Private credentials file:', args.output)


if __name__ == '__main__':
    main()
