import { describe, expect, it } from 'vitest';
import { isAuthorizedCron, safeEqual } from '@/http/auth';

const SECRET = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

describe('isAuthorizedCron', () => {
  it('right_token_is_accepted', () => {
    expect(isAuthorizedCron(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it('scheme_is_case_insensitive', () => {
    expect(isAuthorizedCron(`bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isAuthorizedCron(`BEARER ${SECRET}`, SECRET)).toBe(true);
  });

  it('the_token_itself_is_case_sensitive', () => {
    expect(isAuthorizedCron(`Bearer ${SECRET.toUpperCase()}`, SECRET)).toBe(false);
  });

  it('wrong_token', () => {
    expect(isAuthorizedCron('Bearer nope', SECRET)).toBe(false);
    expect(isAuthorizedCron(`Bearer ${SECRET.slice(0, -1)}0`, SECRET)).toBe(false);
  });

  it('a_token_that_is_a_prefix_or_extension_of_the_secret', () => {
    expect(isAuthorizedCron(`Bearer ${SECRET.slice(0, 10)}`, SECRET)).toBe(false);
    expect(isAuthorizedCron(`Bearer ${SECRET}x`, SECRET)).toBe(false);
  });

  it('missing_header', () => {
    expect(isAuthorizedCron(null, SECRET)).toBe(false);
    expect(isAuthorizedCron('', SECRET)).toBe(false);
  });

  it('other_schemes_and_the_bare_secret', () => {
    expect(isAuthorizedCron(`Basic ${SECRET}`, SECRET)).toBe(false);
    expect(isAuthorizedCron(SECRET, SECRET)).toBe(false);
    expect(isAuthorizedCron(`Token ${SECRET}`, SECRET)).toBe(false);
  });

  it('empty_token', () => {
    expect(isAuthorizedCron('Bearer ', SECRET)).toBe(false);
    expect(isAuthorizedCron('Bearer', SECRET)).toBe(false);
  });

  it('extra_spaces_or_extra_words', () => {
    expect(isAuthorizedCron(`Bearer  ${SECRET}`, SECRET)).toBe(false);
    expect(isAuthorizedCron(` Bearer ${SECRET}`, SECRET)).toBe(false);
    expect(isAuthorizedCron(`Bearer ${SECRET} `, SECRET)).toBe(false);
    expect(isAuthorizedCron(`Bearer ${SECRET} extra`, SECRET)).toBe(false);
  });

  it('an_unset_or_empty_secret_never_authorises_anyone', () => {
    for (const header of ['Bearer ', 'Bearer undefined', 'Bearer null', 'Bearer ', null, '']) {
      expect(isAuthorizedCron(header, undefined), String(header)).toBe(false);
      expect(isAuthorizedCron(header, ''), String(header)).toBe(false);
    }
  });

  it('a_secret_with_special_characters', () => {
    const odd = 'p@ss/w0rd+=%~._-ü';
    expect(isAuthorizedCron(`Bearer ${odd}`, odd)).toBe(true);
    expect(isAuthorizedCron('Bearer p@ss/w0rd+=%~._-u', odd)).toBe(false);
  });
});

describe('safeEqual', () => {
  it('is_true_only_for_equal_strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });

  it('handles_different_lengths_without_throwing', () => {
    expect(() => safeEqual('short', 'a much longer string than the other one')).not.toThrow();
    expect(safeEqual('short', 'a much longer string than the other one')).toBe(false);
    expect(safeEqual('', 'x')).toBe(false);
  });

  it('unicode_strings', () => {
    expect(safeEqual('日本語', '日本語')).toBe(true);
    expect(safeEqual('日本語', '日本誤')).toBe(false);
  });
});
