const env = window.__GEO_PUBLIC__ || {};
const API_BASE = env.VITE_API_BASE || "http://localhost:8787";

const form = document.getElementById("contact-form");
const svgBox = document.getElementById("svg-captcha-container");
const submitBtn = document.getElementById("submit-btn");
const reloadBtn = document.getElementById("reload-captcha");
const captchaInput = document.getElementById("captcha_input");

if (!form || !svgBox || !submitBtn || !captchaInput) {
  console.error(
    "[lead-collect] Missing form elements: contact-form / svg-captcha-container / submit-btn / captcha_input"
  );
}

let captchaToken = "";

async function loadCaptcha() {
  if (!svgBox) return;

  try {
    const res = await fetch(`${API_BASE}/captcha`, {
      method: "GET",
    });

    const data = await res.json();

    if (data.success && data.svg && data.token) {
      svgBox.innerHTML = data.svg;
      captchaToken = data.token;
      if (captchaInput) captchaInput.value = "";
    } else {
      console.warn("[lead-collect] captcha load failed:", data.message);
      svgBox.innerHTML =
        '<span class="text-red-500 text-xs">验证码加载失败，请刷新页面重试</span>';
      captchaToken = "";
    }
  } catch (error) {
    console.error("[lead-collect] captcha request failed:", error);
    svgBox.innerHTML =
      '<span class="text-red-500 text-xs">验证码服务异常，请稍后重试</span>';
    captchaToken = "";
  }
}

if (reloadBtn) {
  reloadBtn.addEventListener("click", (event) => {
    event.preventDefault();
    void loadCaptcha();
  });
}

if (submitBtn && form) {
  submitBtn.addEventListener("click", async (event) => {
    event.preventDefault();

    if (!captchaToken) {
      alert("验证码未加载或已失效，请点击“换一张”重新获取。");
      return;
    }

    if (!captchaInput || !captchaInput.value.trim()) {
      alert("请输入验证码。");
      return;
    }

    const formData = new FormData(form);
    formData.append("captcha_token", captchaToken);
    formData.append("client_ts", Date.now().toString());

    try {
      const res = await fetch(`${API_BASE}/lead-collect`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!data.success) {
        alert(data.message || "提交失败，请稍后重试。");
        await loadCaptcha();
        return;
      }

      if (data.spam) {
        alert("已收到，我们会根据系统检测结果进行筛选。");
      } else {
        alert("提交成功，已进入人工审核流程。");
      }

      form.reset();
      await loadCaptcha();
    } catch (error) {
      console.error("[lead-collect] submit failed:", error);
      alert("网络异常或服务器错误，请稍后重试。");
      await loadCaptcha();
    }
  });
}

void loadCaptcha();
