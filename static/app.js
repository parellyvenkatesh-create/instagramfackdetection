/* ====================================================================
   InstaGuard AI — Dashboard Logic
   Algorithms: LR · RF · XGBoost · SVM + Stacking Ensemble
   Features: Splash, Theme Toggle, Charts, PDF Export, History
   ==================================================================== */

"use strict";

const $ = (id) => document.getElementById(id);

/* ─── DOM REFS ─── */
const splashScreen    = $("splashScreen");
const form            = $("analyzeForm");
const input           = $("profileUrl");
const analyzeBtn      = $("analyzeBtn");
const message         = $("message");
const scanWrap        = $("scanWrap");
const dashboard       = $("resultDashboard");
const themeToggle     = $("themeToggle");
const historyBtn      = $("historyBtn");
const historyModal    = $("historyModal");
const historyClose    = $("historyClose");
const historyList     = $("historyList");
const historyClear    = $("historyClear");
const downloadPdfBtn  = $("downloadPdfBtn");
const logoutBtn       = $("logoutBtn");
const toastContainer  = $("toastContainer");
const particleCanvas  = $("particleCanvas");

/* Result card */
const resultCard     = $("resultCard");
const resultGlow     = $("resultGlow");
const profileAvatar  = $("profileAvatar");
const usernameText   = $("usernameText");
const resultSubtitle = $("resultSubtitle");
const verdictIcon    = $("verdictIcon");
const verdictLabel   = $("verdictLabel");
const verdictConf    = $("verdictConf");

/* Stats */
const followersText  = $("followersText");
const followingText  = $("followingText");
const postsText      = $("postsText");
const pillPrivateVal = $("pillPrivateVal");
const pillPicVal     = $("pillPicVal");
const pillRatioVal   = $("pillRatioVal");
const confidenceText = $("confidenceText");
const confidenceBar  = $("confidenceBar");
const confidenceLabel= $("confidenceLabel");
const gaugePercent   = $("gaugePercent");
const insightsGrid   = $("insightsGrid");
const reasonTags     = $("reasonTags");

/* Canvases */
const gaugeCanvas        = $("gaugeChart");
const barCanvas          = $("followBarChart");
const lineCanvas         = $("activityChart");
const donutCanvas        = $("donutChart");
const algoAccuracyCanvas = $("algoAccuracyChart");
const datasetDonutCanvas = $("datasetDonut");

/* ─── STATE ─── */
let gaugeChartInstance    = null;
let barChartInstance      = null;
let lineChartInstance     = null;
let donutChartInstance    = null;
let algoChartInstance     = null;
let datasetChartInstance  = null;
const HISTORY_KEY = "ig_fake_detector_history_v2";
const THEME_KEY   = "ig_guard_theme";

let lastResultData = null;

/* ====================================================================
   SPLASH SCREEN
   ==================================================================== */
(function initSplash() {
  /* Hide splash after 2.4s */
  setTimeout(() => {
    splashScreen?.classList.add("fade-out");
    setTimeout(() => { if (splashScreen) splashScreen.style.display = "none"; }, 650);
  }, 2400);
})();

/* ====================================================================
   THEME TOGGLE
   ==================================================================== */
(function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || "dark";
  applyTheme(saved);
})();

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
  const moonIcon   = themeToggle?.querySelector(".icon-moon");
  const sunIcon    = themeToggle?.querySelector(".icon-sun");
  const themeLabel = themeToggle?.querySelector(".theme-label");
  if (theme === "light") {
    moonIcon?.classList.add("hidden");
    sunIcon?.classList.remove("hidden");
    if (themeLabel) themeLabel.textContent = "Dark";
  } else {
    moonIcon?.classList.remove("hidden");
    sunIcon?.classList.add("hidden");
    if (themeLabel) themeLabel.textContent = "Light";
  }
}

themeToggle?.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  applyTheme(current === "dark" ? "light" : "dark");
});

/* ====================================================================
   UTILS
   ==================================================================== */
function nfmt(n) {
  n = Number(n);
  if (!Number.isFinite(n)) return "—";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return new Intl.NumberFormat().format(n);
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function animateNumber(el, from, to, dur, dec = 0) {
  const t0 = performance.now();
  const diff = to - from;
  function step(now) {
    const p = Math.min((now - t0) / dur, 1);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = (from + diff * e).toFixed(dec);
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = (to % 1 === 0 && dec === 0) ? to : to.toFixed(dec);
  }
  requestAnimationFrame(step);
}

/* ====================================================================
   ALERTS & LOADING
   ==================================================================== */
const chartFont = { family: "'Poppins', sans-serif" };

/* ─── TOAST SYSTEM ─── */
function showToast(message, type = "info", duration = 3500) {
  if (!toastContainer) return;
  const icons = { success: "✅", danger: "❌", error: "❌", info: "💡" };
  const toast = document.createElement("div");
  toast.className = `toast toast--${type === 'danger' ? 'error' : type}`;
  toast.innerHTML = `<span class="toast__icon">${icons[type] || "ℹ️"}</span><span>${message}</span>`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("toast--exit");
    setTimeout(() => toast.remove(), 310);
  }, duration);
}

