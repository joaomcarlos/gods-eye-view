import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeHlsTailPath,
  resolveHlsRelativePath,
  resolveHlsUpstreamBase,
  rewriteHlsManifest,
  splitHlsPathSegment,
} from '../../vite.config.js';

const CASCAIS_BASE = 'https://video-auth1.iol.pt/beachcam/carcavelos/';
const CASCAIS_PREFIX = '/api/cctv/hls/cascais-carcavelos/';

test('resolveHlsUpstreamBase strips the playlist segment and keeps the directory', () => {
  assert.equal(
    resolveHlsUpstreamBase({ url: 'https://video-auth1.iol.pt/beachcam/carcavelos/playlist.m3u8' }),
    CASCAIS_BASE
  );
  // A query string on the playlist URL must not leak into the base.
  assert.equal(
    resolveHlsUpstreamBase({ url: 'https://video-auth1.iol.pt/beachcam/carcavelos/playlist.m3u8?token=abc' }),
    CASCAIS_BASE
  );
});

test('resolveHlsUpstreamBase returns empty for missing or non-http urls', () => {
  assert.equal(resolveHlsUpstreamBase({}), '');
  assert.equal(resolveHlsUpstreamBase({ url: '' }), '');
  assert.equal(resolveHlsUpstreamBase({ url: 'ftp://x/y/playlist.m3u8' }), '');
  assert.equal(resolveHlsUpstreamBase(null), '');
});

test('resolveHlsRelativePath returns the path+query relative to the base without a leading slash', () => {
  assert.equal(
    resolveHlsRelativePath('chunks.m3u8?nimblesessionid=123', CASCAIS_BASE),
    'chunks.m3u8?nimblesessionid=123'
  );
  assert.equal(
    resolveHlsRelativePath('l_2880337_6241270_618.ts?nimblesessionid=123', CASCAIS_BASE),
    'l_2880337_6241270_618.ts?nimblesessionid=123'
  );
  // Absolute upstream URLs on the same base resolve to the same relative form.
  assert.equal(
    resolveHlsRelativePath(`${CASCAIS_BASE}chunks.m3u8?nimblesessionid=123`, CASCAIS_BASE),
    'chunks.m3u8?nimblesessionid=123'
  );
});

test('rewriteHlsManifest routes segment and sub-playlist URLs through the chunk proxy', () => {
  const top = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-STREAM-INF:BANDWIDTH=1403488,RESOLUTION=1920x1080,CODECS="avc1.4d6033"',
    'chunks.m3u8?nimblesessionid=1500945958',
  ].join('\n');

  const rewritten = rewriteHlsManifest(top, CASCAIS_PREFIX, CASCAIS_BASE);
  const lines = rewritten.split('\n');

  // Tags are preserved verbatim.
  assert.equal(lines[0], '#EXTM3U');
  assert.equal(lines[1], '#EXT-X-VERSION:3');
  assert.equal(lines[2], '#EXT-X-STREAM-INF:BANDWIDTH=1403488,RESOLUTION=1920x1080,CODECS="avc1.4d6033"');
  // The URI line is rewritten to the proxy prefix with no double slash, query preserved.
  assert.equal(lines[3], '/api/cctv/hls/cascais-carcavelos/chunks.m3u8?nimblesessionid=1500945958');
});

test('rewriteHlsManifest rewrites multiple segment lines and preserves EXTINF tags', () => {
  const sub = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:11',
    '#EXT-X-MEDIA-SEQUENCE:618',
    '#EXTINF:9.999,',
    'l_2880337_6241270_618.ts?nimblesessionid=1500945960',
    '#EXTINF:10.01,',
    'l_2880337_6251269_619.ts?nimblesessionid=1500945960',
  ].join('\n');

  const rewritten = rewriteHlsManifest(sub, CASCAIS_PREFIX, CASCAIS_BASE);
  const lines = rewritten.split('\n');

  assert.equal(lines[4], '#EXTINF:9.999,');
  assert.equal(lines[5], '/api/cctv/hls/cascais-carcavelos/l_2880337_6241270_618.ts?nimblesessionid=1500945960');
  assert.equal(lines[6], '#EXTINF:10.01,');
  assert.equal(lines[7], '/api/cctv/hls/cascais-carcavelos/l_2880337_6251269_619.ts?nimblesessionid=1500945960');
});

test('rewriteHlsManifest rewrites URI="..." attributes inside tag lines', () => {
  const line = '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin?nimblesessionid=7",IV=0x1a';
  const rewritten = rewriteHlsManifest(line, CASCAIS_PREFIX, CASCAIS_BASE);
  assert.equal(
    rewritten,
    '#EXT-X-KEY:METHOD=AES-128,URI="/api/cctv/hls/cascais-carcavelos/keys/key.bin?nimblesessionid=7",IV=0x1a'
  );
});

