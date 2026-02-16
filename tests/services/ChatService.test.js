// ChatService unit tests — focus on pure/testable methods
// ChatService exports a singleton instance, so we test its methods directly

// Mock electron dependencies
jest.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/mock/app' },
  BrowserWindow: { getAllWindows: () => [] },
}));

// Mock child_process (used by resolveRuntime/shellLookup)
jest.mock('child_process', () => ({
  exec: jest.fn(),
  execSync: jest.fn(),
  execFileSync: jest.fn(() => ''),
}));

// Mock the SDK loader (virtual because it may not be resolvable in test env)
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({}), { virtual: true });

const chatService = require('../../src/main/services/ChatService');

// ── _buildContent ──

describe('ChatService._buildContent', () => {
  test('returns plain text when no images or mentions', () => {
    const result = chatService._buildContent('Hello world', []);
    expect(result).toBe('Hello world');
  });

  test('returns plain text for empty arrays', () => {
    const result = chatService._buildContent('Hello', [], []);
    expect(result).toBe('Hello');
  });

  test('returns content blocks array with images', () => {
    const result = chatService._buildContent('Look at this', [
      { base64: 'abc123', mediaType: 'image/png' }
    ]);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: 'text', text: 'Look at this' });
    expect(result[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'abc123' }
    });
  });

  test('returns content blocks array with mentions', () => {
    const result = chatService._buildContent('Check this file', [], [
      { label: 'src/index.js', content: 'const x = 1;' }
    ]);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0].text).toContain('[Context: src/index.js]');
    expect(result[0].text).toContain('const x = 1;');
    expect(result[1]).toEqual({ type: 'text', text: 'Check this file' });
  });

  test('mentions come before text, images after', () => {
    const result = chatService._buildContent('Question', [
      { base64: 'img', mediaType: 'image/jpeg' }
    ], [
      { label: 'file.js', content: 'code' }
    ]);
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].type).toBe('text');
    expect(result[0].text).toContain('[Context:');
    expect(result[1]).toEqual({ type: 'text', text: 'Question' });
    expect(result[2].type).toBe('image');
  });

  test('handles empty text with images', () => {
    const result = chatService._buildContent('', [
      { base64: 'img', mediaType: 'image/png' }
    ]);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('image');
  });

  test('handles multiple images', () => {
    const result = chatService._buildContent('Text', [
      { base64: 'a', mediaType: 'image/png' },
      { base64: 'b', mediaType: 'image/jpeg' },
    ]);
    expect(result).toHaveLength(3);
  });

  test('handles multiple mentions', () => {
    const result = chatService._buildContent('Question', [], [
      { label: 'a.js', content: 'aaa' },
      { label: 'b.js', content: 'bbb' },
    ]);
    expect(result).toHaveLength(3);
    expect(result[0].text).toContain('a.js');
    expect(result[1].text).toContain('b.js');
  });
});

// ── _safeSerialize ──

describe('ChatService._safeSerialize', () => {
  test('serializes plain object', () => {
    const result = chatService._safeSerialize({ foo: 'bar', count: 42 });
    expect(result).toEqual({ foo: 'bar', count: 42 });
  });

  test('strips undefined values', () => {
    const result = chatService._safeSerialize({ a: 1, b: undefined });
    expect(result).toEqual({ a: 1 });
  });

  test('handles nested objects', () => {
    const result = chatService._safeSerialize({ outer: { inner: [1, 2, 3] } });
    expect(result).toEqual({ outer: { inner: [1, 2, 3] } });
  });

  test('handles circular reference gracefully', () => {
    const obj = { a: 1 };
    obj.self = obj;
    const result = chatService._safeSerialize(obj);
    expect(result).toEqual({ _raw: expect.any(String) });
  });

  test('handles null', () => {
    const result = chatService._safeSerialize(null);
    expect(result).toBeNull();
  });

  test('handles arrays', () => {
    const result = chatService._safeSerialize([1, 'two', { three: 3 }]);
    expect(result).toEqual([1, 'two', { three: 3 }]);
  });
});