function showAlert(text, kind) {
  showToast(text, kind);
}

function hideAlert() {
  // Toast-based alerts don't need a central hide method usually, 
  // but we'll keep the function for compatibility.
}
function setLoading(on) {
  analyzeBtn.disabled = on;
  analyzeBtn.querySelector(".btn-label").classList.toggle("hidden", on);
  analyzeBtn.querySelector(".btn-loading").classList.toggle("hidden", !on);
  scanWrap?.classList.toggle("scanning", on);
}

/* ====================================================================
   CHART SHARED CONFIG
   ==================================================================== */
const tooltipStyle = {
  backgroundColor: "rgba(8,12,26,.96)",
  borderColor: "rgba(100,120,180,.14)",
  borderWidth: 1,
  cornerRadius: 10,
  titleFont: { ...chartFont, weight: "700" },
  bodyFont: chartFont,
  padding: 10,
};

/* ====================================================================
   1. ALGORITHM ACCURACY CHART (loaded on start from /api/metrics)
   ==================================================================== */
async function loadAndRenderAlgoChart() {
  let metrics;
  try {
    const res = await fetch("/api/metrics");
    const json = await res.json();
    metrics = json.metrics || {};
  } catch (_) {
    metrics = { algorithms: { "Logistic Regression": 84, "Random Forest": 91, "XGBoost": 93, "SVM": 88 }, ensemble: 95 };
  }

    // Map display names to HTML accuracy IDs
    const idMap = {
      "Logistic Regression": "mcAccLR",
      "Random Forest": "mcAccRF",
      "XGBoost": "mcAccXGB",
      "SVM": "mcAccSVM"
    };

    const algos = metrics.algorithms || {};
    const names = [...Object.keys(algos), "Stacking Ensemble"];
    const values = [...Object.values(algos), metrics.ensemble || 0];

    // Update HTML cards Accuracy text if they exist
    Object.entries(algos).forEach(([name, acc]) => {
      const el = $(idMap[name]);
      if (el) el.textContent = acc.toFixed(2) + "%";
    });
    const ensEl = $("mcAccVote");
    if (ensEl) ensEl.textContent = (metrics.ensemble || 0).toFixed(2) + "%";

    const colors = [
      "rgba(16,185,129,.75)",   // RF — green
      "rgba(245,158,11,.75)",   // XGB — amber
      "rgba(236,72,153,.75)",   // SVM — pink
      "rgba(139,92,246,.85)",   // Ensemble — purple (highlighted)
    ];
  const borders = colors.map(c => c.replace(",.75", ",1").replace(",.85", ",1"));

  if (algoChartInstance) algoChartInstance.destroy();
  if (algoAccuracyCanvas) {
    algoChartInstance = new Chart(algoAccuracyCanvas, {
    type: "bar",
    data: {
      labels: names,
      datasets: [{
        label: "Accuracy %",
        data: values,
        backgroundColor: colors,
        borderColor: borders,
        borderWidth: 1.5,
        borderRadius: 8,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 1200, easing: "easeOutQuart" },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipStyle,
          callbacks: {
            label: ctx => ` Accuracy: ${ctx.raw.toFixed(1)}%`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "rgba(175,190,220,.55)", font: { ...chartFont, size: 11 } },
          border: { display: false },
        },
        y: {
          min: 0, max: 100,
          grid: { color: "rgba(100,120,180,.05)" },
          ticks: {
            color: "rgba(175,190,220,.4)", font: { ...chartFont, size: 10 },
            callback: v => v + "%",
          },
          border: { display: false },
        },
      },
    },
  });

  /* Dataset distribution donut (static representative data) */
  renderDatasetDonut();
  }

  /* Dataset Donut Chart */
  if (datasetDonutCanvas) {
    renderDatasetDonut();
  }
}

/* ====================================================================
   2. DATASET DISTRIBUTION DONUT
   ==================================================================== */
function renderDatasetDonut() {
  if (!datasetDonutCanvas) return;
  if (datasetChartInstance) datasetChartInstance.destroy();
  datasetChartInstance = new Chart(datasetDonutCanvas, {
    type: "doughnut",
    data: {
      labels: ["Real Profiles", "Fake Profiles"],
      datasets: [{
        data: [52, 48],
        backgroundColor: ["rgba(16,185,129,.7)", "rgba(239,68,68,.7)"],
        borderColor: ["rgba(16,185,129,.9)", "rgba(239,68,68,.9)"],
        borderWidth: 1.5, hoverOffset: 10,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "62%",
      animation: { duration: 1200, easing: "easeOutQuart", animateRotate: true },
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "rgba(175,190,220,.55)", font: { ...chartFont, size: 12 }, boxWidth: 12, boxHeight: 12, borderRadius: 4, padding: 14 },
        },
        tooltip: { ...tooltipStyle, callbacks: { label: c => ` ${c.label}: ${c.raw}%` } },
      },
    },
  });
}

/* ====================================================================
   3. SEMI-CIRCLE GAUGE
   ==================================================================== */
