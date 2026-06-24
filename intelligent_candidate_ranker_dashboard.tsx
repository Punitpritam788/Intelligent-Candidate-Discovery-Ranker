import React, { useState, useRef, useCallback } from 'react';
import { 
  UploadCloud, Trophy, Briefcase, MapPin, Star, AlertTriangle, 
  CheckCircle, ChevronDown, ChevronUp, User, Github, Clock, Settings, Play, Download
} from 'lucide-react';

// ============================================================================
// TAXONOMY & CONSTANTS (Ported from Python)
// ============================================================================

const REFERENCE_DATE = new Date('2026-06-23');

const AI_CORE_TITLES = [
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
  "data scientist", "senior data scientist", "lead data scientist",
  "staff data scientist", "principal data scientist",
  "research engineer"
];

const AI_ADJACENT_TITLES = [
  "software engineer", "senior software engineer", "staff software engineer",
  "principal software engineer", "backend engineer", "senior backend engineer",
  "platform engineer", "senior platform engineer",
  "data engineer", "senior data engineer", "lead data engineer",
  "systems engineer", "full stack engineer", "engineer",
  "infrastructure engineer"
];

const DISQUALIFIED_TITLE_FRAGMENTS = [
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
  "product designer", "mobile developer"
];

const SENIOR_FRAGMENTS = ["senior", "staff", "principal", "lead"];
const JUNIOR_FRAGMENTS = ["junior", "associate", "jr"];
const DATA_SCI_FRAGMENTS = ["data scientist"];

const MUST_HAVE_SKILLS = new Set([
  "embeddings", "vector search", "faiss", "pinecone", "weaviate", "qdrant",
  "milvus", "opensearch", "elasticsearch", "sentence transformers",
  "information retrieval", "bm25", "haystack"
]);

const CORE_AI_SKILLS = new Set([
  "deep learning", "nlp", "machine learning", "pytorch", "tensorflow",
  "hugging face transformers", "fine-tuning llms", "lora", "peft",
  "recommendation systems", "feature engineering", "scikit-learn",
  "reinforcement learning", "gans", "cnn", "object detection",
  "image classification", "computer vision", "speech recognition",
  "forecasting", "statistical modeling", "data science", "prompt engineering",
  "langchain", "mlops", "mlflow", "weights & biases", "kubeflow",
  "bentoml", "triton inference server"
]);

const SUPPORTING_SKILLS = new Set([
  "python", "spark", "kafka", "airflow", "docker", "kubernetes",
  "aws", "gcp", "azure", "fastapi", "redis", "postgresql", "mongodb",
  "databricks", "bigquery", "dbt", "snowflake", "apache flink",
  "apache beam", "rest apis", "ci/cd", "terraform", "go", "rust",
  "grpc", "microservices"
]);

const NEGATIVE_SKILLS = new Set([
  "excel", "powerpoint", "photoshop", "illustrator", "css", "html",
  "angular", "react", "vue.js", "next.js", "salesforce crm", "six sigma",
  "sap", "tally", "accounting", "marketing", "seo", "content writing",
  "sales", "figma", "redux", "webpack", "node.js", "javascript",
  "typescript", "spring boot"
]);

const CONSULTING_COMPANIES = [
  "tcs", "tata consultancy services", "infosys", "wipro",
  "accenture", "cognizant", "capgemini", "hcl", "hcl technologies",
  "tech mahindra", "hexaware", "mphasis", "ltimindtree", "mindtree",
  "ibm global services", "kpmg", "deloitte"
];

const AI_NATIVE_INDUSTRIES = [
  "ai/ml", "artificial intelligence", "generative ai", "conversational ai",
  "healthtech ai", "fintech ai", "edtech ai"
];

const PRODUCT_INDUSTRIES = [
  "saas", "software", "fintech", "edtech", "healthtech", "internet",
  "e-commerce", "food delivery", "transportation", "consumer electronics",
  "gaming", "cybersecurity", "cloud", "telecommunications"
];

const INDIA_TIER1 = ["pune", "noida", "delhi", "ncr", "gurgaon", "gurugram", "hyderabad", "mumbai", "bangalore", "bengaluru", "chennai"];
const INDIA_TIER2 = ["ahmedabad", "kolkata", "jaipur", "lucknow", "indore", "chandigarh", "coimbatore", "trivandrum", "kochi", "bhopal"];

