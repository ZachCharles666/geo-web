interface CaptchaResponse {
  success: boolean;
  svg?: string;
  token?: string;
  message?: string;
  spam?: boolean;
  id?: string;
}

interface LeadResponse {
  success: boolean;
  message?: string;
  spam?: boolean;
  id?: string;
}

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE || 'http://localhost:8787';

// 拿到 DOM 元素并加上类型
const form = document.getElementById('contact-form') as HTMLFormElement | null;
const svgBox = document.getElementById('svg-captcha-container') as HTMLDivElement | null;
const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement | null;
const reloadBtn = document.getElementById('reload-captcha') as HTMLButtonElement | null;
const captchaInput = document.getElementById('captcha_input') as HTMLInputElement | null;

// 兜底：如果这些关键元素不存在，直接报错一次，避免后面空指针
if (!form || !svgBox || !submitBtn || !captchaInput) {
  console.error(
    '[lead-collect] 必要的表单元素未找到，请检查 contact 页面中元素 id 是否正确：' +
      'contact-form / svg-captcha-container / submit-btn / captcha_input'
  );
}

let captchaToken: string = '';

async function loadCaptcha(): Promise<void> {
  if (!svgBox) return;

  try {
    const res = await fetch(`${API_BASE}/captcha`, {
      method: 'GET',
      // 本地/SCF 默认不需要带 cookie，避免多余的跨域问题
      // credentials: 'include',
    });

    const data = (await res.json()) as CaptchaResponse;

    if (data.success && data.svg && data.token) {
      svgBox.innerHTML = data.svg;
      captchaToken = data.token;
      if (captchaInput) captchaInput.value = '';
    } else {
      console.warn('[lead-collect] 加载验证码失败：', data.message);
      svgBox.innerHTML =
        '<span class="text-red-500 text-xs">验证码加载失败，请刷新页面重试</span>';
      captchaToken = '';
    }
  } catch (error) {
    console.error('[lead-collect] 请求验证码异常：', error);
    svgBox.innerHTML =
      '<span class="text-red-500 text-xs">验证码服务异常，请稍后重试</span>';
    captchaToken = '';
  }
}

// 点击“换一张”
if (reloadBtn) {
  reloadBtn.addEventListener('click', (event) => {
    event.preventDefault();
    void loadCaptcha();
  });
}

// 提交表单
if (submitBtn && form) {
  submitBtn.addEventListener('click', async (event) => {
    event.preventDefault();

    if (!captchaToken) {
      alert('验证码未加载或已失效，请点击“换一张”重新获取。');
      return;
    }

    if (!captchaInput || !captchaInput.value.trim()) {
      alert('请输入验证码。');
      return;
    }

    const formData = new FormData(form);
    formData.append('captcha_token', captchaToken);
    formData.append('client_ts', Date.now().toString());

    try {
      const res = await fetch(`${API_BASE}/lead-collect`, {
        method: 'POST',
        body: formData,
      });

      const data = (await res.json()) as LeadResponse;

      if (!data.success) {
        alert(data.message || '提交失败，请稍后重试。');
        // 无论成功失败都刷新验证码，避免重复使用
        await loadCaptcha();
        return;
      }

      // success = true 的分支
      if (data.spam) {
        // 被规则标记为可疑：只提示已收到，不进入正式渠道
        alert('已收到，我们会根据系统检测结果进行筛选。');
      } else {
        alert('提交成功，已进入人工审核流程。');
      }

      form.reset();
      await loadCaptcha();
    } catch (error) {
      console.error('[lead-collect] 提交异常：', error);
      alert('网络异常或服务器错误，请稍后重试。');
      await loadCaptcha();
    }
  });
}

// 首次加载验证码
void loadCaptcha();