function drawGauge(riskPct) {
  if (gaugeChartInstance) { gaugeChartInstance.destroy(); gaugeChartInstance = null; }
  const ctx = gaugeCanvas.getContext("2d");
  const W = gaugeCanvas.width, H = gaugeCanvas.height;
  const cx = W / 2, cy = H - 10;
  const r = Math.min(cx, cy) - 18;
  const SA = Math.PI, EA = 2 * Math.PI;

  const zones = [
    { from: 0, to: .33, color: "rgba(16,185,129,.18)" },
    { from: .33, to: .66, color: "rgba(245,158,11,.18)" },
    { from: .66, to: 1,  color: "rgba(239,68,68,.18)" },
  ];
  const pct = clamp(riskPct, 0, 100) / 100;
  const fillColor = pct < .33 ? "#10b981" : pct < .66 ? "#f59e0b" : "#ef4444";

  let cur = 0;
  const dur = 1500, t0 = performance.now();

  function frame(now) {
    const t = Math.min((now - t0) / dur, 1);
    cur = pct * (1 - Math.pow(1 - t, 4));
    ctx.clearRect(0, 0, W, H);

    zones.forEach(z => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, SA + z.from * Math.PI, SA + z.to * Math.PI);
      ctx.lineWidth = 22; ctx.strokeStyle = z.color; ctx.lineCap = "butt"; ctx.stroke();
    });

    if (cur > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, SA, SA + cur * Math.PI);
      ctx.lineWidth = 22; ctx.strokeStyle = fillColor; ctx.lineCap = "round"; ctx.stroke();
      ctx.save();
      ctx.shadowColor = fillColor; ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(cx, cy, r, SA, SA + cur * Math.PI);
      ctx.lineWidth = 4; ctx.strokeStyle = fillColor; ctx.stroke();
      ctx.restore();
    }

    /* Zone labels */
    ctx.save();
    ctx.font = "600 9px 'Outfit', sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    [{ mid: .165, label: "Safe", col: "rgba(16,185,129,.6)" },
     { mid: .5,   label: "Sus",  col: "rgba(245,158,11,.6)" },
     { mid: .83,  label: "Fake", col: "rgba(239,68,68,.6)" }].forEach(z => {
      const a = SA + z.mid * Math.PI;
      const lr = r + 18;
      ctx.fillStyle = z.col;
      ctx.fillText(z.label, cx + lr * Math.cos(a), cy + lr * Math.sin(a));
    });
    ctx.restore();

    const ta = SA + cur * Math.PI;
    const tx = cx + r * Math.cos(ta), ty = cy + r * Math.sin(ta);
    ctx.beginPath(); ctx.arc(tx, ty, 5, 0, 2 * Math.PI); ctx.fillStyle = "#fff"; ctx.fill();
    ctx.beginPath(); ctx.arc(tx, ty, 2.5, 0, 2 * Math.PI); ctx.fillStyle = fillColor; ctx.fill();

    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  animateNumber(gaugePercent, 0, riskPct, 1500, 1);
}

/* ====================================================================
   4. FOLLOWER VS FOLLOWING BAR
   ==================================================================== */
function renderFollowChart(followers, following) {
  if (barChartInstance) barChartInstance.destroy();
  const normalFollowing = Math.round(followers / 1.5) || 1;

  barChartInstance = new Chart(barCanvas, {
    type: "bar",
    data: {
      labels: ["Followers", "Following"],
      datasets: [
        {
          label: "This Profile",
          data: [followers, following],
          backgroundColor: ["rgba(168,85,247,.65)", "rgba(59,130,246,.65)"],
          borderColor: ["rgba(168,85,247,.9)", "rgba(59,130,246,.9)"],
          borderWidth: 1.5, borderRadius: 7, barThickness: 28,
        },
        {
          label: "Normal Range",
          data: [followers, normalFollowing],
          backgroundColor: ["rgba(168,85,247,.1)", "rgba(59,130,246,.1)"],
          borderColor: ["rgba(168,85,247,.2)", "rgba(59,130,246,.2)"],
          borderWidth: 1, borderRadius: 7, barThickness: 28,
        },
      ],
    },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      animation: { duration: 1100, easing: "easeOutQuart" },
      plugins: {
        legend: { position: "bottom", labels: { color: "rgba(175,190,220,.5)", font: { ...chartFont, size: 11 }, boxWidth: 11, boxHeight: 11, borderRadius: 3 } },
        tooltip: tooltipStyle,
      },
      scales: {
        x: {
          grid: { color: "rgba(100,120,180,.04)" },
          ticks: { color: "rgba(175,190,220,.35)", font: { ...chartFont, size: 10 },
            callback: v => v >= 1e6 ? (v/1e6).toFixed(1)+"M" : v >= 1e3 ? (v/1e3).toFixed(0)+"K" : v },
          border: { display: false },
        },
        y: {
          grid: { display: false },
          ticks: { color: "rgba(175,190,220,.65)", font: { ...chartFont, size: 11, weight: "600" } },
          border: { display: false },
        },
      },
    },
  });

  const ratio = following > 0 ? (followers / following).toFixed(2) : "∞";
  const insEl = $("followInsightText");
  const dotEl = $("followInsight")?.querySelector(".chart-note__dot");
  if (following > followers * 5) {
    insEl.textContent = `Abnormal ratio (${ratio}×) — following far exceeds followers.`;
    if (dotEl) dotEl.style.background = "#ef4444";
  } else if (following > followers * 2) {
    insEl.textContent = `Elevated ratio (${ratio}×) — following is notably higher.`;
    if (dotEl) dotEl.style.background = "#f59e0b";
  } else {
    insEl.textContent = `Healthy ratio (${ratio}×) — balance appears normal.`;
    if (dotEl) dotEl.style.background = "#10b981";
  }
}

