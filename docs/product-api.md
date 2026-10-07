# Entries, Nutrition, Home and AI

## Identity and local development

All product routes use `CurrentUserGuard`. Bearer values are looked up using the
existing identity token in `users.auth_provider_id`; unknown tokens return 401.
Bearer requests require completed onboarding (403 otherwise).

For local work, set `DEV_AUTH_ENABLED=true` and
`DEV_USER_EMAIL=test@email.com` in `.env`. An optional `DEV_USER_ID` overrides
email resolution. This only applies when no Authorization header is sent and
`NODE_ENV` is not `production`. An invalid supplied token never falls back to the
stub. Every entry operation still receives the resolved user ID. The local
account currently has no health profile: Home returns null schedule boundaries,
without creating onboarding facts or changing the account.

## Routes

| Method | Route | Result |
| --- | --- | --- |
| POST | `/v1/entries` | Create a confirmed event (201) |
| GET | `/v1/entries/:id` | Owned, nondeleted Entry |
| GET | `/v1/entries?date=2026-10-05` | Entries ordered by actual event time |
| PATCH | `/v1/entries/:id` | Edit content; optional expected `revision` |
| DELETE | `/v1/entries/:id` | Soft-delete (204); subsequent reads return 404 |
| GET | `/v1/nutrition/search?q=rice&page=1` | Normalized food search, 20 results per page; optional provider |
| GET | `/v1/nutrition/foods/171077` | Normalized food reference; optional provider |
| POST | `/v1/nutrition/calculate` | Portion nutrition with reference provenance |
| POST | `/v1/estimates` | Preview calories from `{category, title, note, image}`; nothing is saved |
| GET | `/v1/ai/models` | Enabled image-capable models from ai_models |
| GET | `/v1/home?date=2026-10-05` | Day, schedule, summaries, goal comparison, timeline and sections |
| GET | `/v1/home/week?date=2026-10-05` | Day statuses for the 7 days ending on the date (capped at today) |
| GET | `/v1/goals/target` | `{ target \| null, suggestion \| null }` |
| PUT | `/v1/goals/target` | Confirm `{ caloriesKcal, proteinG, method }` |

All these routes require a bearer identity or explicitly enabled local stub.
Entry IDs must be UUIDs. Requests reject unknown fields and invalid category
facts. Owner mismatches return 404. `GET /v1/home` defaults to today in the user's
current timezone; entry listing requires an explicit reporting date.

## Log a USDA portion

