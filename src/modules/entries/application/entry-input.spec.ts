import { entryInput } from './entry-input.js';
const user = { userId: 'user-a', timezone: 'Asia/Kolkata', development: true };
const meal = {
  category: 'nutrition',
  entryDate: '2026-10-05',
  occurredAt: '2026-10-05T08:15:00+05:30',
  data: {
    mealCategory: 'breakfast',
    items: [{ name: 'Rice', quantity: 150, unit: 'g', caloriesKcal: 195 }],
  },
};
describe('entry input boundary', () => {
  it('generates IDs, keeps reporting date independent, preserves unknown macros', () => {
    const result = entryInput({ ...meal, entryDate: '2026-10-04' }, user);
    expect(result.entryDate).toBe('2026-10-04');
    expect(result.occurredAt).toBe('2026-10-05T02:45:00.000Z');
    expect(result.data).toMatchObject({
      items: [{ id: expect.any(String), proteinG: null, caloriesKcal: 195 }],
    });
  });
  it.each([
    { ...meal, entryDate: '2026-02-30' },
    { ...meal, occurredAt: '2026-10-05T08:15:00' },
    { ...meal, userId: 'other' },
    { ...meal, data: { mealCategory: 'lunch', items: [] } },
    {
      ...meal,
      data: {
        mealCategory: 'lunch',
        items: [{ name: 'Rice', quantity: -1, unit: 'g', caloriesKcal: 195 }],
      },
    },
    {
      ...meal,
      data: {
        mealCategory: 'lunch',
        items: [{ name: 'Rice', quantity: 1, unit: 'g', caloriesKcal: -1 }],
      },
    },
    {
      ...meal,
      data: {
        mealCategory: 'lunch',
        items: [
          {
            name: 'Rice',
            quantity: 1,
            unit: 'g',
            caloriesKcal: 195,
            nutritionSource: 'reference',
          },
        ],
      },
    },
    {
      ...meal,
      attachments: [
        {
          id: 'a',
          type: 'image',
          storageKey: 'entries/other/photo.jpg',
          mimeType: 'image/jpeg',
          fileSizeBytes: 100,
        },
      ],
    },
    {
      ...meal,
      attachments: [
        {
          id: 'a',
          type: 'image',
          storageKey: 'entries/user-a/../other/photo.jpg',
          mimeType: 'image/jpeg',
          fileSizeBytes: 100,
        },
      ],
    },
  ])('rejects invalid or unowned content %j', (input) => {
    expect(() => entryInput(input, user)).toThrow();
  });
  it('retains recorded timezone on edits and requires data when category changes', () => {
    const current = entryInput(meal, user);
    expect(
      entryInput({ note: 'Edited' }, { ...user, timezone: 'UTC' }, current)
        .recordedTimezone,
    ).toBe('Asia/Kolkata');
    expect(() => entryInput({ category: 'exercise' }, user, current)).toThrow();
  });
});

describe('Base64 attachments', () => {
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  const note = {
    category: 'note',
    entryDate: '2026-10-05',
    occurredAt: '2026-10-05T08:15:00Z',
    data: {},
  };
  it('accepts and returns canonical Base64, derives size and generates attachment ID', () => {
    const result = entryInput(
      {
        ...note,
        attachments: [
          {
            type: 'image',
            mimeType: 'image/png',
            base64: `data:image/png;base64,${png}`,
          },
        ],
      },
      user,
    );
    expect(result.attachments[0]).toMatchObject({
      id: expect.any(String),
      type: 'image',
      base64: png,
      fileSizeBytes: Buffer.from(png, 'base64').length,
    });
  });
  it.each(['not base64', '!!!!', 'aGVsbG8=', 'https://example.com/photo.png'])(
    'rejects malformed or nonimage content %s',
    (base64) => {
      expect(() =>
        entryInput(
          {
            ...note,
            attachments: [{ type: 'image', mimeType: 'image/png', base64 }],
          },
          user,
        ),
      ).toThrow();
    },
  );
  it('rejects size metadata that disagrees with the bytes', () => {
    expect(() =>
      entryInput(
        {
          ...note,
          attachments: [
            {
              type: 'image',
              mimeType: 'image/png',
              base64: png,
              fileSizeBytes: 1,
            },
          ],
        },
        user,
      ),
    ).toThrow();
  });
});