test('rewriteHlsManifest preserves blank lines and handles empty input', () => {
  assert.equal(rewriteHlsManifest('', CASCAIS_PREFIX, CASCAIS_BASE), '');
  const withBlank = '#EXTM3U\n\nchunks.m3u8';
  const rewritten = rewriteHlsManifest(withBlank, CASCAIS_PREFIX, CASCAIS_BASE);
  assert.equal(rewritten.split('\n')[1], '');
});

test('splitHlsPathSegment splits camera id from the remaining tail', () => {
  assert.deepEqual(splitHlsPathSegment('cascais-carcavelos/chunks.m3u8'), {
    id: 'cascais-carcavelos',
    tail: 'chunks.m3u8',
  });
  assert.deepEqual(splitHlsPathSegment('cascais-carcavelos/a/b/c.ts'), {
    id: 'cascais-carcavelos',
    tail: 'a/b/c.ts',
  });
  // No tail (just an id) yields an empty tail.
  assert.deepEqual(splitHlsPathSegment('cascais-carcavelos'), {
    id: 'cascais-carcavelos',
    tail: '',
  });
  // Percent-encoded characters are decoded.
  assert.deepEqual(splitHlsPathSegment('lisbon%20cam/seg.ts'), {
    id: 'lisbon cam',
    tail: 'seg.ts',
  });
});

test('encodeHlsTailPath percent-encodes each segment but preserves slashes', () => {
  assert.equal(encodeHlsTailPath('chunks.m3u8'), 'chunks.m3u8');
  assert.equal(encodeHlsTailPath('a/b.ts'), 'a/b.ts');
  assert.equal(encodeHlsTailPath('a b/c.ts'), 'a%20b/c.ts');
  assert.equal(encodeHlsTailPath(''), '');
});

// Path traversal / SSRF hardening: dot-segments must be stripped so a crafted
// proxy request can't escape the camera's upstream directory after URL
// normalization. These tests guard against regression of CVE-style traversal.
test('encodeHlsTailPath strips ".." segments to prevent path traversal', () => {
  // Leading traversal — would resolve outside the base directory.
  assert.equal(encodeHlsTailPath('../../admin/secret'), 'admin/secret');
  // Trailing traversal.
  assert.equal(encodeHlsTailPath('chunks/..'), 'chunks');
  // Interleaved traversal collapses the preceding segment.
  assert.equal(encodeHlsTailPath('a/../b.ts'), 'a/b.ts');
  // Single-dot segments (current dir) are also dropped.
  assert.equal(encodeHlsTailPath('./chunks.m3u8'), 'chunks.m3u8');
  assert.equal(encodeHlsTailPath('a/./b.ts'), 'a/b.ts');
  // A tail that is ONLY dot-segments collapses to empty (no upstream fetch).
  assert.equal(encodeHlsTailPath('../..'), '');
  assert.equal(encodeHlsTailPath('.'), '');
  // Empty segments (from leading/double slashes) are dropped too.
  assert.equal(encodeHlsTailPath('//admin'), 'admin');
  assert.equal(encodeHlsTailPath('/admin/'), 'admin');
});

test('splitHlsPathSegment + encodeHlsTailPath neutralizes percent-encoded traversal', () => {
  // The full flow: splitHlsPathSegment decodes %2e%2e to "..", then
  // encodeHlsTailPath filters it out. This is the actual attack vector —
  // a crafted URL like /api/cctv/hls/<id>/%2e%2e/admin must not escape.
  const { id, tail } = splitHlsPathSegment('cascais-carcavelos/%2e%2e/%2e%2e/admin');
  assert.equal(id, 'cascais-carcavelos');
  assert.equal(tail, '../../admin');
  assert.equal(encodeHlsTailPath(tail), 'admin');
});

test('encodeHlsTailPath leaves legitimate segment names with dots intact', () => {
  // Filenames like "chunks.m3u8" or "l_2880337_6241270_618.ts" contain dots
  // but are not dot-segments — they must survive the filter.
  assert.equal(encodeHlsTailPath('chunks.m3u8'), 'chunks.m3u8');
  assert.equal(encodeHlsTailPath('l_2880337_6241270_618.ts'), 'l_2880337_6241270_618.ts');
  assert.equal(encodeHlsTailPath('seg.1.2.ts'), 'seg.1.2.ts');
  // A segment literally named "..foo" (not a dot-segment) is preserved.
  assert.equal(encodeHlsTailPath('..foo/bar.ts'), '..foo/bar.ts');
});
