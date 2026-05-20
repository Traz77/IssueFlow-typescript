import { extractMentionedUsernames } from './mention-parser';

describe('extractMentionedUsernames()', () => {
  it('extracts and lowercases multiple mentions', () => {
    expect(extractMentionedUsernames('Hey @alice and @BOB')).toEqual(['alice', 'bob']);
  });

  it('deduplicates after case folding', () => {
    expect(extractMentionedUsernames('@alice @ALICE @Alice')).toEqual(['alice']);
  });

  it('returns empty array when no mentions', () => {
    expect(extractMentionedUsernames('no mentions here')).toEqual([]);
  });

  it('standalone @ does not match', () => {
    expect(extractMentionedUsernames('@')).toEqual([]);
  });

  it('@@alice matches alice (the second @ captures the word)', () => {
    expect(extractMentionedUsernames('@@alice')).toEqual(['alice']);
  });

  it('@!invalid does not match', () => {
    expect(extractMentionedUsernames('@!invalid')).toEqual([]);
  });

  it('email-like pattern matches the post-@ token (naive regex behavior per spec)', () => {
    const result = extractMentionedUsernames('Email me at jdoe@example.com');
    expect(result).toContain('example');
  });

  it('preserves insertion order (Set insertion order in JS)', () => {
    expect(extractMentionedUsernames('@bob @alice')).toEqual(['bob', 'alice']);
  });
});
