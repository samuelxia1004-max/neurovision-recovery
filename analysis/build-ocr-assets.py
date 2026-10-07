"""Reproduce offline-assets.js from the four pinned source files in manifest.json.

Usage: python3 analysis/build-ocr-assets.py /path/to/source-download-cache
The script does not access the network. Download the public manifest URLs into
that directory before running; no medical data is needed or accepted.
"""
import base64
import hashlib
import json
from pathlib import Path
import sys
import tarfile

vendor = Path(__file__).resolve().parents[1] / 'app/vendor/ocr'
manifest = json.loads((vendor / 'manifest.json').read_text())
source = Path(sys.argv[1])
for entry in manifest['source_downloads']:
    data = (source / entry['name']).read_bytes()
    if len(data) != entry['bytes'] or hashlib.sha256(data).hexdigest() != entry['sha256']:
        raise SystemExit('Source hash mismatch: ' + entry['name'])

def member(archive, name):
    with tarfile.open(source / archive) as package:
        return package.extractfile('package/' + name).read()

worker = member('tesseract.js-6.0.1.tgz', 'dist/worker.min.js').decode().split('//# sourceMappingURL=')[0]
core = member('tesseract.js-core-6.0.0.tgz', 'tesseract-core-lstm.js').decode()
wasm = member('tesseract.js-core-6.0.0.tgz', 'tesseract-core-lstm.wasm')
assets = {'version': 'tesseract.js 6.0.1 / core 6.0.0', 'core': core,
          'wasm': base64.b64encode(wasm).decode(), 'worker': worker,
          'languages': {lang: base64.b64encode((source / (lang + '.traineddata.gz')).read_bytes()).decode()
                        for lang in ['eng', 'chi_sim']}}
result = ('/* Offline OCR assets. See manifest.json and LICENSE files. */\n(function(r){r.NVOCRAssets='
          + json.dumps(assets, separators=(',', ':'))
          + ';})(typeof window==="undefined"?globalThis:window);\n').encode()
expected = next(item for item in manifest['files'] if item['file'] == 'offline-assets.js')
if hashlib.sha256(result).hexdigest() != expected['sha256']:
    raise SystemExit('Rebuilt bundle hash mismatch; existing file was not changed.')
(vendor / 'offline-assets.js').write_bytes(result)
print('Rebuilt and verified offline-assets.js:', len(result), 'bytes')