// ============================================================================
// SCORING ENGINE (JS Port)
// ============================================================================

const norm = (text) => (text || "").toLowerCase().trim();

const daysSince = (dateStr) => {
  if (!dateStr) return 9999;
  try {
    const d = new Date(dateStr.split("T")[0]);
    if (isNaN(d.getTime())) return 9999;
    const diffTime = Math.abs(REFERENCE_DATE - d);
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  } catch (e) {
    return 9999;
  }
};

const isHoneypot = (c) => {
  const profile = c.profile || {};
  const career = c.career_history || [];
  const education = c.education || [];
  const skills = c.skills || [];
  const signals = c.redrob_signals || {};
  const yoe = profile.years_of_experience || 0;

  const gradYears = education.map(e => e.end_year || e.start_year).filter(y => typeof y === 'number');
  if (gradYears.length > 0) {
    const earliest = Math.min(...gradYears);
    if (yoe > (REFERENCE_DATE.getFullYear() - earliest + 2)) return true;
  }

  const totalMonths = career.reduce((sum, j) => sum + (j.duration_months || 0), 0);
  if (totalMonths > 0 && yoe > 0) {
    if (totalMonths > yoe * 12 * 1.6 && totalMonths > yoe * 12 + 30) return true;
  }

  for (const job of career) {
    const start = job.start_date || "";
    if (start) {
      const yr = parseInt(start.substring(0, 4), 10);
      if (!isNaN(yr) && (yr < 1985 || yr > REFERENCE_DATE.getFullYear())) return true;
    }
  }

  const assessed = Object.keys(signals.skill_assessment_scores || {});
  const profileSkills = new Set(skills.map(s => s.name));
  if (assessed.length > 0 && !assessed.some(a => profileSkills.has(a))) return true;

  const zeroDurationExperts = skills.filter(s => s.proficiency === "expert" && (s.duration_months || 0) === 0);
  if (zeroDurationExperts.length >= 3) return true;

  if (skills.length > 35 && yoe < 3) return true;

  return false;
};

const scoreRole = (profile) => {
  const title = norm(profile.current_title);
  const headline = norm(profile.headline);

  if (DISQUALIFIED_TITLE_FRAGMENTS.some(f => title.includes(f))) return 0.0;

  for (const t of AI_CORE_TITLES) {
    if (t === title || title.includes(t)) {
      let base = 1.0;
      if (JUNIOR_FRAGMENTS.some(f => title.includes(f))) base -= 0.06;
      if (DATA_SCI_FRAGMENTS.some(f => title.includes(f))) base -= 0.03;
      if (SENIOR_FRAGMENTS.some(f => title.includes(f))) base = Math.min(base + 0.02, 1.0);
      return Math.max(base, 0.70);
    }
  }

  for (const t of AI_ADJACENT_TITLES) {
    if (t === title || title.includes(t)) {
      const kws = ["ai", "ml", "nlp", "machine learning", "deep learning", "embedding", "retrieval", "ranking", "search", "llm"];
      if (kws.some(kw => headline.includes(kw))) return 0.68;
      return 0.48;
    }
  }

  const genericKws = ["engineer", "developer", "architect", "scientist", "analyst"];
  if (genericKws.some(kw => title.includes(kw))) {
    if (["ai", "ml", "nlp", "machine learning", "embedding"].some(kw => headline.includes(kw))) return 0.42;
    return 0.22;
  }

  return 0.05;
};

