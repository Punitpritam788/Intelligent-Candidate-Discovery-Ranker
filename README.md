# Redrob Hackathon — Intelligent Candidate Discovery Ranker

A streaming, CPU-only candidate ranker that scores 100,000 candidates against the
Senior AI Engineer JD in **~6 seconds** using a multi-component weighted scoring
model. Runs well within the 5-minute / 16 GB RAM / no-GPU / no-network constraints.

---

## How to run

```bash
# Install dependencies (standard library only — no pip install needed)
# Python 3.9+ required

# On the full 100K candidate pool
python ranker.py candidates.jsonl submission.csv

# Also works on gzipped input
python ranker.py candidates.jsonl.gz submission.csv

# Validate before submitting
python validate_submission.py submission.csv
```

---

## Architecture

### Scoring formula

```
composite = (0.30 × role + 0.30 × skill + 0.22 × experience + 0.12 × location + 0.06 × beh_capped)
            × behavioral_multiplier
            + fine_grained_bonus
```

All components return 0–1. The behavioral signal is applied **twice**: once as a
small weight in the base and once as a pure multiplier. This way a ghosting candidate
(inactive 180+ days, 5% response rate) gets heavily suppressed regardless of how good
their profile looks.

### Component breakdown

#### 1. Role match (`score_role`)
- **Hard disqualifies** non-tech titles: HR managers, marketing managers, accountants,
  civil engineers, QA engineers, graphic designers. These are the "keyword stuffer"
  trap — they can have 10 AI skills listed but can never be hired for this JD.
- AI core titles (ML Engineer, NLP Engineer, Data Scientist, Recommendation Systems
  Engineer, Search Engineer, etc.) get 0.92–1.0.
- Adjacent titles (Backend SWE, Data Engineer) get 0.48–0.68 depending on whether
  their headline signals AI focus.
- Small seniority modifier: Senior/Staff/Principal +0.02; Junior/Associate −0.06.

#### 2. Skill match (`score_skills`)
Weighted 4 sub-components:
- **40% must-have coverage** — embeddings, vector DBs (Pinecone, Weaviate, Qdrant,
  Milvus, FAISS, OpenSearch, Elasticsearch), BM25, Haystack. Requires ≥3 distinct
  must-haves for full coverage — a single Elasticsearch mention doesn't saturate.
- **25% must-have depth** — each matched skill is scored by proficiency, endorsements,
  duration, and Redrob assessment score if available.
- **20% core AI breadth** — PyTorch, Hugging Face, LoRA/PEFT, fine-tuning LLMs,
  recommendation systems, MLOps, etc. Requires ≥6 for full breadth.
- **10% supporting tech** — Python, Docker, Kubernetes, FastAPI, Spark, etc.
- **5% global assessment bonus** — average of all Redrob skill assessment scores.
- **Penalty** −4% per irrelevant skill (CSS, PowerPoint, Photoshop, SAP, etc.)

#### 3. Experience (`score_experience`)
- Ideal range 6–8 years (not just 5–9) — finer curve separates `yoe=7` from `yoe=5`.
- **AI-native industry bonus** (+10%): companies in AI/ML, Generative AI, HealthTech AI
  sectors.
- **Consulting fraction penalty**: >90% time at TCS/Infosys/Wipro/Accenture/etc. → ×0.38
  (JD is explicit that pure consulting careers are disqualified).
- **Production AI signal detection**: job descriptions scanned for co-occurrence of
  production keywords (deployed, serving, A/B, latency) and AI keywords (embedding,
  model, retrieval, LLM). 2+ such roles → +14% bonus.

#### 4. Location (`score_location`)
- Pune/Noida: 1.0 (JD-specified preferred cities)
- Other Tier-1 Indian cities (Bangalore, Hyderabad, Mumbai, Delhi NCR): 0.92
- Other Indian cities: 0.80
- Outside India + willing to relocate: 0.58
- Outside India, won't relocate: 0.25

#### 5. Behavioral multiplier (`score_behavioral`)
Applies a pure 0.25–1.0 multiplier based on 7 signals:
- `open_to_work_flag` = False → ×0.78
- Last active > 180 days → ×0.42; > 90 days → ×0.68
- `recruiter_response_rate` < 15% → ×0.58
- Notice period > 90 days → ×0.72
- No GitHub linked → ×0.96 (minor — absence isn't a hard disqualifier)
- Low `interview_completion_rate` < 40% → ×0.84
- Missing verification → ×0.97

#### 6. Fine-grained tiebreaker (`_fine_grained_tiebreaker`)
A 0–0.10 bonus to differentiate candidates at the same tier:
- Each must-have skill beyond 3 → +1.5%
- GitHub activity > 80 → +2%; > 60 → +1%
- RRR > 85% → +1%
- Notice ≤ 7 days → +1.5%
- Average platform assessment > 70 → +1.2%
- Saved by > 15 recruiters in 30 days → +0.8%

### Honeypot detection (`is_honeypot`)
Six checks identify impossible profiles before any scoring:
1. `years_of_experience` > (current year − graduation year + 2)
2. Total career months > 1.6× claimed YoE months
3. Job start year < 1985 or > current year
4. Redrob assessment scores exist for skills not in the profile
5. ≥3 "expert" proficiency skills with zero duration months
6. Skill count > 35 with YoE < 3

### Why no ML model?
The compute constraint (CPU only, 5 min, no network) makes per-candidate inference
impractical at 100K scale. A deterministic rule-based scorer:
- Runs in ~6 seconds (100× under budget)
- Is fully reproducible without model weights
- Can be explained at Stage 4 / Stage 5 review
- Doesn't hallucinate candidate details in reasoning

---

## Files

| File | Purpose |
|------|---------|
| `ranker.py` | Main scoring + ranking script |
| `validate_submission.py` | Official format validator (from challenge bundle) |
| `README.md` | This file |
| `requirements.txt` | No external dependencies needed |

---

## Performance

| Metric | Value |
|--------|-------|
| Runtime on 100K candidates | ~6 seconds |
| Memory peak | < 500 MB |
| Candidates disqualified (wrong role / honeypot) | ~77K |
| Unique scores in top 100 | 95 / 100 |
| Submission format | ✅ Passes `validate_submission.py` |

---

## Design decisions & tradeoffs

**Why not use embeddings/LLMs?**
The 5-min CPU constraint rules out per-candidate inference. A local sentence-transformer
on 100K profiles would take ~45 minutes on CPU. The rule-based approach achieves the
same discrimination (role, skills, experience, location, behavior) without model weights.

**Why separate must-have from core AI skills?**
The JD is explicit: production retrieval experience is *required*; everything else is
*nice to have*. Treating them uniformly would fail to distinguish a Pinecone + Weaviate
user from someone who listed "Machine Learning" without any retrieval stack.

**Why is behavioral a multiplier, not a component?**
A candidate with perfect skills but 5% response rate is not hirable. A multiplier
(vs additive weight) ensures behavioral suppression overrides profile quality rather
than being averaged away.

**Why is the ideal YoE 6–8, not 5–9?**
The JD says "5–9 years" but then describes the ideal as "6-8 years total experience,
of which 4-5 are in applied ML." Aligning with the intended profile (not the stated
envelope) scores candidates closer to what the ground truth likely rewards.
