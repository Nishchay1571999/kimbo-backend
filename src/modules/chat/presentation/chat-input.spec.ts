import {
  sendMessageInput,
  createThreadInput,
  pageLimit,
  beforeSequence,
} from './chat-input.js';
const requestId = 'be68e61d-290c-4074-9f5d-c311d2f706da';
it('accepts text blocks with a client request ID', () => {
  expect(
    sendMessageInput({
      requestId,
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: 'Kimbo' },
      ],
    }),
  ).toEqual({ requestId, message: 'Hello\nKimbo' });
});
it.each([
  {
    requestId,
    userId: 'somebody-else',
    content: [{ type: 'text', text: 'Hello' }],
  },
  { requestId: 'not-a-uuid', content: [{ type: 'text', text: 'Hello' }] },
  { requestId, content: [{ type: 'text', text: ' ' }] },
  { requestId, content: [{ type: 'image', attachmentId: 'unknown' }] },
  {
    requestId,
    content: [
      { type: 'text', text: 'a'.repeat(8000) },
      { type: 'text', text: 'b' },
    ],
  },
])('rejects spoofed identity or invalid/oversized content %#', (body) => {
  expect(() => sendMessageInput(body)).toThrow();
});
it('rejects unknown fields and invalid pagination', () => {
  expect(() => createThreadInput({ userId: 'someone' })).toThrow();
  expect(() => pageLimit('101')).toThrow();
  expect(() => beforeSequence('1.5')).toThrow();
});