const scoreSkills = (skills, signals) => {
  const profWeight = { "expert": 1.0, "advanced": 0.85, "intermediate": 0.60, "beginner": 0.30 };
  const assessments = signals.skill_assessment_scores || {};

  const skillMap = {};
  for (const s of skills) {
    const n = norm(s.name);
    if (n) skillMap[n] = s;
  }

  const getDepth = (sname) => {
    const s = skillMap[sname] || {};
    let p = profWeight[s.proficiency || "beginner"] || 0.30;
    const en = Math.min((s.endorsements || 0) / 40, 1.0);
    const du = Math.min((s.duration_months || 0) / 30, 1.0);
    
    const original = s.name || "";
    const assessed = assessments[original];
    if (assessed !== undefined) {
      p = 0.55 * p + 0.45 * (assessed / 100);
    }
    return 0.50 * p + 0.30 * en + 0.20 * du;
  };

  const mustHits = [...MUST_HAVE_SKILLS].filter(n => skillMap[n]);
  const coreHits = [...CORE_AI_SKILLS].filter(n => skillMap[n]);

  const mustCoverage = Math.min(mustHits.length / 3, 1.0);
  const mustDepthAvg = mustHits.length ? mustHits.reduce((sum, n) => sum + getDepth(n), 0) / mustHits.length : 0;

  const coreBreadth = Math.min(coreHits.length / 6, 1.0);
  const coreDepth = coreHits.length ? coreHits.reduce((sum, n) => sum + getDepth(n), 0) / coreHits.length : 0;
  const coreScore = 0.65 * coreBreadth + 0.35 * coreDepth;

  const supportHits = [...SUPPORTING_SKILLS].filter(n => skillMap[n]);
  const supportScore = Math.min(supportHits.length / 5, 1.0);

  const assessKeys = Object.keys(assessments);
  const assessBonus = assessKeys.length ? (Object.values(assessments).reduce((a, b) => a + b, 0) / assessKeys.length / 100) : 0;

  const negHits = [...NEGATIVE_SKILLS].filter(n => skillMap[n]);
  const negPenalty = Math.min(negHits.length * 0.04, 0.20);

  const composite = (0.40 * mustCoverage) + (0.25 * mustDepthAvg) + (0.20 * coreScore) + (0.10 * supportScore) + (0.05 * assessBonus) - negPenalty;
  
  return {
    score: Math.max(0.0, Math.min(composite, 1.0)),
    aiCount: mustHits.length + coreHits.length,
    mustHits
  };
};

const scoreExperience = (profile, career) => {
  const yoe = profile.years_of_experience || 0;
  let yoeScore;

  if (yoe >= 6 && yoe <= 8) yoeScore = 1.00;
  else if ((yoe >= 5 && yoe < 6) || (yoe > 8 && yoe <= 9)) yoeScore = 0.93;
  else if ((yoe >= 4 && yoe < 5) || (yoe > 9 && yoe <= 11)) yoeScore = 0.82;
  else if ((yoe >= 3 && yoe < 4) || (yoe > 11 && yoe <= 13)) yoeScore = 0.65;
  else if (yoe < 3) yoeScore = 0.28;
  else yoeScore = 0.52;

  const currentInd = norm(profile.current_industry);
  if (AI_NATIVE_INDUSTRIES.some(ai => currentInd.includes(ai))) yoeScore = Math.min(yoeScore * 1.10, 1.0);
  else if (PRODUCT_INDUSTRIES.some(pi => currentInd.includes(pi))) yoeScore = Math.min(yoeScore * 1.02, 1.0);

  let totalMonths = 0;
  let consultingMonths = 0;
  let aiProductionJobs = 0;

  for (const job of career) {
    const months = job.duration_months || 0;
    totalMonths += months;
    const company = norm(job.company);
    if (CONSULTING_COMPANIES.some(c => company.includes(c))) consultingMonths += months;

    const desc = norm(job.description);
    const title = norm(job.title);
    
    const prodKws = ["deployed", "production", "inference", "real user", "scale", "latency", "serving", "a/b", "ranking", "retrieval", "search"];
    const aiKws = ["ml", "machine learning", "neural", "embedding", "model", "transformer", "llm", "nlp", "vector", "recommendation"];

    const prodHit = prodKws.filter(kw => desc.includes(kw)).length;
    const aiHit = aiKws.filter(kw => desc.includes(kw) || title.includes(kw)).length;

    if (prodHit >= 2 && aiHit >= 2) aiProductionJobs++;
  }

  const consFrac = consultingMonths / Math.max(totalMonths, 1);
  if (consFrac > 0.90) yoeScore *= 0.38;
  else if (consFrac > 0.65) yoeScore *= 0.62;
  else if (consFrac > 0.40) yoeScore *= 0.80;

  if (aiProductionJobs >= 2) yoeScore = Math.min(yoeScore * 1.14, 1.0);
  else if (aiProductionJobs === 1) yoeScore = Math.min(yoeScore * 1.06, 1.0);
  else if (yoe > 5) yoeScore *= 0.88;

  return Math.min(yoeScore, 1.0);
};

