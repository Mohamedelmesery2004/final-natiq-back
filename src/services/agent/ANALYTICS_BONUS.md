# Agent Analytics Engine — Production Supplement

---

## 1. MongoDB Index Recommendations

The service uses aggregation pipelines extensively. Without proper indexes, these will degrade under load.
Add these indexes **in addition** to existing ones:

### Tickets Collection
```js
// Already exists: { companyId:1, assignedTo:1, status:1, createdAt:-1 }
// Add for time-series & KPI aggregations:
{ companyId:1, assignedTo:1, createdAt:-1, status:1, firstResponseAt:1, resolvedAt:1 }
{ companyId:1, assignedTo:1, status:1, resolvedAt:1 }  // resolution queries
{ companyId:1, status:1, assignedTo:1 }                  // reopen & rank queries
```

### EventLog Collection
```js
// Already exists: { companyId:1, eventType:1, timestamp:-1 }
// Add for reopen detection & activity feed:
{ companyId:1, "metadata.agentId":1, eventType:1, timestamp:-1 }
{ companyId:1, entityType:1, entityId:1 }  // already exists
```

### QAAnalysis Collection
```js
// Already exists: { companyId:1, agentId:1, createdAt:-1 }
// This covers our agent intelligence queries
```

### Calls Collection
```js
// Already exists: { companyId:1, agentId:1, createdAt:-1 }
// Ensure this compound index is present:
{ companyId:1, agentId:1, startedAt:-1, status:1 }
```

### TicketFeedback Collection
```js
// Already exists: { companyId:1, agentId:1, submittedAt:-1 }
```

### Index Strategy Notes
- **Compound indexes** covering filter + sort keys are critical for aggregation `$match` + `$sort` stages
- Use **partial indexes** where applicable: `{ firstResponseAt: { $exists: true } }` on response-time queries
- For time-series, the descending sort on `createdAt`/`timestamp` should match the aggregation sort
- Monitor `totalKeysExamined` vs `totalDocsExamined` — ratio should stay close to 1:1

---

## 2. Redis Caching Strategy

### Key Design

```redis
# Agent analytics — full payload (TTL: 5 min)
agent:analytics:{companyId}:{agentId}:{from}:{to}:{channel}

# Individual modules (TTL: 5 min)
agent:kpis:{companyId}:{agentId}:{from}:{to}
agent:timeseries:{companyId}:{agentId}:{from}:{to}
agent:intelligence:{companyId}:{agentId}
agent:calls:{companyId}:{agentId}:{from}:{to}
agent:feed:{companyId}:{agentId}

# Company-level aggregates for rank/benchmarks (TTL: 15 min)
company:agent-ranks:{companyId}

# Leaderboard / gamification (TTL: 10 min)
company:leaderboard:{companyId}:{period}
```

### Invalidation Triggers
- **On ticket claim/resolve/reply** → invalidate agent's `kpis`, `timeseries`, `feed` keys
- **On QA analysis complete** → invalidate `intelligence` key
- **On call event** → invalidate `calls` key
- Use Redis `EXPIRE` with jitter (±20%) to prevent cache-stampede

### Implementation Pattern
```js
// Pseudo-code for cache layer wrapper
async function withCache(key, ttl, fetchFn) {
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);
  const data = await fetchFn();
  await redis.setex(key, ttl + Math.floor(Math.random() * ttl * 0.2), JSON.stringify(data));
  return data;
}
```

### When NOT to cache
- Real-time activity feed (serve fresh always or use 30s TTL)
- Very infrequent queries (cost of deserialization > query cost)
- Admin/manager drill-downs into specific tickets

---

## 3. Paginating Large Datasets

### Current state: Not paginated
The `_computeTimeSeries` and `ticketsOverTime` arrays can grow unbounded if the date range is large.

### Strategy

#### A. Date-bucketed pagination (for time-series)
```js
// Accept ?page=1&limit=90 (days per page)
const page = Math.max(1, parseInt(query.page) || 1);
const limit = Math.min(365, parseInt(query.limit) || 90);
const skip = (page - 1) * limit;
const startDate = new Date(now.getTime() - skip * 86400000);
const endDate = new Date(startDate.getTime() - limit * 86400000);
```

#### B. Cursor-based pagination (for activity feed)
```js
// ?before=<timestamp>&limit=20
const match = { timestamp: { $lt: new Date(before) } };
const events = await eventLogRepo.aggregate([
  { $match: match },
  { $sort: { timestamp: -1 } },
  { $limit: limit + 1 },  // fetch one extra to detect next page
]);
const hasMore = events.length > limit;
const data = hasMore ? events.slice(0, limit) : events;
const nextCursor = data[data.length - 1]?.timestamp;
```

#### C. Aggregation with $facet (for combined paginated views)
```js
ticketRepo.aggregate([
  { $match: { companyId, assignedTo: agentId } },
  {
    $facet: {
      metadata: [{ $count: 'total' }],
      data: [
        { $sort: { createdAt: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
        { $project: { ... } },
      ],
    },
  },
]);
```

---

## 4. AI Extension Roadmap

### Phase 1: Pattern Detection Rules (Current)
- Rule-based insights (threshold comparisons)
- Trend detection (period-over-period deltas)
- Static recommendation templates

### Phase 2: Statistical Anomaly Detection
- Moving averages with standard deviation bands
- Z-score based outlier detection on response/resolution times
- Holt-Winters forecasting for ticket volume prediction

### Phase 3: ML-Powered Recommendations
- Train a regression model to predict:
  - Ticket resolution time based on channel, category, hour
  - CSAT score based on response time, reopen rate, channel
  - Optimal agent-workload balance
- Use a lightweight ONNX model served in-process or via sidecar

### Phase 4: Full NLP & LLM Integration
```js
// Architecture
analyticsService.getFullAnalytics() → generate JSON payload
→ LLM prompt template (system + analytics data)
→ LLM response with:
  - Natural-language performance summary
  - Personalized coaching advice
  - Predicted churn risk per ticket/customer
  - Suggested next actions ranked by expected impact
```

```text
System Prompt:
"You are an analytics AI for a customer support platform.
Given the following agent performance data, provide:
1. A 2-sentence performance summary
2. The top 3 actionable recommendations ranked by impact
3. One specific skill to focus on today

Data: {kpis, charts, performanceInsights, agentAnalysis, goals, callInsights}
Respond in JSON: { summary, topRecommendations, focusSkill }
```

### Phase 5: Real-Time Behavioral Coaching
- WebSocket stream of events → sliding window analysis
- If agent's response time exceeds threshold for 3 consecutive tickets → push notification:
  - *"You've been slower than usual on the last 3 tickets. Try using saved replies."*
- If sentiment drops → suggest escalation or break

### Infrastructure Considerations
- Queue heavy analytics computation with Bull/BullMQ
- Use materialized views (MongoDB $merge) for pre-aggregated daily rollups
- Cache computed KPIs in Redis with TTL aligned to data staleness tolerance
- Offload time-series to dedicated TSDB (TimescaleDB/InfluxDB) at scale (>100k events/day)
