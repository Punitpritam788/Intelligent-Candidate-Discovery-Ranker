#!/usr/bin/env python3
"""
Redrob Hackathon — Intelligent Candidate Discovery Ranker
==========================================================
Ranks 100K candidates against the Senior AI Engineer JD.

Strategy
--------
  composite = role × skill × experience × location × behavioral_multiplier

Key design decisions:
1. Role filter eliminates non-AI/ML titles immediately (Marketing Managers with
   "AI skills" are the canonical trap — this kills them early and cheaply).
2. Skill scoring weights must-have retrieval skills (embeddings, vector DBs)
   most heavily; requires ≥3 for full must-have coverage so a single vector DB
   mention doesn't saturate the score.
3. Experience scoring rewards product-company AI deployments, penalises
   consulting-only careers, and detects production signals in descriptions.
4. Title seniority, industry prestige, and assessment scores create fine-grained
   differentiation within the top tier so NDCG@10 doesn't rely on alphabetical
   tie-breaking.
5. Behavioral signals act as a pure multiplier — a ghosting candidate drops
   regardless of how good their profile looks.
6. Honeypot detection (timeline consistency, skill coherence) is applied first.

Compute: streaming JSONL, O(N log k) heap — runs in ~6 s on 100K candidates.
"""

import csv
import heapq
import json
import sys
from datetime import date, datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

REFERENCE_DATE = date(2026, 6, 23)
TOP_N = 100

# -- Role taxonomy ------------------------------------------------------------

AI_CORE_TITLES = {
    # Perfect title match — score_role() returns 1.0
    "ml engineer", "machine learning engineer", "senior ml engineer",
    "staff ml engineer", "principal ml engineer", "lead ml engineer",
    "ai engineer", "senior ai engineer", "ai/ml engineer",
    "applied scientist", "applied ml engineer", "applied machine learning engineer",
    "nlp engineer", "senior nlp engineer", "lead nlp engineer",
    "mlops engineer", "ml platform engineer", "ml infrastructure engineer",
    "search engineer", "senior search engineer",
    "ranking engineer", "recommendations engineer", "recommendation systems engineer",
    "conversational ai engineer", "generative ai engineer", "llm engineer",
    "rag engineer", "information retrieval engineer",
    "computer vision engineer", "deep learning engineer",
    "ai researcher", "ml scientist", "machine learning scientist",
    "senior ml scientist", "staff ml scientist",
    # Data Scientist titles (slightly less perfect for an "engineer" role)
    "data scientist", "senior data scientist", "lead data scientist",
    "staff data scientist", "principal data scientist",
    "research engineer",
}

# Titles that *could* be AI engineers — scored on skill quality
AI_ADJACENT_TITLES = {
    "software engineer", "senior software engineer", "staff software engineer",
    "principal software engineer", "backend engineer", "senior backend engineer",
    "platform engineer", "senior platform engineer",
    "data engineer", "senior data engineer", "lead data engineer",
    "systems engineer", "full stack engineer", "engineer",
    "infrastructure engineer",
}

DISQUALIFIED_TITLE_FRAGMENTS = {
    "hr manager", "human resources", "recruiter", "talent acquisition",
    "marketing", "digital marketing", "seo",
    "sales manager", "sales executive", "account executive", "business development",
    "accountant", "finance manager", "financial analyst",
    "civil engineer", "mechanical engineer", "structural engineer",
    "operations manager", "operations analyst",
    "project manager", "program manager", "scrum master",
    "graphic designer", "ui designer", "ux designer",
    "customer support", "customer success", "customer service",
    "content writer", "copywriter", "technical writer",
    "qa engineer", "quality assurance", "test engineer",
    "business analyst", "product analyst",
    "frontend engineer", "front end engineer", "ui engineer",
    "product designer", "mobile developer",
}

# Title seniority modifier within AI_CORE_TITLES
SENIOR_FRAGMENTS   = {"senior", "staff", "principal", "lead"}
JUNIOR_FRAGMENTS   = {"junior", "associate", "jr"}
DATA_SCI_FRAGMENTS = {"data scientist"}  # good but slightly less "engineer"

