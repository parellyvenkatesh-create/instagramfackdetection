/* ======================================================================
   InstaGuard AI — Auth Pages JavaScript
   Features: Particles, Floating Labels, Validation, Toasts,
             Password Strength, Page Transitions, Theme Toggle
   ====================================================================== */
"use strict";

/* ── DOM helpers ── */
const $id  = (id) => document.getElementById(id);
const THEME_KEY = "ig_guard_theme";

/* ====================================================================
   THEME
   ==================================================================== */
(function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || "dark";
  applyTheme(saved);
})();

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
  const btn = $id("themeToggle");
  if (!btn) return;
  const moon = btn.querySelector(".icon-moon");
  const sun  = btn.querySelector(".icon-sun");
  if (theme === "light") {
    moon?.classList.add("hidden");
    sun?.classList.remove("hidden");
  } else {
    moon?.classList.remove("hidden");
    sun?.classList.add("hidden");
  }
}

$id("themeToggle")?.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  applyTheme(current === "dark" ? "light" : "dark");
});

/* ====================================================================
   PARTICLE BACKGROUND
   ==================================================================== */
(function initParticles() {
  const canvas = $id("particleCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let W, H, particles = [];
  const COUNT = 55;
  const isDark = () => document.documentElement.getAttribute("data-theme") !== "light";

  class Particle {
    constructor() { this.reset(true); }
    reset(init = false) {
      this.x    = Math.random() * W;
      this.y    = init ? Math.random() * H : H + 10;
      this.r    = Math.random() * 2.2 + 0.6;
      this.vx   = (Math.random() - 0.5) * 0.35;
      this.vy   = -(Math.random() * 0.55 + 0.18);
      this.life = 0;
      this.maxLife = Math.random() * 280 + 180;
      const hues = [270, 0, 38];  // purple, red, amber
      this.hue  = hues[Math.floor(Math.random() * hues.length)];
    }
    step() {
      this.x    += this.vx + Math.sin(this.life * 0.03) * 0.25;
      this.y    += this.vy;
      this.life++;
      if (this.life > this.maxLife || this.y < -10) this.reset();
    }
    draw() {
      const pct   = this.life / this.maxLife;
      const alpha = pct < 0.2 ? pct / 0.2 : pct > 0.8 ? 1 - (pct - 0.8) / 0.2 : 1;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fillStyle = isDark()
        ? `hsla(${this.hue}, 80%, 70%, ${alpha * 0.65})`
        : `hsla(${this.hue}, 60%, 50%, ${alpha * 0.4})`;
      ctx.fill();
    }
  }

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function init() {
    resize();
    particles = Array.from({ length: COUNT }, () => new Particle());
  }

  function loop() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => { p.step(); p.draw(); });
    requestAnimationFrame(loop);
  }

  init();
  loop();
  window.addEventListener("resize", resize);
})();

/* ====================================================================
   TOAST SYSTEM
   ==================================================================== */