const scoreLocation = (profile, signals) => {
  const location = norm(profile.location);
  const country = norm(profile.country);
  const willing = signals.willing_to_relocate || false;

  if (country === "india") {
    if (["pune", "noida"].some(c => location.includes(c))) return 1.00;
    if (INDIA_TIER1.some(c => location.includes(c))) return 0.92;
    if (INDIA_TIER2.some(c => location.includes(c))) return 0.80;
    return 0.72;
  } else if (willing) {
    return 0.58;
  }
  return 0.25;
};

const scoreBehavioral = (signals) => {
  let mult = 1.0;

  if (!signals.open_to_work_flag) mult *= 0.78;

  const inactive = daysSince(signals.last_active_date);
  if (inactive > 180) mult *= 0.42;
  else if (inactive > 90) mult *= 0.68;
  else if (inactive > 45) mult *= 0.86;
  
  const rrr = signals.recruiter_response_rate || 0.5;
  if (rrr < 0.15) mult *= 0.58;
  else if (rrr < 0.35) mult *= 0.80;

  const notice = signals.notice_period_days || 60;
  if (notice <= 15) mult *= 1.0;
  else if (notice <= 30) mult *= 0.97;
  else if (notice <= 60) mult *= 0.90;
  else if (notice <= 90) mult *= 0.82;
  else mult *= 0.72;

  const github = signals.github_activity_score !== undefined ? signals.github_activity_score : -1;
  if (github === -1 || github < 15) mult *= 0.96;

  const icr = signals.interview_completion_rate || 0.7;
  if (icr < 0.40) mult *= 0.84;
  else if (icr < 0.60) mult *= 0.94;

  if (!(signals.verified_email && signals.verified_phone)) mult *= 0.97;

  return Math.max(0.25, Math.min(mult, 1.0));
};

const buildReasoning = (c, comp, mustHits) => {
  const profile = c.profile || {};
  const signals = c.redrob_signals || {};
  const career = c.career_history || [];

  const title = profile.current_title || "?";
  const yoe = profile.years_of_experience || 0;
  const loc = profile.location || "?";
  const ctry = profile.country || "";
  const locStr = (ctry && !norm(loc).includes(ctry.toLowerCase())) ? `${loc}, ${ctry}` : loc;
  const industry = profile.current_industry || "";

  const rrr = signals.recruiter_response_rate || 0;
  const daysAgo = daysSince(signals.last_active_date);
  const github = signals.github_activity_score || -1;
  const notice = signals.notice_period_days || 0;
  const openWork = signals.open_to_work_flag || false;

  const skillSnippet = mustHits.length > 0 ? mustHits.slice(0, 3).join(", ") : "no retrieval/vector skills";
  const roleQ = comp.role >= 0.92 ? "strong" : "adjacent";
  
  let s1 = `${roleQ.charAt(0).toUpperCase() + roleQ.slice(1)} role match (${title}, ${yoe.toFixed(1)} yrs${industry ? `, ${industry}` : ''}); retrieval skills: ${skillSnippet}; ${locStr}.`;

  const positives = [];
  const concerns = [];

  if (openWork && daysAgo < 30) positives.push(`active ${daysAgo}d ago and open to work`);
  else if (openWork) positives.push("open to work");

  if (rrr > 0.70) positives.push(`high response rate (${Math.round(rrr * 100)}%)`);
  if (github > 65) positives.push(`strong GitHub (${Math.round(github)}/100)`);
  if (notice > 0 && notice <= 15) positives.push(`immediately available (notice ${notice}d)`);
  else if (notice > 0 && notice <= 30) positives.push(`short notice (${notice}d)`);

  if (daysAgo > 120) concerns.push(`inactive for ${daysAgo}d — availability uncertain`);
  if (rrr < 0.25 && rrr > 0) concerns.push(`low recruiter response rate (${Math.round(rrr * 100)}%)`);
  if (notice > 90) concerns.push(`long notice period (${notice}d)`);

  const totalM = career.reduce((sum, j) => sum + (j.duration_months || 0), 0);
  const consM = career.reduce((sum, j) => {
    const compName = norm(j.company);
    return CONSULTING_COMPANIES.some(c => compName.includes(c)) ? sum + (j.duration_months || 0) : sum;
  }, 0);

  if (totalM > 0 && consM / totalM > 0.80) concerns.push("consulting-heavy career");

  let parts = [];
  if (positives.length > 0) parts.push(positives.slice(0, 2).join("; ").replace(/^\w/, c => c.toUpperCase()) + ".");
  if (concerns.length > 0) parts.push("Concern: " + concerns.slice(0, 2).join("; ") + ".");

  return [s1, parts.join(" ")].filter(Boolean).join(" ");
};