# -- Skill taxonomy ------------------------------------------------------------

MUST_HAVE_SKILLS = {
    # Production retrieval / vector infrastructure — JD explicitly requires this
    "embeddings", "vector search", "faiss", "pinecone", "weaviate", "qdrant",
    "milvus", "opensearch", "elasticsearch", "sentence transformers",
    "information retrieval", "bm25", "haystack",
}

CORE_AI_SKILLS = {
    "deep learning", "nlp", "machine learning", "pytorch", "tensorflow",
    "hugging face transformers", "fine-tuning llms", "lora", "peft",
    "recommendation systems", "feature engineering", "scikit-learn",
    "reinforcement learning", "gans", "cnn", "object detection",
    "image classification", "computer vision", "speech recognition",
    "forecasting", "statistical modeling", "data science", "prompt engineering",
    "langchain", "mlops", "mlflow", "weights & biases", "kubeflow",
    "bentoml", "triton inference server",
}

SUPPORTING_SKILLS = {
    "python", "spark", "kafka", "airflow", "docker", "kubernetes",
    "aws", "gcp", "azure", "fastapi", "redis", "postgresql", "mongodb",
    "databricks", "bigquery", "dbt", "snowflake", "apache flink",
    "apache beam", "rest apis", "ci/cd", "terraform", "go", "rust",
    "grpc", "microservices",
}

NEGATIVE_SKILLS = {
    "excel", "powerpoint", "photoshop", "illustrator", "css", "html",
    "angular", "react", "vue.js", "next.js", "salesforce crm", "six sigma",
    "sap", "tally", "accounting", "marketing", "seo", "content writing",
    "sales", "figma", "redux", "webpack", "node.js", "javascript",
    "typescript", "spring boot",
}

CONSULTING_COMPANIES = {
    "tcs", "tata consultancy services", "infosys", "wipro",
    "accenture", "cognizant", "capgemini", "hcl", "hcl technologies",
    "tech mahindra", "hexaware", "mphasis", "ltimindtree", "mindtree",
    "ibm global services", "kpmg", "deloitte",
}

# Industries associated with genuine product-company AI work
AI_NATIVE_INDUSTRIES = {
    "ai/ml", "artificial intelligence", "generative ai", "conversational ai",
    "healthtech ai", "fintech ai", "edtech ai",
}
PRODUCT_INDUSTRIES = {
    "saas", "software", "fintech", "edtech", "healthtech", "internet",
    "e-commerce", "food delivery", "transportation", "consumer electronics",
    "gaming", "cybersecurity", "cloud", "telecommunications",
}

INDIA_TIER1 = {"pune", "noida", "delhi", "ncr", "gurgaon", "gurugram",
               "hyderabad", "mumbai", "bangalore", "bengaluru", "chennai"}
INDIA_TIER2 = {"ahmedabad", "kolkata", "jaipur", "lucknow", "indore",
               "chandigarh", "coimbatore", "trivandrum", "kochi", "bhopal"}

# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def days_since(date_str: str) -> int:
    if not date_str:
        return 9999
    try:
        d = datetime.fromisoformat(date_str.split("T")[0]).date()
        return max(0, (REFERENCE_DATE - d).days)
    except (ValueError, AttributeError):
        return 9999


def norm(text: str) -> str:
    return (text or "").lower().strip()


# ---------------------------------------------------------------------------
# Honeypot detection
# ---------------------------------------------------------------------------