/* ====================================================================
   5. ACTIVITY LINE CHART
   ==================================================================== */
function renderActivityChart(posts) {
  if (lineChartInstance) lineChartInstance.destroy();
  const actIns = $("activityInsightText");
  const dotEl  = $("activityInsight")?.querySelector(".chart-note__dot");

  if (posts === 0) {
    lineChartInstance = new Chart(lineCanvas, {
      type: "line",
      data: {
        labels: ["Wk 1","Wk 2","Wk 3","Wk 4","Wk 5","Wk 6"],
        datasets: [{ label: "Posts", data: [0,0,0,0,0,0],
          borderColor: "rgba(239,68,68,.5)", backgroundColor: "rgba(239,68,68,.05)",
          fill: true, tension: .3, pointRadius: 3, pointBackgroundColor: "rgba(239,68,68,.7)" }],
      },
      options: lineOpts(),
    });
    actIns.textContent = "⚠ Zero posts — no publishing activity detected.";
    if (dotEl) dotEl.style.background = "#ef4444";
    return;
  }

  const weeks = 6, avg = posts / weeks;
  const sim = []; let rem = posts;
  for (let i = 0; i < weeks; i++) {
    if (i === weeks - 1) { sim.push(Math.max(0, rem)); }
    else {
      const v = Math.max(0, Math.round(avg + (Math.random() - .5) * avg * .8));
      sim.push(v); rem -= v;
    }
  }

  const grad = lineCanvas.getContext("2d").createLinearGradient(0, 0, 0, 200);
  grad.addColorStop(0, "rgba(6,182,212,.14)"); grad.addColorStop(1, "rgba(6,182,212,0)");

  lineChartInstance = new Chart(lineCanvas, {
    type: "line",
    data: {
      labels: ["Wk 1","Wk 2","Wk 3","Wk 4","Wk 5","Wk 6"],
      datasets: [{ label: "Estimated Posts", data: sim,
        borderColor: "rgba(6,182,212,.8)", backgroundColor: grad,
        fill: true, tension: .4, pointRadius: 4, pointBackgroundColor: "#06b6d4",
        pointBorderColor: "rgba(6,182,212,.25)", pointBorderWidth: 2, borderWidth: 2.5 }],
    },
    options: lineOpts(),
  });

  if (posts < 5) {
    actIns.textContent = `Very low activity (${posts} posts) — suspicious pattern.`;
    if (dotEl) dotEl.style.background = "#f59e0b";
  } else {
    actIns.textContent = `${posts} posts detected — posting activity looks reasonable.`;
    if (dotEl) dotEl.style.background = "#10b981";
  }
}

function lineOpts() {
  return {
    responsive: true, maintainAspectRatio: false,
    animation: { duration: 1100, easing: "easeOutQuart" },
    plugins: { legend: { display: false }, tooltip: tooltipStyle },
    scales: {
      x: { grid: { color: "rgba(100,120,180,.04)" }, ticks: { color: "rgba(175,190,220,.38)", font: { ...chartFont, size: 10 } }, border: { display: false } },
      y: { grid: { color: "rgba(100,120,180,.04)" }, ticks: { color: "rgba(175,190,220,.38)", font: { ...chartFont, size: 10 } }, border: { display: false }, beginAtZero: true },
    },
  };
}

/* ====================================================================
   6. AUTHENTICITY DONUT
   ==================================================================== */
