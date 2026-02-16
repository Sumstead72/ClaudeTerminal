const { parseGitStatus, parseDiffNumstat } = require('../../src/main/utils/git');

// ── parseGitStatus ──

describe('parseGitStatus', () => {
  test('returns empty categories for null input', () => {
    const result = parseGitStatus(null);
    expect(result).toEqual({ staged: [], unstaged: [], untracked: [], all: [] });
  });

  test('returns empty categories for empty string', () => {
    const result = parseGitStatus('');
    expect(result).toEqual({ staged: [], unstaged: [], untracked: [], all: [] });
  });

  test('parses staged additions', () => {
    const result = parseGitStatus('A  src/new-file.js');
    expect(result.staged).toEqual([{ type: 'added', file: 'src/new-file.js' }]);
    expect(result.unstaged).toEqual([]);
    expect(result.untracked).toEqual([]);
  });

  test('parses staged modifications', () => {
    const result = parseGitStatus('M  src/index.js');
    expect(result.staged).toEqual([{ type: 'modified', file: 'src/index.js' }]);
  });

  test('parses staged deletions', () => {
    const result = parseGitStatus('D  old-file.js');
    expect(result.staged).toEqual([{ type: 'deleted', file: 'old-file.js' }]);
  });

  test('parses staged renames', () => {
    const result = parseGitStatus('R  old.js -> new.js');
    expect(result.staged).toEqual([{ type: 'renamed', file: 'old.js -> new.js' }]);
  });

  test('parses unstaged modifications', () => {
    const result = parseGitStatus(' M src/index.js');
    expect(result.unstaged).toEqual([{ type: 'modified', file: 'src/index.js' }]);
    expect(result.staged).toEqual([]);
  });

  test('parses unstaged deletions', () => {
    const result = parseGitStatus(' D deleted-file.js');
    expect(result.unstaged).toEqual([{ type: 'deleted', file: 'deleted-file.js' }]);
  });

  test('parses untracked files', () => {
    const result = parseGitStatus('?? new-file.txt');
    expect(result.untracked).toEqual([{ type: 'untracked', file: 'new-file.txt' }]);
    expect(result.staged).toEqual([]);
    expect(result.unstaged).toEqual([]);
  });

  test('parses mixed status', () => {
    const input = [
      'A  src/new.js',
      ' M src/modified.js',
      'D  src/deleted.js',
      '?? .env',
    ].join('\n');
    const result = parseGitStatus(input);
    expect(result.staged).toHaveLength(2); // A + D
    expect(result.unstaged).toHaveLength(1); // M
    expect(result.untracked).toHaveLength(1); // ??
    expect(result.all).toHaveLength(4);
  });

  test('handles both staged and unstaged for same file', () => {
    // MM means both staged and unstaged modification
    const result = parseGitStatus('MM src/file.js');
    expect(result.staged).toHaveLength(1);
    expect(result.unstaged).toHaveLength(1);
  });

  test('skips blank lines', () => {
    const result = parseGitStatus('A  file.js\n\n?? other.js\n');
    expect(result.staged).toHaveLength(1);
    expect(result.untracked).toHaveLength(1);
  });
});

// ── parseDiffNumstat ──

describe('parseDiffNumstat', () => {
  test('returns empty map for null', () => {
    const result = parseDiffNumstat(null);
    expect(result.size).toBe(0);
  });

  test('returns empty map for empty string', () => {
    const result = parseDiffNumstat('');
    expect(result.size).toBe(0);
  });

  test('parses single file diff', () => {
    const result = parseDiffNumstat('10\t5\tsrc/index.js');
    expect(result.get('src/index.js')).toEqual({ additions: 10, deletions: 5 });
  });

  test('parses multiple files', () => {
    const input = '10\t5\tsrc/a.js\n3\t0\tsrc/b.js\n0\t20\tsrc/c.js';
    const result = parseDiffNumstat(input);
    expect(result.size).toBe(3);
    expect(result.get('src/a.js')).toEqual({ additions: 10, deletions: 5 });
    expect(result.get('src/b.js')).toEqual({ additions: 3, deletions: 0 });
    expect(result.get('src/c.js')).toEqual({ additions: 0, deletions: 20 });
  });

  test('handles binary files (- markers)', () => {
    const result = parseDiffNumstat('-\t-\timage.png');
    expect(result.get('image.png')).toEqual({ additions: 0, deletions: 0 });
  });

  test('skips blank lines', () => {
    const result = parseDiffNumstat('5\t3\tfile.js\n\n');
    expect(result.size).toBe(1);
  });
});