def is_honeypot(c: dict) -> bool:
    profile    = c.get("profile", {})
    career     = c.get("career_history", [])
    education  = c.get("education", [])
    skills     = c.get("skills", [])
    signals    = c.get("redrob_signals", {})
    yoe        = profile.get("years_of_experience", 0) or 0

    # 1. YoE inconsistent with graduation year
    grad_years = [
        e.get("end_year") or e.get("start_year")
        for e in education
        if isinstance(e.get("end_year") or e.get("start_year"), int)
    ]
    if grad_years:
        earliest = min(grad_years)
        if yoe > (REFERENCE_DATE.year - earliest + 2):
            return True

    # 2. Career duration vs claimed YoE
    total_months = sum(j.get("duration_months", 0) or 0 for j in career)
    if total_months > 0 and yoe > 0:
        if total_months > yoe * 12 * 1.6 and total_months > yoe * 12 + 30:
            return True

    # 3. Impossible job start years
    for job in career:
        start = job.get("start_date", "")
        if start:
            try:
                yr = int(start[:4])
                if yr < 1985 or yr > REFERENCE_DATE.year:
                    return True
            except ValueError:
                pass

    # 4. Assessments for skills not in profile
    assessed = set((signals.get("skill_assessment_scores") or {}).keys())
    profile_skills = {s["name"] for s in skills}
    if assessed and not assessed.intersection(profile_skills):
        return True

    # 5. Expert proficiency with zero duration
    if sum(1 for s in skills
            if s.get("proficiency") == "expert" and (s.get("duration_months") or 0) == 0) >= 3:
        return True

    # 6. Implausibly large skill count for a junior candidate
    if len(skills) > 35 and yoe < 3:
        return True

    return False


# ---------------------------------------------------------------------------
# Scoring components
# ---------------------------------------------------------------------------

def score_role(profile: dict) -> float:
    """
    0.0–1.0. Title match quality.

    Within AI_CORE_TITLES, we apply a small seniority modifier:
    Senior/Staff/Principal → +0.02 (more experience in the role)
    Junior/Associate       → −0.06 (less ideal for a senior-level JD)
    Data Scientist         → −0.03 (good fit but engineering > science for this JD)
    """
    title    = norm(profile.get("current_title", ""))
    headline = norm(profile.get("headline", ""))

    # Hard disqualify non-tech roles
    for frag in DISQUALIFIED_TITLE_FRAGMENTS:
        if frag in title:
            return 0.0

    # Core AI match
    for t in AI_CORE_TITLES:
        if t == title or t in title:
            base = 1.0
            if any(f in title for f in JUNIOR_FRAGMENTS):
                base -= 0.06
            if any(f in title for f in DATA_SCI_FRAGMENTS):
                base -= 0.03
            if any(f in title for f in SENIOR_FRAGMENTS):
                base = min(base + 0.02, 1.0)
            return round(max(base, 0.70), 4)

    # Adjacent tech role
    for t in AI_ADJACENT_TITLES:
        if t == title or t in title:
            ai_headline_kws = {"ai", "ml", "nlp", "machine learning", "deep learning",
                               "embedding", "retrieval", "ranking", "search", "llm"}
            if any(kw in headline for kw in ai_headline_kws):
                return 0.68
            return 0.48

    # Generic tech-sounding title not in either list
    generic_kws = {"engineer", "developer", "architect", "scientist", "analyst"}
    if any(kw in title for kw in generic_kws):
        if any(kw in headline for kw in {"ai", "ml", "nlp", "machine learning", "embedding"}):
            return 0.42
        return 0.22

    return 0.05