const processCandidate = (c) => {
  if (isHoneypot(c)) return null;

  const profile = c.profile || {};
  const career = c.career_history || [];
  const skills = c.skills || [];
  const signals = c.redrob_signals || {};

  const roleScore = scoreRole(profile);
  if (roleScore < 0.04) return null;

  const { score: skillScore, aiCount, mustHits } = scoreSkills(skills, signals);
  if (skillScore < 0.06) return null; // Heavy suppress if no AI skills

  const expScore = scoreExperience(profile, career);
  const locScore = scoreLocation(profile, signals);
  const behMult = scoreBehavioral(signals);

  const comp = { role: roleScore, skill: skillScore, exp: expScore, loc: locScore, beh: behMult };

  let base = (0.30 * roleScore) + (0.30 * skillScore) + (0.22 * expScore) + (0.12 * locScore) + (0.06 * Math.min(behMult, 1.0));

  // Fine grained bonus
  let bonus = 0.0;
  if (mustHits.length >= 4) bonus += 0.015 * Math.min(mustHits.length - 3, 3);
  const github = signals.github_activity_score || -1;
  if (github > 80) bonus += 0.020; else if (github > 60) bonus += 0.010;
  if ((signals.recruiter_response_rate || 0) > 0.85) bonus += 0.010;
  const notice = signals.notice_period_days || 60;
  if (notice === 0 || notice <= 7) bonus += 0.015;
  const assessments = signals.skill_assessment_scores || {};
  const assessKeys = Object.keys(assessments);
  if (assessKeys.length > 0) {
    const avgScore = Object.values(assessments).reduce((a, b) => a + b, 0) / assessKeys.length;
    if (avgScore > 70) bonus += 0.012; else if (avgScore > 55) bonus += 0.006;
  }
  if ((signals.saved_by_recruiters_30d || 0) > 15) bonus += 0.008;

  let composite = (base + Math.min(bonus, 0.10)) * behMult;
  composite = Math.max(0.0, Math.min(composite, 1.0));

  const reasoning = buildReasoning(c, comp, mustHits);

  return { 
    id: c.candidate_id, 
    score: composite, 
    reasoning, 
    comp,
    profile,
    signals
  };
};

// ============================================================================
// UI COMPONENTS
// ============================================================================

// A simple MinHeap to keep top 100 efficiently
class TopKHeap {
  constructor(k) {
    this.k = k;
    this.data = [];
  }
  push(item) {
    this.data.push(item);
    this.data.sort((a, b) => b.score - a.score);
    if (this.data.length > this.k) this.data.pop();
  }
  get() { return this.data; }
}

const ProgressBar = ({ label, value, color = "bg-blue-500" }) => (
  <div className="flex items-center text-xs mb-1">
    <span className="w-12 text-gray-400">{label}</span>
    <div className="flex-1 h-1.5 mx-2 bg-gray-800 rounded-full overflow-hidden">
      <div className={`h-full ${color}`} style={{ width: `${value * 100}%` }}></div>
    </div>
    <span className="w-8 text-right font-mono text-gray-300">{(value * 100).toFixed(0)}</span>
  </div>
);

