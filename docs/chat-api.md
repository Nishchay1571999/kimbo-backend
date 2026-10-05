# Chat, threads and health retrieval

Chat uses the same bearer identity, PostgreSQL client, model registry, entry
validation/repository and Home calculations as the rest of Kimbo. No new tables
or memory database are used. Interactive generation runs within the HTTP request;
the entry-analysis worker remains separate.

All product endpoints require `Authorization: Bearer <token>` and completed
onboarding. The existing development identity option is unchanged. Thread reads
and writes are scoped to the authenticated account; other users' IDs return 404.

## Threads

| Method | Path                            | Behavior                                    |
| ------ | ------------------------------- | ------------------------------------------- |
| POST   | `/v1/chat/threads`              | Create without an AI call; returns 201      |
| GET    | `/v1/chat/threads`              | List active/archived, nondeleted threads    |
| GET    | `/v1/chat/threads/:id`          | Get owned, nondeleted thread                |
| PATCH  | `/v1/chat/threads/:id`          | Edit title, model or active/archived status |
| DELETE | `/v1/chat/threads/:id`          | Soft-delete; returns 204                    |
| GET    | `/v1/chat/threads/:id/messages` | Ordered persisted messages                  |
| POST   | `/v1/chat/threads/:id/messages` | Persist a pair, then stream the agent       |

Create accepts `{ "title": "Weekly check-in", "aiModelId": "uuid" }`, with both
fields optional. Default model comes from current `user_preferences`, then
`CHAT_DEFAULT_MODEL` (Gemini 3.8 Flash by default) when registered, then the first
available text model in `ai_models`. Model IDs are validated against
enabled OpenRouter text models. The title defaults to the first message's text
when omitted. PATCH accepts `title`, `aiModelId`, and/or `threadStatus`
(`active` or `archived`). Changing an active generation's thread returns 409.

Thread lists return arrays ordered by updated time and ID, with `limit` (1–100,
default 50) and optional `cursor=<last-thread-id>` for the next page. The cursor
is validated against the authenticated account. Message lists return the latest
50 messages in ascending sequence order. Use `limit` and `before=<sequence>` to
fetch older messages; source snapshots are included in message metadata.

## Send and stream

```json
{
  "requestId": "a527f017-4fda-4754-8c36-a8e78f588e45",
  "content": [{ "type": "text", "text": "Why was Saturday higher?" }]
}
```

Text input supports up to eight blocks and 8,000 characters total. Images/audio
are rejected until attachment handling is implemented for chat. Unknown fields,
including client-supplied user IDs, are rejected. Generate a fresh UUID for each
new turn and keep it for retries.

Successful allocation returns HTTP 200 with
`Content-Type: application/x-ndjson; charset=utf-8`. Parse complete newline-delimited
JSON records, retaining incomplete lines between network chunks.

```jsonl
{"type":"message.started","messageId":"assistant-uuid","userMessageId":"user-uuid","requestId":"request-uuid","replayed":false}
{"type":"agent.status","status":"thinking"}
{"type":"source.added","source":{"id":"source-uuid","type":"daily_health","title":"Today","origin":"context","query":{},"snapshot":{},"provenance":{"entities":[],"healthRecordIds":[]}}}
{"type":"tool.started","toolCallId":"provider-call-id","tool":"get_entries","label":"Checking saved entries"}
{"type":"source.added","source":{"id":"source-uuid","type":"entries","title":"saved entries","origin":"tool","toolCallId":"provider-call-id","query":{},"snapshot":{},"provenance":{"entities":[],"healthRecordIds":[]}}}
{"type":"tool.completed","toolCallId":"provider-call-id","tool":"get_entries"}
{"type":"agent.status","status":"generating"}
{"type":"text.delta","delta":"Saturday included..."}
{"type":"message.completed","messageId":"assistant-uuid","actualModelId":"model-uuid"}
```

Other events: `tool.failed` includes a safe `errorCode`; `message.failed` and
`message.cancelled` terminate unsuccessful runs. Transient states are stream
events; durable statuses use the existing message enum. A completion event is
emitted after saving text, actual model, sources, tool statuses and usage.