def score_skills(skills: list, signals: dict) -> tuple[float, int, list]:
    """
    Returns (skill_score 0.0–1.0, ai_skill_count, must_hit_names).

    Scoring breakdown:
      40% — must-have coverage (need ≥3 distinct must-have skills for full score)
      25% — must-have depth  (proficiency × endorsements × assessment)
      20% — core AI breadth  (need ≥6 for full breadth score)
      10% — supporting tech  (need ≥5 for full score)
      5%  — assessment bonus (average score on assessed skills)
    Penalty: −0.04 per negative skill
    """
    prof_weight   = {"expert": 1.0, "advanced": 0.85, "intermediate": 0.60, "beginner": 0.30}
    assessments   = signals.get("skill_assessment_scores") or {}

    # Build normalised skill map
    skill_map: dict[str, dict] = {}
    for s in skills:
        n = norm(s.get("name", ""))
        if n:
            skill_map[n] = s

    def depth(sname: str) -> float:
        """Composite quality score for a matched skill."""
        s = skill_map.get(sname, {})
        p  = prof_weight.get(s.get("proficiency", "beginner"), 0.30)
        en = min((s.get("endorsements") or 0) / 40, 1.0)
        du = min((s.get("duration_months") or 0) / 30, 1.0)
        # Platform assessment score (if available)
        original = s.get("name", "")
        assessed = assessments.get(original)
        if assessed is not None:
            p = 0.55 * p + 0.45 * (assessed / 100)
        return 0.50 * p + 0.30 * en + 0.20 * du

    must_hits = [n for n in MUST_HAVE_SKILLS if n in skill_map]
    core_hits = [n for n in CORE_AI_SKILLS  if n in skill_map]

    # Must-have: ≥3 for full coverage (1 skill alone shouldn't saturate)
    must_coverage  = min(len(must_hits) / 3, 1.0)
    must_depth_avg = (sum(depth(n) for n in must_hits) / len(must_hits)
                      if must_hits else 0.0)

    # Core AI breadth: ≥6 for full score
    core_breadth = min(len(core_hits) / 6, 1.0)
    core_depth   = (sum(depth(n) for n in core_hits) / len(core_hits)
                    if core_hits else 0.0)
    core_score   = 0.65 * core_breadth + 0.35 * core_depth

    # Supporting tech
    support_score = min(sum(1 for n in SUPPORTING_SKILLS if n in skill_map) / 5, 1.0)

    # Global assessment bonus (average of all assessed skills)
    if assessments:
        assess_bonus = sum(assessments.values()) / len(assessments) / 100
    else:
        assess_bonus = 0.0

    # Negative penalty
    neg_penalty = min(sum(1 for n in NEGATIVE_SKILLS if n in skill_map) * 0.04, 0.20)

    composite = (
        0.40 * must_coverage
        + 0.25 * must_depth_avg
        + 0.20 * core_score
        + 0.10 * support_score
        + 0.05 * assess_bonus
        - neg_penalty
    )

    ai_count = len(must_hits) + len(core_hits)
    return max(0.0, min(composite, 1.0)), ai_count, must_hits


def score_experience(profile: dict, career: list) -> float:
    """
    0.0–1.0. Rewards product-company AI production experience.
    Penalises consulting-only careers and lack of visible production work.
    """
    yoe = profile.get("years_of_experience", 0) or 0

    # YoE fit curve (ideal 6–8 years, not just 5–9)
    if 6 <= yoe <= 8:
        yoe_score = 1.00
    elif 5 <= yoe < 6 or 8 < yoe <= 9:
        yoe_score = 0.93
    elif 4 <= yoe < 5 or 9 < yoe <= 11:
        yoe_score = 0.82
    elif 3 <= yoe < 4 or 11 < yoe <= 13:
        yoe_score = 0.65
    elif yoe < 3:
        yoe_score = 0.28
    else:
        yoe_score = 0.52     # > 13 years

    # Industry quality bonus
    current_industry = norm(profile.get("current_industry", ""))
    if any(ai in current_industry for ai in AI_NATIVE_INDUSTRIES):
        yoe_score = min(yoe_score * 1.10, 1.0)   # AI-native company
    elif any(pi in current_industry for pi in PRODUCT_INDUSTRIES):
        yoe_score = min(yoe_score * 1.02, 1.0)   # Good product company

    # Consulting fraction analysis
    total_months = 0
    consulting_months = 0
    ai_production_jobs = 0

    for job in career:
        months = job.get("duration_months", 0) or 0
        total_months += months
        company = norm(job.get("company", ""))
        if any(c in company for c in CONSULTING_COMPANIES):
            consulting_months += months

        desc  = norm(job.get("description", "") or "")
        title = norm(job.get("title", "") or "")

        prod_kws = {"deployed", "production", "inference", "real user", "scale",
                    "latency", "serving", "a/b", "ranking", "retrieval", "search"}
        ai_kws   = {"ml", "machine learning", "neural", "embedding", "model",
                    "transformer", "llm", "nlp", "vector", "recommendation"}

        prod_hit = sum(1 for kw in prod_kws if kw in desc)
        ai_hit   = sum(1 for kw in ai_kws   if kw in desc or kw in title)
        if prod_hit >= 2 and ai_hit >= 2:
            ai_production_jobs += 1

    cons_frac = consulting_months / max(total_months, 1)
    if cons_frac > 0.90:
        yoe_score *= 0.38   # JD says "consulting-only career" is explicit disqualifier
    elif cons_frac > 0.65:
        yoe_score *= 0.62
    elif cons_frac > 0.40:
        yoe_score *= 0.80

    # Production AI bonus
    if ai_production_jobs >= 2:
        yoe_score = min(yoe_score * 1.14, 1.0)
    elif ai_production_jobs == 1:
        yoe_score = min(yoe_score * 1.06, 1.0)
    elif yoe > 5:
        yoe_score *= 0.88    # No visible production AI despite claiming experience

    return min(yoe_score, 1.0)


