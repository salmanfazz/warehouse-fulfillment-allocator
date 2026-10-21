// One list of orderedAt values, used by both the domain tests and the schema tests, so the
// request schema and the domain can never disagree about what is valid.
export const VALID_ORDERED_AT = [
  '2026-10-19T08:00:00+07:00',
  '2026-10-19T01:00:00Z',
  '2026-10-19T08:00+07:00',
  '2026-10-19T08:00:00.123Z',
  '2026-10-18T20:00:00-05:00',
  '2028-02-29T00:00:00Z',
];

export const INVALID_ORDERED_AT = [
  '2026-10-19T08:00:00', // no offset
  '2026-10-19', // date only
  '2026-02-30T00:00:00Z', // impossible date
  '2027-02-29T00:00:00Z', // not a leap year
  '2026-13-01T00:00:00Z',
  '2026-00-10T00:00:00Z',
  '2026-10-00T00:00:00Z',
  '2026-10-19T24:00:00Z',
  '2026-10-19T12:60:00Z',
  '2026-10-19T12:00:60Z',
  '2026-10-19T08:00:00+0700', // offset without colon
  '2026-10-19T08:00:00+07', // hours only
  '2026-10-19T08:00:00+24:00',
  '2026-10-19T08:00:00+07:60',
  '2026-10-19 08:00:00Z',
  ' 2026-10-19T08:00:00Z',
  '0000-01-01T00:00:00Z', // WIB year would fall outside 0001 to 9999
  '9999-12-31T17:00:00Z',
  'yesterday',
  '',
];