function renderDonutChart(f) {
  if (donutChartInstance) donutChartInstance.destroy();

  const sc = [
    clamp(Math.log10(Math.max(1, f.userFollowerCount)) / 5 * 100, 0, 100),
    clamp(100 - Math.min(100, (f.userFollowingCount / Math.max(1, f.userFollowerCount)) * 20), 0, 100),
    clamp(Math.min(100, f.userMediaCount * 5), 0, 100),
    clamp(Math.min(100, f.userBiographyLength * 4), 0, 100),
    clamp(100 - f.usernameDigitCount * 20, 0, 100),
  ];

  donutChartInstance = new Chart(donutCanvas, {
    type: "doughnut",
    data: {
      labels: ["Followers","Following","Posts","Bio","Username"],
      datasets: [{
        data: sc.map(Math.round),
        backgroundColor: ["rgba(168,85,247,.65)","rgba(59,130,246,.65)","rgba(6,182,212,.65)","rgba(16,185,129,.65)","rgba(245,158,11,.65)"],
        borderColor:     ["rgba(168,85,247,.9)","rgba(59,130,246,.9)","rgba(6,182,212,.9)","rgba(16,185,129,.9)","rgba(245,158,11,.9)"],
        borderWidth: 1.5, hoverOffset: 8,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "65%",
      animation: { duration: 1100, easing: "easeOutQuart", animateRotate: true },
      plugins: {
        legend: { position: "bottom", labels: { color: "rgba(175,190,220,.5)", font: { ...chartFont, size: 11, weight: "500" }, boxWidth: 10, boxHeight: 10, borderRadius: 3, padding: 12 } },
        tooltip: { ...tooltipStyle, callbacks: { label: c => ` ${c.label}: ${c.raw}/100 authenticity` } },
      },
    },
  });
}

/* ====================================================================
   AI INSIGHTS
   ==================================================================== */
function buildInsights(f, pred) {
  const ins = [];
  if (f.userMediaCount === 0)
    ins.push({ severity:"red",    icon:"📭", title:"No Posts Detected",       desc:"Zero posts — a strong fake indicator.",                      confidence:95 });
  else if (f.userMediaCount < 5)
    ins.push({ severity:"yellow", icon:"📉", title:"Very Low Post Count",      desc:`Only ${f.userMediaCount} post(s). Typical of newer or automated accounts.`, confidence:65 });
  else
    ins.push({ severity:"green",  icon:"📸", title:"Active Content Creator",   desc:`${f.userMediaCount} posts — indicates regular activity.`,   confidence:85 });

  const ratio = f.follower_following_ratio;
  if (Number.isFinite(ratio)) {
    if (ratio < .1)
      ins.push({ severity:"red",    icon:"⚖️", title:"Follower Ratio Abnormal", desc:`Ratio ${ratio.toFixed(2)} is extremely low — bot-like.`,  confidence:90 });
    else if (ratio < .5)
      ins.push({ severity:"yellow", icon:"⚖️", title:"Follower Imbalance",      desc:`Ratio ${ratio.toFixed(2)} is below normal range.`,         confidence:60 });
    else
      ins.push({ severity:"green",  icon:"✅", title:"Balanced Ratio",          desc:`Ratio ${ratio.toFixed(2)} is within a healthy range.`,     confidence:80 });
  }

  if (f.usernameDigitCount >= 4)
    ins.push({ severity:"red",    icon:"🔢", title:"Many Digits in Username",  desc:`${f.usernameDigitCount} digits found — bot-like pattern.`,  confidence:80 });
  else if (f.usernameDigitCount >= 2)
    ins.push({ severity:"yellow", icon:"🔤", title:"Username Has Digits",       desc:`${f.usernameDigitCount} digit(s) in username.`,            confidence:50 });

  if (f.usernameLength >= 15)
    ins.push({ severity:"yellow", icon:"📏", title:"Long Username",             desc:`${f.usernameLength} chars — may be auto-generated.`,       confidence:60 });

  if (f.userBiographyLength <= 3)
    ins.push({ severity:"red",    icon:"📝", title:"Empty Bio",                 desc:"Bio is essentially empty — low authenticity signal.",      confidence:88 });
  else if (f.userBiographyLength < 15)
    ins.push({ severity:"yellow", icon:"📝", title:"Short Bio",                 desc:`Only ${f.userBiographyLength} characters — below average.`, confidence:55 });
  else
    ins.push({ severity:"green",  icon:"📝", title:"Bio Present",               desc:`${f.userBiographyLength} char bio — authentic signal.`,   confidence:80 });

  if (f.userHasProfilPic === 0)
    ins.push({ severity:"red",    icon:"🖼️", title:"No Profile Picture",       desc:"Default avatar — very common among fake accounts.",        confidence:90 });
  else
    ins.push({ severity:"green",  icon:"🖼️", title:"Has Profile Picture",      desc:"Custom picture is set — authentic signal.",                confidence:80 });

  if (f.userIsPrivate === 1 && f.userFollowerCount < 80)
    ins.push({ severity:"yellow", icon:"🔒", title:"Private + Low Followers",   desc:"Private account with very few followers.",                 confidence:70 });

  if (f.media_per_follower > .6)
    ins.push({ severity:"yellow", icon:"📊", title:"Unusual Media/Follower",    desc:`${f.media_per_follower.toFixed(2)} media per follower.`,  confidence:65 });

  return ins;
}

function renderInsights(f, pred) {
  const insights = buildInsights(f, pred);
  insightsGrid.innerHTML = "";

  const heading = $("insightsHeading");
  if (heading) {
    const isFake = pred.label.toLowerCase() === "fake";
    heading.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z"/><line x1="9" y1="21" x2="15" y2="21"/><line x1="10" y1="23" x2="14" y2="23"/></svg>
      Why this profile is classified as <span style="margin-left:4px;color:${isFake?"#ef4444":"#10b981"};font-weight:900">${isFake?"FAKE ⚠":"REAL ✓"}</span>`;
  }

  if (!insights.length) {
    insightsGrid.innerHTML = '<div class="no-reasons">No notable findings.</div>';
    return;
  }

  const groups = {
    red:    { title: "🚨 High Risk Signals",    data: [] },
    yellow: { title: "⚠ Suspicious Patterns",  data: [] },
    green:  { title: "✅ Positive Signals",     data: [] },
  };
  insights.forEach(i => { if (groups[i.severity]) groups[i.severity].data.push(i); });

  let dc = 1;
  Object.keys(groups).forEach(key => {
    const g = groups[key];
    if (!g.data.length) return;
    const sec = document.createElement("div");
    sec.className = "insight-group";

    const t = document.createElement("h4");
    t.className = `insight-group-title insight-group-title--${key}`;
    t.textContent = g.title;
    sec.appendChild(t);

    const list = document.createElement("div");
    list.className = "insight-list";
    g.data.slice(0, 4).forEach(ins => {
      const el = document.createElement("div");
      el.className = `insight-item insight-item--${ins.severity}`;
      el.style.animationDelay = `${dc * .1}s`;
      dc++;
      el.innerHTML = `
        <div class="insight-icon">${ins.icon}</div>
        <div class="insight-content">
          <div class="insight-header">
            <span class="insight-title">${ins.title}</span>
            <span class="insight-confidence insight-confidence--${ins.severity}">${ins.confidence}%</span>
          </div>
          <p class="insight-desc">${ins.desc}</p>
        </div>`;
      list.appendChild(el);
    });
    sec.appendChild(list);
    insightsGrid.appendChild(sec);
  });
}

/* ====================================================================
   REASON TAGS
   ==================================================================== */
function renderReasons(reasons) {
  reasonTags.innerHTML = "";
  if (!reasons || typeof reasons !== "object") {
    reasonTags.innerHTML = '<span class="no-reasons">No additional signals provided.</span>';
    return;
  }
  const entries = Object.entries(reasons).filter(([k]) => k !== "model");
  if (!entries.length) {
    const tag = document.createElement("span");
    tag.className = "reason-tag reason-tag--green";
    tag.innerHTML = "✓ " + (reasons.model || "ML Ensemble Prediction");
    reasonTags.appendChild(tag);
    return;
  }
  entries.forEach(([, text]) => {
    const tag = document.createElement("span");
    const lo = String(text).toLowerCase();
    let cls = "reason-tag--blue";
    if (lo.includes("very") || lo.includes("no ") || lo.includes("empty")) cls = "reason-tag--red";
    else if (lo.includes("low") || lo.includes("unusual") || lo.includes("high")) cls = "reason-tag--yellow";
    tag.className = `reason-tag ${cls}`;
    tag.innerHTML = `⚑ ${text}`;
    reasonTags.appendChild(tag);
  });
}

/* ====================================================================
   RENDER FULL RESULT
   ==================================================================== */
function renderResult(data) {
  const pred = data.prediction || {};
  const f    = data.features   || {};
  const prof = data.profile    || {};

  const isFake = String(pred.label || "").toLowerCase() === "fake";

  /* ── Result card ── */
  usernameText.textContent  = `@${data.username || "unknown"}`;
  resultSubtitle.textContent = "Instagram Profile Analysis Complete";

  resultCard.classList.remove("is-fake", "is-real");
  resultCard.classList.add(isFake ? "is-fake" : "is-real");

  verdictIcon.className = "verdict-icon " + (isFake ? "icon-fake" : "icon-real");
  verdictIcon.textContent = isFake ? "⚠" : "✓";
  verdictLabel.textContent = isFake ? "FAKE" : "REAL";
  verdictLabel.className = "verdict-label " + (isFake ? "is-fake" : "is-real");
  verdictConf.textContent = `${Number(pred.confidence_percent ?? 0).toFixed(1)}% confidence`;

  /* ── Stats ── */
  const fol = Number(prof.followers ?? f.userFollowerCount ?? 0);
  const fow = Number(prof.following ?? f.userFollowingCount ?? 0);
  const ps  = Number(prof.media_count ?? f.userMediaCount ?? 0);

  followersText.textContent = nfmt(fol);
  followingText.textContent = nfmt(fow);
  postsText.textContent     = nfmt(ps);

  pillPrivateVal.textContent = prof.is_private ? "Yes" : "No";
  pillPicVal.textContent     = prof.has_profile_pic ? "Yes" : "No";
  pillRatioVal.textContent   = fow > 0 ? (fol / fow).toFixed(2) : "∞";

  /* ── Confidence bar ── */
  const conf = clamp(Number(pred.confidence_percent ?? 0), 0, 100);
  confidenceText.textContent = conf.toFixed(1) + "%";
  confidenceBar.dataset.color = isFake ? "red" : "green";
  setTimeout(() => { confidenceBar.style.width = conf + "%"; }, 50);
  const bucket = conf >= 90 ? "Very High" : conf >= 70 ? "High" : conf >= 50 ? "Medium" : "Low";
  confidenceLabel.textContent = `${bucket} confidence — ${isFake ? "Fake" : "Real"} prediction`;

  /* ── Charts ── */
  const risk = isFake ? conf : 100 - conf;
  drawGauge(risk);
  renderFollowChart(fol, fow);
  renderActivityChart(ps);
  renderDonutChart(f);
  renderInsights(f, pred);
  renderReasons(pred.reasons);

  /* Show dashboard */
  dashboard.classList.remove("hidden");
  dashboard.querySelectorAll(".anim-slide").forEach(el => {
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
  });

  /* Save for PDF */
  lastResultData = data;

  /* Scroll to top of results */
  setTimeout(() => {
    document.querySelector(".result-hero")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 100);
}

/* ====================================================================
   PDF EXPORT
   ==================================================================== */
downloadPdfBtn?.addEventListener("click", async () => {
  if (!lastResultData) return;

  const pred = lastResultData.prediction || {};
  const prof = lastResultData.profile || {};
  const f    = lastResultData.features || {};
  const isFake = pred.label?.toLowerCase() === "fake";
  const username = lastResultData.username || "unknown";
  const now = new Date().toLocaleString();

  const html = `
    <div style="font-family:'Outfit',Arial,sans-serif;padding:36px;background:#05070e;color:#eef1f8;min-height:100vh">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:28px;border-bottom:1px solid rgba(100,120,180,.15);padding-bottom:20px">
        <div style="width:48px;height:48px;background:linear-gradient(135deg,#a855f7,#3b82f6);border-radius:12px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px">IG</div>
        <div>
          <h1 style="font-size:24px;font-weight:900;margin:0;letter-spacing:-1px">InstaGuard AI Report</h1>
          <p style="margin:2px 0 0;font-size:13px;color:rgba(175,190,220,.55)">${now}</p>
        </div>
      </div>

      <!-- Verdict -->
      <div style="background:${isFake?"rgba(239,68,68,.1)":"rgba(16,185,129,.1)"};border:1.5px solid ${isFake?"rgba(239,68,68,.35)":"rgba(16,185,129,.35)"};border-radius:18px;padding:24px;margin-bottom:24px;display:flex;align-items:center;justify-content:space-between">
        <div>
          <h2 style="font-size:22px;font-weight:900;margin:0">@${username}</h2>
          <p style="margin:4px 0 0;font-size:13px;color:rgba(175,190,220,.5)">Instagram Profile Analysis</p>
        </div>
        <div style="text-align:right">
          <div style="font-size:28px;font-weight:900;color:${isFake?"#ef4444":"#10b981"}">${isFake?"⚠ FAKE":"✓ REAL"}</div>
          <div style="font-size:13px;color:rgba(175,190,220,.55)">${Number(pred.confidence_percent??0).toFixed(1)}% confidence</div>
        </div>
      </div>

      <!-- Stats Grid -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:24px">
        ${[["Followers", prof.followers??0], ["Following", prof.following??0], ["Posts", prof.media_count??0]].map(([l,v]) => `
        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(100,120,180,.1);border-radius:14px;padding:16px">
          <div style="font-size:22px;font-weight:800;margin-bottom:2px">${nfmt(v)}</div>
          <div style="font-size:12px;color:rgba(175,190,220,.5);text-transform:uppercase;letter-spacing:1px">${l}</div>
        </div>`).join("")}
      </div>

      <!-- Features -->
      <div style="background:rgba(255,255,255,.03);border:1px solid rgba(100,120,180,.08);border-radius:14px;padding:18px;margin-bottom:24px">
        <h3 style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:rgba(175,190,220,.5);margin:0 0 14px">Extracted Features</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px">
          ${Object.entries(f).map(([k,v]) => `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(100,120,180,.06)"><span style="color:rgba(175,190,220,.5)">${k}</span><span style="font-weight:700">${typeof v === 'number' ? v.toFixed ? v.toFixed(4) : v : v}</span></div>`).join("")}
        </div>
      </div>

      <!-- Footer -->
      <div style="font-size:11px;color:rgba(175,190,220,.35);text-align:center;margin-top:20px;padding-top:16px;border-top:1px solid rgba(100,120,180,.08)">
        This prediction is based on an Ensemble ML model (LR + RF + XGBoost + SVM) and should be used as guidance, not definitive proof. 
        Generated by InstaGuard AI · ${now}
      </div>
    </div>`;

  const container = $("pdfCapture");
  container.innerHTML = html;
  container.style.cssText = "position:fixed;left:-9999px;top:0;width:900px;pointer-events:none;";

  const opts = {
    margin: 0,
    filename: `InstaGuard_${username}_${Date.now()}.pdf`,
    image: { type: "jpeg", quality: 0.96 },
    html2canvas: { scale: 2, useCORS: true, backgroundColor: "#05070e" },
    jsPDF: { unit: "px", format: [900, 1200], orientation: "portrait" },
  };

  downloadPdfBtn.disabled = true;
  downloadPdfBtn.innerHTML = `<span class="spinner"></span> Generating PDF…`;

  try {
    await html2pdf().set(opts).from(container).save();
  } finally {
    container.innerHTML = "";
    container.style.cssText = "";
    downloadPdfBtn.disabled = false;
    downloadPdfBtn.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg> Download PDF Report`;
  }
});

/* ====================================================================
   HISTORY
   ==================================================================== */
function loadHistory()  { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; } }
function saveHistory(h) { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 5))); }