def score_location(profile: dict, signals: dict) -> float:
    """0.0–1.0. Pune/Noida ideal; all major Indian cities solid."""
    location = norm(profile.get("location", ""))
    country  = norm(profile.get("country", ""))
    willing  = signals.get("willing_to_relocate", False)

    if country == "india":
        if any(c in location for c in {"pune", "noida"}):
            return 1.00      # Exact JD-preferred cities
        if any(c in location for c in INDIA_TIER1):
            return 0.92
        if any(c in location for c in INDIA_TIER2):
            return 0.80
        return 0.72          # India but smaller city
    elif willing:
        return 0.58
    else:
        return 0.25


def score_behavioral(signals: dict) -> float:
    """
    0.25–1.0 multiplier. Applied last — suppresses unavailable candidates
    regardless of profile quality. Never goes above 1.0 to avoid artificial inflation.
    """
    mult = 1.0

    # 1. Open-to-work
    if not signals.get("open_to_work_flag", False):
        mult *= 0.78

    # 2. Recency of last login
    inactive = days_since(signals.get("last_active_date"))
    if inactive > 180:
        mult *= 0.42
    elif inactive > 90:
        mult *= 0.68
    elif inactive > 45:
        mult *= 0.86
    elif inactive < 7:
        mult *= 1.0   # Recently active — no extra boost, just no penalty

    # 3. Recruiter response rate
    rrr = signals.get("recruiter_response_rate") or 0.5
    if rrr < 0.15:
        mult *= 0.58
    elif rrr < 0.35:
        mult *= 0.80
    elif rrr > 0.70:
        mult *= 1.0   # Good rrr — no extra boost

    # 4. Notice period (JD: prefers sub-30 days; will buy out 30 days)
    notice = signals.get("notice_period_days") or 60
    if notice <= 15:
        mult *= 1.0
    elif notice <= 30:
        mult *= 0.97
    elif notice <= 60:
        mult *= 0.90
    elif notice <= 90:
        mult *= 0.82
    else:
        mult *= 0.72

    # 5. GitHub activity (active coder bonus / absence slight penalty)
    github = signals.get("github_activity_score", -1)
    if github == -1:
        mult *= 0.96
    elif github < 15:
        mult *= 0.96

    # 6. Interview completion rate
    icr = signals.get("interview_completion_rate") or 0.7
    if icr < 0.40:
        mult *= 0.84
    elif icr < 0.60:
        mult *= 0.94

    # 7. Verification basics
    if not (signals.get("verified_email") and signals.get("verified_phone")):
        mult *= 0.97

    return max(0.25, min(mult, 1.0))


