#!/usr/bin/env python3
"""Shrink generated GLB models (textures resized and re-encoded) and write them
to public/models/<name>.glb, which the 3D view loads next to the page.
Raw GLBs live in art/raw/ (git-ignored). Usage: python3 tools/pack_models.py
"""
import io, json, os, struct
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..')
# name -> (raw file, max texture size). Facing and scale are set in render3d.js.
MODELS = {
    'tank': ('art/raw/tank.glb', 2048), 'hq': ('art/raw/hq.glb', 2048),
    'rifle': ('art/raw/rifle.glb', 1024), 'heavy': ('art/raw/heavy.glb', 1024),
    'lance': ('art/raw/lance.glb', 1024), 'hammer': ('art/raw/hammer.glb', 1024),
}


def shrink(path, tex):
    d = open(path, 'rb').read()
    jlen = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20 + jlen])
    boff = 20 + jlen + 8
    blen = struct.unpack('<I', d[20 + jlen:24 + jlen])[0]
    bin_ = d[boff:boff + blen]
    views = j['bufferViews']
    images = {im['bufferView']: im for im in j.get('images', [])}
    out, new_views = bytearray(), []
    for i, v in enumerate(views):
        chunk = bin_[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
        if i in images:
            im = Image.open(io.BytesIO(chunk)).convert('RGB')
            im.thumbnail((tex, tex), Image.LANCZOS)
            buf = io.BytesIO(); im.save(buf, 'JPEG', quality=88); chunk = buf.getvalue()
            images[i]['mimeType'] = 'image/jpeg'
        while len(out) % 4: out.append(0)
        nv = dict(v); nv['byteOffset'] = len(out); nv['byteLength'] = len(chunk)
        out += chunk; new_views.append(nv)
    while len(out) % 4: out.append(0)
    j['bufferViews'] = new_views; j['buffers'] = [{'byteLength': len(out)}]
    js = json.dumps(j, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out))
    glb += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(out), 0x004E4942) + bytes(out)
    return glb


def main():
    out_dir = os.path.join(ROOT, 'public', 'models')
    os.makedirs(out_dir, exist_ok=True)
    for name, (file, tex) in MODELS.items():
        p = os.path.join(ROOT, file)
        if not os.path.exists(p):
            print('missing', p); continue
        glb = shrink(p, tex)
        open(os.path.join(out_dir, name + '.glb'), 'wb').write(glb)
        print(f'{name}: {os.path.getsize(p) / 1e6:.1f} MB -> {len(glb) / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