function addToHistory(entry) {
  const items = loadHistory().filter(x => x.username !== entry.username);
  items.unshift(entry);
  saveHistory(items);
}

function renderHistory() {
  const items = loadHistory();
  historyList.innerHTML = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.innerHTML = `<div><span class="history-user">No history yet</span><div class="history-meta">Analyze a profile to see results here</div></div>`;
    historyList.appendChild(li);
    return;
  }
  items.forEach(it => {
    const li = document.createElement("li");
    const isFake = (it.label || "").toLowerCase() === "fake";
    li.innerHTML = `
      <div>
        <span class="history-user">@${it.username}</span>
        <div class="history-meta" style="color:${isFake?"#fca5a5":"#6ee7b7"}">${it.label} · ${it.confidence}%</div>
      </div>
      <span class="history-time">${new Date(it.ts).toLocaleString()}</span>`;
    li.addEventListener("click", () => {
      input.value = `https://www.instagram.com/${it.username}/`;
      historyModal.classList.add("hidden");
    });
    historyList.appendChild(li);
  });
}

historyBtn?.addEventListener("click", () => { renderHistory(); historyModal.classList.remove("hidden"); });
historyClose?.addEventListener("click", () => historyModal.classList.add("hidden"));
historyModal?.addEventListener("click", e => {
  if (e.target === historyModal || e.target.classList.contains("modal__backdrop"))
    historyModal.classList.add("hidden");
});
historyClear?.addEventListener("click", () => { localStorage.removeItem(HISTORY_KEY); renderHistory(); });