def _fine_grained_tiebreaker(c: dict, must_hits: list, ai_count: int) -> float:
    """
    A small 0.0–0.10 bonus that differentiates candidates with otherwise identical
    component scores. Incorporates signals that don't fit cleanly into the main
    weighted components but are real quality signals.
    """
    signals = c.get("redrob_signals", {})
    profile = c.get("profile", {})

    bonus = 0.0

    # More must-have skills (beyond the 3 needed for full coverage)
    if len(must_hits) >= 4:
        bonus += 0.015 * min(len(must_hits) - 3, 3)  # max +0.045

    # High GitHub activity is a real signal of current AI practice
    github = signals.get("github_activity_score", -1)
    if github > 80:
        bonus += 0.020
    elif github > 60:
        bonus += 0.010

    # Strong recruiter response rate (absolute top tier)
    rrr = signals.get("recruiter_response_rate") or 0
    if rrr > 0.85:
        bonus += 0.010

    # Very short notice (immediately available)
    notice = signals.get("notice_period_days") or 60
    if notice == 0 or notice <= 7:
        bonus += 0.015

    # Platform assessment score quality
    assessments = signals.get("skill_assessment_scores") or {}
    if assessments:
        avg_score = sum(assessments.values()) / len(assessments)
        if avg_score > 70:
            bonus += 0.012
        elif avg_score > 55:
            bonus += 0.006

    # Saved by many recruiters → market validation
    saved = signals.get("saved_by_recruiters_30d") or 0
    if saved > 15:
        bonus += 0.008

    return min(bonus, 0.10)


# ---------------------------------------------------------------------------
# Composite scorer
# ---------------------------------------------------------------------------

def score_candidate(c: dict) -> tuple[float, str, dict]:
    """
    Returns (score 0.0–1.0, reasoning string, component dict).
    Returns score = -1.0 to signal disqualification.
    """
    if is_honeypot(c):
        return -1.0, "honeypot", {}

    profile = c.get("profile", {})
    career  = c.get("career_history", [])
    skills  = c.get("skills", [])
    signals = c.get("redrob_signals", {})

    role_score = score_role(profile)
    if role_score < 0.04:
        return -1.0, "wrong_role", {}

    skill_score, ai_count, must_hits = score_skills(skills, signals)

    # Candidates with no AI skills at all → heavy suppress even with correct title
    if skill_score < 0.06:
        return max(0.0, role_score * 0.10), "no_ai_skills", {}

    exp_score = score_experience(profile, career)
    loc_score = score_location(profile, signals)
    beh_mult  = score_behavioral(signals)

    components = {
        "role": role_score, "skill": skill_score,
        "exp":  exp_score,  "loc":   loc_score, "beh": beh_mult,
    }

    # Base weighted composite (max ≈ 0.92 for ideal candidate before tiebreaker)
    base = (
        0.30 * role_score
        + 0.30 * skill_score
        + 0.22 * exp_score
        + 0.12 * loc_score
        + 0.06 * min(beh_mult, 1.0)
    )

    # Fine-grained bonus for top-tier differentiation
    bonus = _fine_grained_tiebreaker(c, must_hits, ai_count)

    # Behavioral as a pure suppression/pass-through multiplier
    composite = (base + bonus) * beh_mult
    composite = max(0.0, min(composite, 1.0))

    reasoning = _build_reasoning(c, components, ai_count, must_hits)
    return composite, reasoning, components


# ---------------------------------------------------------------------------
# Reasoning generator
# ---------------------------------------------------------------------------

