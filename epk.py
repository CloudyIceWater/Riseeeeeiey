"""Eaglercraft EPK v2 reader/writer."""
import struct, gzip, zlib, io

def read_epk(b):
    assert b[:8] == b'EAGPKG$$'
    p = 8
    n = b[p]; ver = b[p+1:p+1+n]; p += 1+n
    n = b[p]; name = b[p+1:p+1+n]; p += 1+n
    n = struct.unpack('>H', b[p:p+2])[0]; comment = b[p+2:p+2+n]; p += 2+n
    ts = b[p:p+8]; p += 8
    count = struct.unpack('>I', b[p:p+4])[0]; p += 4
    comp = b[p:p+1]; p += 1
    body = b[p:]
    tail = b''
    if comp == b'G':
        d = zlib.decompressobj(31); raw = d.decompress(body); tail = d.unused_data
    elif comp == b'Z':
        d = zlib.decompressobj(); raw = d.decompress(body); tail = d.unused_data
    else:
        raw = body
    meta = dict(ver=ver, name=name, comment=comment, ts=ts, comp=comp, tail=tail)
    files = []  # list of (type, name, data)
    q = 0
    while q < len(raw):
        t = raw[q:q+4]; q += 4
        if t == b'END$':
            break
        n = raw[q]; nm = raw[q+1:q+1+n].decode('utf-8'); q += 1+n
        if t == b'HEAD':
            # head entries: typed value
            vt = raw[q:q+1]  # observed format: len-prefixed string
            ln = struct.unpack('>I', raw[q:q+4])[0]; data = raw[q+4:q+4+ln]; q += 4+ln
            assert raw[q:q+1] == b'>'; q += 1
            files.append(('HEAD', nm, data))
            continue
        ln = struct.unpack('>I', raw[q:q+4])[0]; q += 4
        crc = struct.unpack('>I', raw[q:q+4])[0]; q += 4
        data = raw[q:q+ln-5]; q += ln-5  # len counts crc + data + ':'
        assert raw[q:q+2] == b':>', (nm, raw[q:q+10]); q += 2
        files.append((t.decode(), nm, data))
    return meta, files, raw

def write_epk(meta, files):
    out = io.BytesIO()
    body = io.BytesIO()
    nfiles = 0
    for t, nm, data in files:
        nb = nm.encode('utf-8')
        body.write(t.encode() if isinstance(t, str) else t)
        body.write(bytes([len(nb)])); body.write(nb)
        if t == 'HEAD':
            body.write(struct.pack('>I', len(data))); body.write(data); body.write(b'>')
            continue
        body.write(struct.pack('>I', len(data) + 5))
        body.write(struct.pack('>I', zlib.crc32(data) & 0xffffffff))
        body.write(data); body.write(b':>')
        nfiles += 1
    body.write(b'END$')
    raw = body.getvalue()
    out.write(b'EAGPKG$$')
    for f in (meta['ver'], meta['name']):
        out.write(bytes([len(f)])); out.write(f)
    out.write(struct.pack('>H', len(meta['comment']))); out.write(meta['comment'])
    out.write(meta['ts'])
    out.write(struct.pack('>I', meta.get('count', nfiles)))
    out.write(b'G')
    co = zlib.compressobj(9, zlib.DEFLATED, 31)
    out.write(co.compress(raw) + co.flush())
    out.write(meta['tail'])
    return out.getvalue()