/* ====================================================================
   API CALL
   ==================================================================== */
async function analyzeProfile(urls, body) {
  let lastErr = null;
  for (const url of urls) {
    try {
      const res  = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 404) throw new Error(`Route not found: ${url}`);
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      return data;
    } catch (e) {
      lastErr = e;
      if (!(e instanceof Error) || !e.message.startsWith("Route not found:")) throw e;
    }
  }
  throw lastErr || new Error("No compatible API route found.");
}

/* ====================================================================
   FORM SUBMIT
   ==================================================================== */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const profileUrl = input.value.trim();
  if (!profileUrl) return;

  hideAlert();
  dashboard.classList.add("hidden");
  setLoading(true);
  showToast("🔍 Fetching profile data and running ensemble AI prediction...", "info");

  try {
    const data = await analyzeProfile(
      ["/analyze-profile", "http://127.0.0.1:5000/analyze-profile"],
      { profile_url: profileUrl }
    );
    if (data && data.ok === false) throw new Error(data.error || "Could not analyze profile.");
    renderResult(data);
    addToHistory({
      username: data.username || "unknown",
      label: data.prediction?.label || "Unknown",
      confidence: Number(data.prediction?.confidence_percent ?? 0).toFixed(1),
      ts: Date.now(),
    });
    showToast(`✅ Analysis complete — ${Object.keys(data.features || {}).length} features extracted via Ensemble ML`, "success");
  } catch (err) {
    showToast("❌ " + (err.message || "Unable to analyze profile. Please try again."), "error");
  } finally {
    setLoading(false);
  }
});