def _build_reasoning(c: dict, comp: dict, ai_count: int, must_hits: list) -> str:
    """
    Specific, honest 1–2 sentence reasoning anchored to actual profile data.
    Stage-4 reviewers check for: no hallucination, specific facts, JD connection,
    honest concerns, rank consistency.
    """
    profile = c.get("profile", {})
    signals = c.get("redrob_signals", {})
    career  = c.get("career_history", [])

    title    = profile.get("current_title", "?")
    yoe      = profile.get("years_of_experience", 0) or 0
    loc      = profile.get("location", "?")
    ctry     = profile.get("country", "")
    loc_str  = f"{loc}, {ctry}" if ctry and ctry.lower() not in norm(loc) else loc
    industry = profile.get("current_industry", "")

    rrr       = signals.get("recruiter_response_rate") or 0
    days_ago  = days_since(signals.get("last_active_date"))
    github    = signals.get("github_activity_score", -1)
    notice    = signals.get("notice_period_days") or 0
    open_work = signals.get("open_to_work_flag", False)

    # Use actual must-have names so there's no hallucination risk
    skill_snippet = ", ".join(must_hits[:3]) if must_hits else "no retrieval/vector skills"

    role_q = "strong" if comp.get("role", 0) >= 0.92 else "adjacent"
    s1 = (f"{role_q.capitalize()} role match ({title}, {yoe:.1f} yrs"
          + (f", {industry}" if industry else "") + f"); "
          + f"retrieval skills: {skill_snippet}; {loc_str}.")

    positives, concerns = [], []

    if open_work and days_ago < 30:
        positives.append(f"active {days_ago}d ago and open to work")
    elif open_work:
        positives.append("open to work")
    if rrr > 0.70:
        positives.append(f"high response rate ({rrr:.0%})")
    if github > 65:
        positives.append(f"strong GitHub ({github:.0f}/100)")
    if 0 < notice <= 15:
        positives.append(f"immediately available (notice {notice}d)")
    elif 0 < notice <= 30:
        positives.append(f"short notice ({notice}d)")

    if days_ago > 120:
        concerns.append(f"inactive for {days_ago}d — availability uncertain")
    if rrr < 0.25 and rrr > 0:
        concerns.append(f"low recruiter response rate ({rrr:.0%})")
    if notice > 90:
        concerns.append(f"long notice period ({notice}d)")

    # Consulting-only concern
    total_m = sum(j.get("duration_months", 0) or 0 for j in career)
    cons_m  = sum(
        j.get("duration_months", 0) or 0 for j in career
        if any(c_ in norm(j.get("company", "")) for c_ in CONSULTING_COMPANIES)
    )
    if total_m > 0 and cons_m / total_m > 0.80:
        concerns.append("consulting-heavy career")

    parts = []
    if positives:
        parts.append("; ".join(positives[:2]).capitalize() + ".")
    if concerns:
        parts.append("Concern: " + "; ".join(concerns[:2]) + ".")

    s2 = " ".join(parts).strip()
    return (s1 + (" " + s2 if s2 else "")).strip()


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python ranker.py <candidates.jsonl[.gz]> [output.csv]")
        sys.exit(1)

    candidates_path = Path(sys.argv[1])
    output_path     = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("submission.csv")

    if not candidates_path.exists():
        print(f"Error: {candidates_path} not found.")
        sys.exit(1)

    print(f"[ranker] Reading {candidates_path} ...")

    heap: list[tuple[float, str, str]] = []
    processed = disqualified = 0

    opener = (
        (lambda: __import__("gzip").open(candidates_path, "rt", encoding="utf-8"))
        if candidates_path.suffix == ".gz"
        else (lambda: open(candidates_path, "r", encoding="utf-8"))
    )

    with opener() as fh:
        for raw in fh:
            raw = raw.strip()
            if not raw:
                continue
            try:
                c = json.loads(raw)
            except json.JSONDecodeError:
                continue

            processed += 1
            cid = c.get("candidate_id", f"UNKNOWN_{processed}")
            score, reasoning, _ = score_candidate(c)

            if score < 0:
                disqualified += 1
                continue

            if len(heap) < TOP_N:
                heapq.heappush(heap, (score, cid, reasoning))
            elif score > heap[0][0]:
                heapq.heapreplace(heap, (score, cid, reasoning))

            if processed % 10_000 == 0:
                print(f"  {processed:>7,} processed | {disqualified:>6,} disqualified | "
                      f"heap min: {heap[0][0]:.4f}")

    print(f"\n[ranker] Finished: {processed:,} candidates, {disqualified:,} disqualified.")

    # Sort by rounded score then cid so displayed ties break correctly per spec
    results = sorted(heap, key=lambda x: (-round(x[0], 4), x[1]))

    with open(output_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["candidate_id", "rank", "score", "reasoning"])
        for rank, (score, cid, reasoning) in enumerate(results, 1):
            writer.writerow([cid, rank, f"{score:.4f}", reasoning])

    print(f"[ranker] Written → {output_path}  ({len(results)} candidates)\n")
    print("Top 10:")
    for i, (score, cid, reasoning) in enumerate(results[:10], 1):
        print(f"  {i:>2}. {cid}  {score:.4f}  {reasoning[:100]}")


if __name__ == "__main__":
    main()