`USDA_FDC_API_KEY` is used only by the server. The adapter uses the official
[FoodData Central search and detail endpoints](https://fdc.nal.usda.gov/api-guide/)
and converts both response nutrient formats into a common reference. Missing
macros remain null. Calories prefer kcal energy and use kJ conversion only when
necessary. Provider failures return sanitized 502/503 responses; unknown foods
return 404. Provider requests time out after ten seconds.

First calculate the portion:

```http
POST /v1/nutrition/calculate
Content-Type: application/json

{"providerFoodId":"171077","quantity":150,"unit":"g"}
```

The returned food item includes its ID, name, actual-portion calories/macros,
quantity sources, and reference provenance. Supported convertible units are `g`,
`kg` and `oz`. Pieces and cups require an explicitly known gram weight; the API
does not invent a conversion. Foods without calorie data cannot be calculated
(422); use a manually confirmed item instead.

Include the returned item in the entry's `data.items`:

```json
{
  "category": "nutrition",
  "title": "Breakfast",
  "entryDate": "2026-10-05",
  "occurredAt": "2026-10-05T08:15:00+05:30",
  "note": "Rice",
  "attachments": [],
  "data": {
    "mealCategory": "breakfast",
    "items": [
      {
        "name": "Rice",
        "quantity": 150,
        "unit": "g",
        "caloriesKcal": 195,
        "proteinG": null,
        "carbohydratesG": null,
        "fatG": null,
        "nutritionSource": "user_entered"
      }
    ]
  }
}
```

Missing food item IDs are generated on creation. Keep existing IDs when editing.
Meals require 1–100 named items with positive quantities and finite nonnegative
calories; unknown macros are null. `nutritionSource` is `user_entered`,
`estimated` or `reference`; `quantitySource` is `user_entered` or `estimated`.
Reference items retain `provider`, `providerFoodId`, `amount` and `unit`.

Entries store confirmed nutrition snapshots and never call USDA during reads or
writes. When changing a reference portion, call the calculation endpoint again
and send the resulting item in the replacement `data`. An edit replaces the
entire `data` value rather than merging nested food items.

Exercise `data` contains `activityName`, positive `durationMinutes`, `intensity`
(`light`, `moderate`, `vigorous`), optional `estimatedCaloriesBurnedKcal` and
`calorieEstimationSource`. A calorie estimate requires a source. Note `data` is
`{}`. All categories support optional title and note; titles default to category.

Attachments are carried as Base64, stored in the owned entry JSON and returned
as Base64 by creation, detail, list and Home. No storage keys, file URLs or
storage credentials are required. For example:

```json
{"type":"image","mimeType":"image/png","base64":"iVBORw0KGgo..."}
```

Accept raw canonical Base64 or a matching `data:<mimeType>;base64,...` string;
responses normalize to raw Base64. Missing attachment IDs are generated and
`fileSizeBytes` is derived from decoded bytes. Supplied size metadata must match.
Encoding, image MIME signatures, duplicate IDs and positive metadata are
validated. There may be at most ten files and at most 20 MB decoded bytes in a
request; the HTTP JSON parser permits 30 MB to accommodate Base64 expansion.
Supported images are PNG, JPEG and WebP; audio uses server-validated MIME types.
OpenRouter receives image bytes as Base64 data URLs and audio as Base64
`input_audio`, using a registered audio-capable model. WAV, MP3 and M4A are supported
for AI audio input; other accepted audio MIME types return an explicit
`AI_UNSUPPORTED_AUDIO_FORMAT` rather than being silently ignored.

## Open Food Facts through Nutrition

`NutritionService` selects either `usda-fdc` (default) or `open-food-facts`.
Both implement the same NutritionProvider port and return the same normalized
Food and FoodItem shapes. Entries store the provider provenance and confirmed
snapshot, so Home and entry reads need no provider-specific changes.

```http
GET /v1/nutrition/search?provider=open-food-facts&q=Nutella&page=1
GET /v1/nutrition/foods/3017624010701?provider=open-food-facts
POST /v1/nutrition/calculate
Content-Type: application/json

{"provider":"open-food-facts","providerFoodId":"3017624010701","quantity":15,"unit":"g"}
```

Unknown providers and malformed IDs return 400. Barcode IDs stay strings, including
leading zeroes. Open Food Facts uses its recommended v3 product lookup and the
documented legacy full-text search endpoint; v2 search does not support plain
text. Nutrients come from normalized per-100 values, with a kJ fallback for energy
and null for missing macros. An explicit `100ml` reference permits `ml` and `l`
portions; mass-to-volume conversion requires a known density and is rejected.
Missing calorie references return 422 during calculation.

Read operations require no provider key. Configure
`OPEN_FOOD_FACTS_USER_AGENT` with Kimbo's version and contact information for
production. `OPEN_FOOD_FACTS_ENVIRONMENT=staging` uses the documented staging
host and its public staging authentication; the default is production. See the
[official API guidance](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/).

The adapter caches responses for five minutes (at most 200 entries), coalesces
identical concurrent requests, and caps uncached calls per instance to ten
searches and fifteen product reads per minute. These local limits are best effort
across multiple backend instances. Requests time out after twenty seconds;
upstream errors are sanitized to 404, 502 or 503.

`pnpm run nutrition:check-off` runs the live staged API flow using `test@email.com`,
logs a real 15 g product portion, verifies Entry/Home behavior, and soft-deletes
its entry. Pass `--production` to `node scripts/check-open-food-facts.mjs` for
read-only production-provider verification. Results are saved in
`docs/open-food-facts-verification.json`.

## Revisions and responses

An Entry flattens entity/details into one API representation with `id`,
`category`, `title`, `entryDate`, `occurredAt`, `recordedTimezone`, `inputSource`,
`note`, `attachments`, `data`, `summary`, `ai`, `revision` and timestamps. Home
uses this exact same Entry object. There are no Prisma row names in the response.

Send the current `revision` with PATCH for optimistic concurrency. A conflict
returns 409. Without it, PATCH uses the revision read at the beginning of the
request; a concurrent change during that request still produces a conflict.
Recorded timezone remains the original timezone on edits. The reporting date is
explicit and independent from actual event time.

Existing SQL triggers advance revisions for entity and details changes. Changing
both may advance by more than one: treat revision as an opaque increasing
version. Edits reset AI to pending and clear prior interpretation, retry metadata
and model attribution. AI-only updates never increment the entry revision.

## Home semantics

The reporting date selects confirmed, nondeleted entries. Nutrition consumed is
the sum of meal items; exercise duration and estimated burned calories are
separate. No nutrition totals are written into `health_records`. Burned calories
remain null if no exercises exist or any exercise lacks an estimate.

Profile wake/sleep values are local wall-clock boundaries. Sleep earlier than
wake appears on the next calendar date. Actual timestamps are displayed in the
user's current timezone and sorted chronologically; reporting-day entries
outside the configured schedule remain present and carry `outsideSchedule=true`.
A timezone change never silently changes an entry's reporting date.

Home exposes both `summary`/`timeline` and semantic `sections`:
`nutrition_summary`, `exercise_summary`, `timeline`. The client chooses its
components and styling. Day navigation uses calendar dates and `isToday` uses
the user's timezone.

`goal` is null unless the user confirmed a target. Otherwise it carries the
target, consumed calories and protein, `remainingKcal`, `deltaKcal`
(consumed − target), the largest meal and a `status`: `on_track` (within ±10%),
`over`, `under` (past days only), `in_progress` (today, below the band) or
`not_logged` (no meals; never treated as zero intake). `insight` is a
deterministic headline and next step: the main contributor when over (compared
with the same meal category's average over the previous 7 days), low protein
(<60% of target, evaluated after 17:00 for today), or a suggested next meal
sized from the remaining calories and protein. No LLM runs on this path.
`/v1/home/week` applies the same status rules per day and adds `future`.

## Background AI

Set the server-only key and enable processing:

```env
OPENROUTER_API_KEY=your-server-only-secret
AI_WORKER_ENABLED=true
```

`OPEN_AI_KEY` was renamed to `OPENROUTER_API_KEY` while preserving its value.
No direct OpenAI API is used. Models come exclusively from `ai_models`; an
environment variable cannot select a model outside that table. Run
`pnpm run ai:configure` to explicitly register GPT-4o-mini and Gemini 2.5 Flash Lite
after verifying the live OpenRouter catalog's image-input and structured-output
capabilities. This command preserves existing availability flags. It does not
run automatically at application startup.

The adapter selects an enabled OpenRouter record supporting text and images,
and additionally requires audio support for audio attachments. The oldest
eligible configured model is selected deterministically. `GET /v1/ai/models`
returns the permitted public model DTOs, excluding credential references. Both
the actual returned model and completion attribution are checked against the
table; completion never inserts new models. An absent compatible record yields
`AI_NO_ALLOWED_MODEL`, and an unregistered response model yields
`AI_UNREGISTERED_MODEL`.

The adapter follows the [OpenRouter chat completion API](https://openrouter.ai/docs/api_reference/overview)
and requests strict JSON schema output. Images are sent as
[Base64 data URLs](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding),
and audio as Base64 input_audio. The generated short synopsis and observations
remain separate from confirmed entry facts and calories. The provider has a
30-second timeout.

Creation commits immediately with `ai.status=pending`. A five-second poller
claims database work using entity row locks and `SKIP LOCKED`; there is no
in-memory job queue to lose on restart. A 60-second lease prevents duplicate
claims. Expired leases are reclaimed, attempts are limited to three, and failures
back off for 10 then 20 seconds. Exhausted work becomes failed. Missing credentials or a disabled worker leave work pending, so CRUD/Home continue
to function. Provider errors are stored as sanitized codes.

Output saves under the same entity lock used by edits, with owner, input
revision, processing status and lease checks. Stale or expired workers cannot
replace newer output. Completed output records actual provider model attribution
and pipeline version without changing content revision. An edit retries a failed
entry by resetting its workflow. Shutdown waits for the current iteration.

## Verification

`pnpm test` covers input rules, normalization, portions, Home and AI orchestration.
`pnpm run test:e2e` verifies HTTP contracts with isolated repository/provider
fixtures, including bearer identity, onboarding and production stub rejection.

`pnpm run product:check` is an opt-in live integration check using the existing
`test@email.com` account and real USDA requests. It creates temporary entries,
checks CRUD/Home, ownership, revision conflicts, stale AI output, exclusive
claims, lease recovery, backoff and retry exhaustion, then soft-deletes those
entries and verifies totals return to their baseline. Successful AI persistence is exercised with synthetic output attributed only
to an existing registered model, inside an explicitly rolled-back transaction.
Sleep schedules 07:00–00:30 and 07:00–23:00 are tested through real HTTP responses
using real database profile adapters inside rolled-back fixture transactions.
This check never calls OpenRouter or changes onboarding. Soft-deleted test entries remain as audit data by design.


`pnpm run ai:check` calls OpenRouter with an actual Base64 image fixture through each registered model,
verifies entry creation/detail/list round-trips and completed output attribution,
then soft-deletes its test entries. It uses only models already in `ai_models`.
Add `--audio-only` when running `node scripts/check-ai-flows.mjs` to check Base64 WAV audio with the registered audio-capable model.
The live account currently receives HTTP 402 for audio because OpenRouter requires
at least $0.50 in balance for audio requests. Base64 audio create/read/list and
outbound input_audio payload checks pass; live audio analysis remains blocked
until that balance requirement is met. The public Entry AI object exposes the
sanitized `errorCode` (such as `AI_INSUFFICIENT_CREDITS`).
Provider calls can use account credits. Reports contain no provider secrets:
`docs/product-api-verification.json`, `docs/ai-model-catalog-check.json` and
`docs/ai-live-verification.json`.

## Calorie estimates

`POST /v1/estimates` with `{ category: 'nutrition' | 'exercise', title, note, image: { mimeType, base64 } }` returns a preview that the app shows for confirmation before it creates the entry.

- **nutrition**: the AI splits the note (and photo) into foods with estimated grams/ml. Each food is searched in USDA first (Open Food Facts first for branded items), with the other database as fallback; a second AI call picks the matching candidate. Returns `items` (FoodItems with `nutritionSource: 'reference'`, `quantitySource: 'estimated'`, plus `matchedName`, `amount`, `amountUnit`), `unmatched[{name, reason}]` and `totals`.
- **exercise**: the AI extracts activities mapped to a MET key (`src/modules/estimates/domain/met-table.ts`); kcal = MET × latest weight (kg) × hours. Returns `activities`, `weightKg` and `totals`. Saved exercise entries use `calorieEstimationSource: 'ai_met_estimate'` and may carry `data.activities[]`.
- Errors (422 `{code, message}`): `ESTIMATE_NO_FOOD_FOUND`, `ESTIMATE_NO_MATCH` (with `unmatched`), `ESTIMATE_NO_ACTIVITY_FOUND`, `ESTIMATE_WEIGHT_REQUIRED`; 503 `ESTIMATE_AI_UNAVAILABLE` when the model call fails.

Creating a nutrition or exercise entry (`POST /v1/entries`) now requires a non-empty `title`, `note` and at least one image attachment. Home's day goal compares **net** calories (consumed − burned) with the target and adds `burned` and `netKcal`.