/* ─── LOGOUT HANDLER ─── */
logoutBtn?.addEventListener("click", async () => {
  try {
    const res = await fetch("/api/auth/logout", { method: "POST" });
    const data = await res.json();
    if (data.ok) {
      showToast("Signed out successfully. See you soon!", "success", 1500);
      setTimeout(() => { window.location.href = data.redirect || "/login"; }, 1000);
    }
  } catch (err) {
    showToast("Logout failed. Please try again.", "error");
  }
});

/* ─── PARTICLE BACKGROUND ─── */
(function initParticles() {
  if (!particleCanvas) return;
  const ctx = particleCanvas.getContext("2d");
  let W, H, particles = [];
  const COUNT = 12;
  const isDark = () => document.documentElement.getAttribute("data-theme") !== "light";

  class Particle {
    constructor() { this.reset(true); }
    reset(init = false) {
      this.x = Math.random() * W;
      this.y = init ? Math.random() * H : H + 10;
      this.r = Math.random() * 2 + 0.5;
      this.vx = (Math.random() - 0.5) * 0.3;
      this.vy = -(Math.random() * 0.5 + 0.15);
      this.life = 0;
      this.maxLife = Math.random() * 250 + 150;
      const hues = [270, 0, 38]; 
      this.hue = hues[Math.floor(Math.random() * hues.length)];
    }
    step() {
      this.x += this.vx + Math.sin(this.life * 0.03) * 0.2;
      this.y += this.vy;
      this.life++;
      if (this.life > this.maxLife || this.y < -10) this.reset();
    }
    draw() {
      const pct = this.life / this.maxLife;
      const alpha = pct < 0.2 ? pct / 0.2 : pct > 0.8 ? 1 - (pct - 0.8) / 0.2 : 1;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fillStyle = isDark()
        ? `hsla(${this.hue}, 80%, 70%, ${alpha * 0.4})`
        : `hsla(${this.hue}, 60%, 50%, ${alpha * 0.25})`;
      ctx.fill();
    }
  }

  function resize() {
    W = particleCanvas.width = window.innerWidth;
    H = particleCanvas.height = window.innerHeight;
  }

  function loop() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => { p.step(); p.draw(); });
    requestAnimationFrame(loop);
  }

  resize();
  particles = Array.from({ length: COUNT }, () => new Particle());
  loop();
  window.addEventListener("resize", resize);
})();

/* ====================================================================
   INIT
   ==================================================================== */
loadAndRenderAlgoChart();