Ownership, validation and conflicts return ordinary HTTP errors before streaming.
Provider errors after allocation are NDJSON events, not a second HTTP status.
Provider credentials and raw provider errors are excluded from responses.

## Retries and concurrency

The thread is locked while allocating the completed user row and processing
assistant row in one transaction. Sequence numbers and the shared request UUID
use existing database constraints. At most one generation runs per thread.

A completed/failed/cancelled request replays its saved text and sources without
another AI call. Reusing its UUID with different text returns 409
`REQUEST_ID_REUSED`. Repeating an in-flight request returns 409
`MESSAGE_IN_PROGRESS`; another request in the same thread returns 409
`THREAD_BUSY`. Poll the message list or retry after completion. Archived threads
reject new turns with `THREAD_ARCHIVED`, while existing results remain readable.

Disconnect propagates cancellation to the agent. Generation has a three-minute
deadline. Abandoned processing rows older than five minutes are marked failed
under the thread lock when a subsequent send/retry arrives. Generation does not
hold a transaction or database connection open for its entire duration.

## Context, tools and sources

Each turn receives current profile/schedule, latest applicable active weight,
today's confirmed Home totals/recent entries, and at most 20 recent completed
messages (24,000 characters total). Onboarding's original weight is not treated as current weight.
Attachments and unconfirmed entry AI proposals are excluded from health context.

The model chooses from six request-bound read-only tools. No tool exposes userId.

| Tool                        | Arguments                                          |
| --------------------------- | -------------------------------------------------- |
| `get_day_health`            | `date`                                             |
| `get_week_health`           | Optional `anchorDate`; Monday–Sunday calendar week |
| `get_month_health`          | Optional `anchorDate`; calendar month              |
| `get_health_range`          | Inclusive `from`, `to`                             |
| `get_entries`               | `from`, `to`, optional category and limit (max 50) |
| `get_health_metric_history` | `metric: "weight"`, `from`, `to`                   |

Dates are local reporting dates in YYYY-MM-DD. Ranges contain at most 93 days and
1,000 entries, fetched in one entry query rather than one query per day. Oversized
retrieval fails explicitly. Entry drill-down flags truncation. Weight retrieval
is capped at 500 observations. Tool outputs are capped at 64 KB; collected
sources at 12 snapshots and 256 KB total. The SDK stops after five steps or
$0.10 accumulated cost, with one final text-only turn if necessary. Output is
also capped and the request has a deadline.

Nutrition averages divide by days with nutrition logs. Days without logs remain
unknown; exercise-only days do not dilute nutrition averages. Exercise expenditure
is separate and remains null when estimates are unavailable. Today/future dates
may be partial. No calorie allowance is invented.

Sources are generated by the server from actual supplied context/retrieval,
never model-authored citations. `origin` distinguishes automatic context from
executed tools. Snapshots persist in assistant metadata with exact entity IDs and
revisions and health-record IDs. Later edits/deletions do not rewrite old answers.

## OpenRouter configuration and checks

`OPENROUTER_API_KEY` stays in server configuration. Model selection comes from
`ai_models`; `CHAT_FALLBACK_MODEL` names an enabled provider model ID (GPT-5.4 Mini
by default when registered; set an empty value to disable fallback).
Fallback retries once for routing, rate-limit, or transient server failures before any text or tool execution. Each SDK run uses one explicit model so a provider switch cannot duplicate retrieval or partially streamed answers.
The thread keeps its selected model, while each assistant row records the actual
registered model returned by OpenRouter. Unregistered routing results fail with
`AI_UNREGISTERED_MODEL`.

Run `pnpm run ai:configure --test-chat-primary=google/gemini-3.8-flash` to register
current models and select the test account's primary. This does not invoke a
model or change other accounts. Provider availability and account routing/privacy
settings also determine which tool-enabled endpoints can be used.

Run `pnpm run chat:check` for real test-account retrieval, NDJSON, persistence,
idempotency, thread CRUD and controlled fault/cancellation checks. It saves
`docs/chat-flow-verification.json`. Unit/HTTP tests use isolated fixtures for
ownership, fallback attribution and tool failure. Live checks always use
`test@email.com`; they do not create secondary accounts.