function showToast(message, type = "info", duration = 3500) {
  const container = $id("toastContainer");
  if (!container) return;

  const icons = { success: "✅", error: "❌", info: "💡" };
  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `<span class="toast__icon">${icons[type] || "ℹ️"}</span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toast--exit");
    setTimeout(() => toast.remove(), 310);
  }, duration);
}

/* ====================================================================
   FIELD VALIDATION HELPERS
   ==================================================================== */
function setError(wrapId, errId, msg) {
  const wrap = $id(wrapId);
  const err  = $id(errId);
  if (wrap) wrap.classList.add("has-error");
  if (err) { err.textContent = msg; err.style.animation = "none"; void err.offsetWidth; err.style.animation = ""; }
}
function clearError(wrapId, errId) {
  const wrap = $id(wrapId);
  const err  = $id(errId);
  if (wrap) wrap.classList.remove("has-error");
  if (err) err.textContent = "";
}

/* ====================================================================
   SHOW / HIDE PASSWORD TOGGLE
   ==================================================================== */
function initShowPassword(btnId, inputId) {
  const btn   = $id(btnId);
  const input = $id(inputId);
  if (!btn || !input) return;
  btn.addEventListener("click", () => {
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    btn.querySelector(".eye-open")?.classList.toggle("hidden", !showing);
    btn.querySelector(".eye-closed")?.classList.toggle("hidden", showing);
  });
}

/* ====================================================================
   PAGE: LOGIN
   ==================================================================== */
const loginForm = $id("loginForm");
if (loginForm) {
  initShowPassword("showPwdBtn", "password");

  /* Forgot password */
  $id("forgotLink")?.addEventListener("click", (e) => {
    e.preventDefault();
    $id("forgotModal")?.classList.remove("hidden");
  });
  $id("forgotClose")?.addEventListener("click",  () => $id("forgotModal")?.classList.add("hidden"));
  $id("forgotOk")?.addEventListener("click",    () => $id("forgotModal")?.classList.add("hidden"));
  $id("forgotModal")?.addEventListener("click", (e) => {
    if (e.target.classList.contains("auth-modal__backdrop") || e.target === $id("forgotModal"))
      $id("forgotModal")?.classList.add("hidden");
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    let valid = true;

    const identifier = $id("identifier")?.value.trim() || "";
    const password   = $id("password")?.value || "";
    const remember   = $id("rememberMe")?.checked || false;

    clearError("fieldIdentifier", "errIdentifier");
    clearError("fieldPassword", "errPassword");

    if (!identifier) { setError("fieldIdentifier", "errIdentifier", "Please enter your email or username."); valid = false; }
    if (!password)   { setError("fieldPassword", "errPassword", "Please enter your password."); valid = false; }
    if (!valid) return;

    const btn = $id("loginBtn");
    btn.disabled = true;
    btn.querySelector(".btn-label")?.classList.add("hidden");
    btn.querySelector(".btn-loading")?.classList.remove("hidden");

    try {
      const res  = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password, remember }),
        credentials: "include",
      });
      const data = await res.json();

      if (data.ok) {
        showToast(data.message || "Welcome back!", "success", 2000);

        /* Success tick animation then redirect */
        btn.innerHTML = `<span style="font-size:1.2rem">✓</span> Redirecting…`;
        btn.style.background = "linear-gradient(135deg,#22c55e,#16a34a)";
        setTimeout(() => { window.location.href = data.redirect || "/"; }, 1200);
      } else {
        if (res.status === 401) {
          setError("fieldPassword", "errPassword", data.error || "Invalid credentials.");
        } else {
          showToast(data.error || "Login failed. Try again.", "error");
        }
        btn.disabled = false;
        btn.querySelector(".btn-label")?.classList.remove("hidden");
        btn.querySelector(".btn-loading")?.classList.add("hidden");
      }
    } catch (_) {
      showToast("Network error — is the server running?", "error");
      btn.disabled = false;
      btn.querySelector(".btn-label")?.classList.remove("hidden");
      btn.querySelector(".btn-loading")?.classList.add("hidden");
    }
  });
}

/* ====================================================================
   PAGE: SIGNUP
   ==================================================================== */
const signupForm = $id("signupForm");
if (signupForm) {
  initShowPassword("showPwdBtn", "password");

  /* Password strength + rules */
  const pwdInput = $id("password");
  const pwdFill  = $id("pwdFill");
  const pwdLabel = $id("pwdLabel");

  const ruleLen   = $id("rule-len");
  const ruleUpper = $id("rule-upper");
  const ruleNum   = $id("rule-num");

  function evalStrength(pwd) {
    let score = 0;
    const hasLen   = pwd.length >= 8;
    const hasUpper = /[A-Z]/.test(pwd);
    const hasNum   = /\d/.test(pwd);
    const hasSpec  = /[^A-Za-z0-9]/.test(pwd);
    if (hasLen)   score++;
    if (hasUpper) score++;
    if (hasNum)   score++;
    if (hasSpec)  score++;

    ruleLen?.classList.toggle("valid", hasLen);
    ruleUpper?.classList.toggle("valid", hasUpper);
    ruleNum?.classList.toggle("valid", hasNum);

    const labels = ["", "Weak", "Fair", "Good", "Strong"];
    if (pwdFill)  { pwdFill.dataset.level = pwd ? score : 0; }
    if (pwdLabel) {
      pwdLabel.textContent = pwd ? labels[score] : "Enter a password";
      pwdLabel.dataset.level = pwd ? score : 0;
    }
  }

  pwdInput?.addEventListener("input", () => evalStrength(pwdInput.value));

  /* Confirm match live check */
  $id("confirmPassword")?.addEventListener("input", function () {
    if (pwdInput?.value && this.value && this.value !== pwdInput.value) {
      setError("fieldConfirm", "errConfirm", "Passwords don't match.");
    } else {
      clearError("fieldConfirm", "errConfirm");
    }
  });

  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    let valid = true;

    const username = $id("username")?.value.trim() || "";
    const email    = $id("email")?.value.trim() || "";
    const password = $id("password")?.value || "";
    const confirm  = $id("confirmPassword")?.value || "";

    /* Clear all errors */
    [["fieldUsername","errUsername"], ["fieldEmail","errEmail"],
     ["fieldPassword","errPassword"], ["fieldConfirm","errConfirm"]].forEach(([w,e]) => clearError(w,e));

    /* Validate */
    if (!username) { setError("fieldUsername","errUsername","Username is required."); valid=false; }
    else if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) { setError("fieldUsername","errUsername","3–24 chars: letters, numbers, underscores."); valid=false; }

    if (!email) { setError("fieldEmail","errEmail","Email is required."); valid=false; }
    else if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) { setError("fieldEmail","errEmail","Enter a valid email address."); valid=false; }

    if (password.length < 8) { setError("fieldPassword","errPassword","Minimum 8 characters required."); valid=false; }
    else if (!/[A-Z]/.test(password)) { setError("fieldPassword","errPassword","Add at least one uppercase letter."); valid=false; }
    else if (!/\d/.test(password))    { setError("fieldPassword","errPassword","Add at least one number."); valid=false; }

    if (!confirm) { setError("fieldConfirm","errConfirm","Please confirm your password."); valid=false; }
    else if (confirm !== password) { setError("fieldConfirm","errConfirm","Passwords don't match."); valid=false; }

    if (!valid) return;

    const btn = $id("signupBtn");
    btn.disabled = true;
    btn.querySelector(".btn-label")?.classList.add("hidden");
    btn.querySelector(".btn-loading")?.classList.remove("hidden");

    try {
      const res  = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password, confirm_password: confirm }),
        credentials: "include",
      });
      const data = await res.json();

      if (data.ok) {
        showToast("🎉 " + (data.message || "Account created!"), "success", 2200);
        btn.innerHTML = `<span style="font-size:1.2rem">✓</span> Account created!`;
        btn.style.background = "linear-gradient(135deg,#22c55e,#16a34a)";
        setTimeout(() => { window.location.href = data.redirect || "/"; }, 1400);
      } else {
        const errMsg = data.error || "Registration failed.";
        /* Map server errors back to fields */
        if (errMsg.toLowerCase().includes("email"))    setError("fieldEmail","errEmail", errMsg);
        else if (errMsg.toLowerCase().includes("username")) setError("fieldUsername","errUsername", errMsg);
        else if (errMsg.toLowerCase().includes("password")) setError("fieldPassword","errPassword", errMsg);
        else showToast(errMsg, "error");

        btn.disabled = false;
        btn.querySelector(".btn-label")?.classList.remove("hidden");
        btn.querySelector(".btn-loading")?.classList.add("hidden");
      }
    } catch (_) {
      showToast("Network error — is the server running?", "error");
      btn.disabled = false;
      btn.querySelector(".btn-label")?.classList.remove("hidden");
      btn.querySelector(".btn-loading")?.classList.add("hidden");
    }
  });
}