const CandidateRow = ({ candidate, rank }) => {
  const [expanded, setExpanded] = useState(false);
  const { profile, score, reasoning, comp, signals } = candidate;

  return (
    <div className="border border-gray-800 rounded-xl mb-3 bg-gray-900/50 hover:bg-gray-800/50 transition-colors overflow-hidden">
      <div 
        className="p-4 flex items-center cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="w-12 text-center font-bold text-gray-500 text-lg">#{rank}</div>
        
        <div className="flex-1 px-4">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-semibold text-gray-100">{profile.current_title || "Unknown Title"}</h3>
              <p className="text-sm text-gray-400 flex items-center mt-1">
                <Briefcase size={14} className="mr-1" /> {profile.current_industry || "Unknown Industry"}
                <span className="mx-2">•</span>
                <MapPin size={14} className="mr-1" /> {profile.location || "Unknown"}
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-emerald-400 font-mono">
                {(score * 100).toFixed(2)}
              </div>
              <div className="text-xs text-gray-500">Overall Score</div>
            </div>
          </div>
        </div>

        <div className="text-gray-500">
          {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </div>
      </div>

      {expanded && (
        <div className="p-4 pt-0 border-t border-gray-800 bg-gray-900/80">
          <div className="mt-4 bg-blue-900/20 border border-blue-900/50 rounded-lg p-3 text-sm text-blue-200">
            <strong>Reasoning:</strong> {reasoning}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
            <div>
              <h4 className="text-xs uppercase tracking-wider text-gray-500 mb-2 font-semibold">Score Breakdown</h4>
              <ProgressBar label="Role" value={comp.role} color="bg-indigo-500" />
              <ProgressBar label="Skills" value={comp.skill} color="bg-purple-500" />
              <ProgressBar label="Exper." value={comp.exp} color="bg-blue-500" />
              <ProgressBar label="Location" value={comp.loc} color="bg-emerald-500" />
              <ProgressBar label="Behav." value={comp.beh} color="bg-orange-500" />
            </div>
            
            <div>
              <h4 className="text-xs uppercase tracking-wider text-gray-500 mb-2 font-semibold">Key Signals</h4>
              <div className="grid grid-cols-2 gap-2 text-sm text-gray-300">
                <div className="flex items-center"><Star size={14} className="mr-2 text-yellow-500" /> YoE: {profile.years_of_experience || 0} yrs</div>
                <div className="flex items-center"><Clock size={14} className="mr-2 text-blue-400" /> Notice: {signals.notice_period_days || '?'}d</div>
                <div className="flex items-center"><User size={14} className="mr-2 text-purple-400" /> RRR: {Math.round((signals.recruiter_response_rate || 0)*100)}%</div>
                <div className="flex items-center"><Github size={14} className="mr-2 text-gray-400" /> GitHub: {signals.github_activity_score || 'N/A'}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default function App() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [stats, setStats] = useState({ processed: 0, disqualified: 0, total: 0 });
  const [results, setResults] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  
  // Ref to hold state during async chunk processing without triggering re-renders continuously
  const processState = useRef({ 
    heap: new TopKHeap(100), 
    processed: 0, 
    disqualified: 0,
    lines: [],
    currentIndex: 0
  });

  const processChunk = useCallback(() => {
    const CHUNK_SIZE = 2000;
    const state = processState.current;
    
    let end = Math.min(state.currentIndex + CHUNK_SIZE, state.lines.length);
    
    for (let i = state.currentIndex; i < end; i++) {
      const line = state.lines[i].trim();
      if (!line) continue;
      
      try {
        const candidate = JSON.parse(line);
        state.processed++;
        
        const result = processCandidate(candidate);
        if (result) {
          state.heap.push(result);
        } else {
          state.disqualified++;
        }
      } catch (e) {
        // Silently ignore parse errors as per original script
      }
    }
    
    state.currentIndex = end;
    
    // Update UI every chunk
    setStats({
      processed: state.processed,
      disqualified: state.disqualified,
      total: state.lines.length
    });

    if (state.currentIndex < state.lines.length) {
      // Schedule next chunk to keep UI responsive
      requestAnimationFrame(processChunk);
    } else {
      // Done processing - Final tie-breaker sort matching the Python script spec
      const sortedResults = state.heap.get().sort((a, b) => {
        const scoreA = Number(a.score.toFixed(4));
        const scoreB = Number(b.score.toFixed(4));
        if (scoreB !== scoreA) return scoreB - scoreA;
        return a.id.localeCompare(b.id);
      });
      setResults(sortedResults);
      setIsProcessing(false);
    }
  }, []);

  const handleFileProcess = (file) => {
    setIsProcessing(true);
    setResults([]);
    processState.current = { heap: new TopKHeap(100), processed: 0, disqualified: 0, lines: [], currentIndex: 0 };
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      processState.current.lines = text.split('\n');
      setStats({ processed: 0, disqualified: 0, total: processState.current.lines.length });
      
      // Start processing chunks
      requestAnimationFrame(processChunk);
    };
    reader.readAsText(file);
  };

  const generateMockData = () => {
    setIsProcessing(true);
    setResults([]);
    processState.current = { heap: new TopKHeap(100), processed: 0, disqualified: 0, lines: [], currentIndex: 0 };
    
    // Generate 5000 mock lines
    const mockLines = [];
    for(let i=0; i<5000; i++) {
      const isGood = Math.random() > 0.8;
      const c = {
        candidate_id: `MOCK_${i}`,
        profile: {
          current_title: isGood ? "Senior ML Engineer" : "Software Engineer",
          years_of_experience: isGood ? 7 : Math.floor(Math.random() * 15),
          location: isGood ? "Pune" : "London",
          country: isGood ? "India" : "UK",
          current_industry: isGood ? "AI/ML" : "Retail"
        },
        skills: isGood ? [
          {name: "embeddings", proficiency: "expert", duration_months: 24},
          {name: "pytorch", proficiency: "expert", duration_months: 36},
          {name: "python", proficiency: "expert", duration_months: 60}
        ] : [],
        redrob_signals: {
          open_to_work_flag: isGood,
          last_active_date: isGood ? REFERENCE_DATE.toISOString() : new Date(REFERENCE_DATE - 200*86400000).toISOString(),
          recruiter_response_rate: isGood ? 0.9 : 0.1,
          notice_period_days: isGood ? 15 : 60,
          verified_email: true,
          verified_phone: true
        }
      };
      mockLines.push(JSON.stringify(c));
    }
    
    processState.current.lines = mockLines;
    requestAnimationFrame(processChunk);
  };

  const exportToCSV = () => {
    if (!results || results.length === 0) return;

    // Build the CSV following the required format: candidate_id,rank,score,reasoning
    const headers = ["candidate_id", "rank", "score", "reasoning"];
    const rows = results.map((c, index) => {
      const id = c.id;
      const rank = index + 1;
      const score = c.score.toFixed(4); // 4 decimal places as per hackathon spec
      // Escape quotes in reasoning and wrap the whole string in quotes
      const reasoning = `"${c.reasoning.replace(/"/g, '""')}"`;
      return [id, rank, score, reasoning].join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "submission.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Drag and Drop Handlers
  const handleDrag = (e) => { e.preventDefault(); e.stopPropagation(); if (e.type === "dragenter" || e.type === "dragover") setDragActive(true); else setDragActive(false); };
  const handleDrop = (e) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFileProcess(e.dataTransfer.files[0]); };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 font-sans selection:bg-blue-500/30">
      
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Settings className="text-white animate-[spin_4s_linear_infinite]" size={20} />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">Redrob Candidate Ranker</h1>
              <p className="text-xs text-gray-500">Client-Side AI Engineer Evaluation</p>
            </div>
          </div>
          
          {results.length > 0 && !isProcessing && (
            <button 
              onClick={() => setResults([])}
              className="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg transition text-gray-300 font-medium border border-gray-700"
            >
              Analyze New File
            </button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        
        {/* State 1: Upload */}
        {!isProcessing && results.length === 0 && (
          <div className="max-w-2xl mx-auto mt-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div 
              className={`border-2 border-dashed rounded-3xl p-16 text-center transition-all ${dragActive ? 'border-blue-500 bg-blue-500/5 scale-105' : 'border-gray-800 bg-gray-900/30 hover:border-gray-700 hover:bg-gray-900/50'}`}
              onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
            >
              <UploadCloud size={64} className={`mx-auto mb-6 ${dragActive ? 'text-blue-400' : 'text-gray-600'}`} />
              <h2 className="text-2xl font-bold text-white mb-2">Drop candidates.jsonl here</h2>
              <p className="text-gray-500 mb-8 max-w-sm mx-auto">Upload the 100K dataset. The ranking engine runs entirely in your browser using Web Workers logic.</p>
              
              <div className="flex justify-center items-center space-x-4">
                <label className="cursor-pointer bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl font-medium transition shadow-lg shadow-blue-500/20">
                  Select File
                  <input type="file" className="hidden" accept=".jsonl,.json,.txt" onChange={(e) => handleFileProcess(e.target.files[0])} />
                </label>
                <button 
                  onClick={generateMockData}
                  className="flex items-center cursor-pointer bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 px-6 py-3 rounded-xl font-medium transition"
                >
                  <Play size={16} className="mr-2" />
                  Run Mock Data
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-6 mt-12 text-center">
              <div className="bg-gray-900/30 p-6 rounded-2xl border border-gray-800/50">
                <Trophy className="mx-auto mb-3 text-emerald-500" size={24} />
                <h3 className="text-gray-300 font-medium mb-1">O(N log k) Heap</h3>
                <p className="text-xs text-gray-500">Fast streaming algorithm limits memory footprint.</p>
              </div>
              <div className="bg-gray-900/30 p-6 rounded-2xl border border-gray-800/50">
                <AlertTriangle className="mx-auto mb-3 text-orange-500" size={24} />
                <h3 className="text-gray-300 font-medium mb-1">Honeypot Trap</h3>
                <p className="text-xs text-gray-500">Instantly drops fake resumes and keyword stuffers.</p>
              </div>
              <div className="bg-gray-900/30 p-6 rounded-2xl border border-gray-800/50">
                <CheckCircle className="mx-auto mb-3 text-blue-500" size={24} />
                <h3 className="text-gray-300 font-medium mb-1">Behavioral Multiplier</h3>
                <p className="text-xs text-gray-500">Ranks plummet for candidates who ghost recruiters.</p>
              </div>
            </div>
          </div>
        )}

        {/* State 2: Processing */}
        {isProcessing && (
          <div className="max-w-md mx-auto mt-32 text-center animate-in fade-in">
            <div className="relative w-24 h-24 mx-auto mb-8">
              <div className="absolute inset-0 border-4 border-gray-800 rounded-full"></div>
              <div 
                className="absolute inset-0 border-4 border-blue-500 rounded-full border-t-transparent animate-spin"
                style={{ transform: 'rotate(0deg)' }}
              ></div>
              <div className="absolute inset-0 flex items-center justify-center text-xl font-bold text-gray-300">
                {stats.total > 0 ? Math.round((stats.processed / stats.total) * 100) : 0}%
              </div>
            </div>
            
            <h2 className="text-2xl font-bold text-white mb-2">Analyzing Profiles</h2>
            <p className="text-gray-500 mb-6">Running heuristic multi-component scoring engine...</p>
            
            <div className="bg-gray-900 rounded-xl p-4 text-left border border-gray-800">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-400">Processed</span>
                <span className="text-gray-200 font-mono">{stats.processed.toLocaleString()} / {stats.total.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Disqualified</span>
                <span className="text-orange-400 font-mono">{stats.disqualified.toLocaleString()}</span>
              </div>
            </div>
          </div>
        )}

        {/* State 3: Results */}
        {!isProcessing && results.length > 0 && (
          <div className="animate-in fade-in duration-500">
            {/* Top Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
              <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-5">
                <div className="text-gray-500 text-sm font-medium mb-1">Total Analyzed</div>
                <div className="text-2xl font-bold text-white">{stats.processed.toLocaleString()}</div>
              </div>
              <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-5">
                <div className="text-gray-500 text-sm font-medium mb-1">Disqualified (Honeypot/Role)</div>
                <div className="text-2xl font-bold text-orange-400">{stats.disqualified.toLocaleString()}</div>
              </div>
              <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-5 md:col-span-2 flex items-center justify-between">
                <div>
                  <div className="text-gray-500 text-sm font-medium mb-1">Top Candidate</div>
                  <div className="text-lg font-bold text-white truncate max-w-xs">{results[0].id}</div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold text-emerald-400 font-mono">{(results[0].score * 100).toFixed(2)}</div>
                </div>
              </div>
            </div>

            <div className="flex items-center mb-6 mt-12 justify-between">
              <div className="flex items-center">
                <Trophy className="text-yellow-500 mr-3" size={24} />
                <h2 className="text-2xl font-bold text-white">Top 100 Candidates Ranked</h2>
              </div>
              
              <button 
                onClick={exportToCSV}
                className="flex items-center bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-xl font-medium transition shadow-lg shadow-blue-500/20 text-sm"
              >
                <Download size={18} className="mr-2" />
                Export CSV
              </button>
            </div>
            
            <div className="bg-gray-950 border border-gray-800 rounded-2xl p-4 shadow-xl">
              <div className="hidden md:flex px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-800/50 mb-3">
                <div className="w-12 text-center">Rank</div>
                <div className="flex-1 px-4">Profile Match</div>
                <div className="w-24 text-right pr-4">Score</div>
                <div className="w-8"></div>
              </div>

              <div className="space-y-1">
                {results.map((candidate, idx) => (
                  <CandidateRow key={candidate.id} candidate={candidate} rank={idx + 1} />
                ))}
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}