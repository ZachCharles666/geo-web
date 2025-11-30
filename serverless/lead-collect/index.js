// serverless/lead-collect/index.js
const express = require('express');
const bodyParser = require('body-parser');
const svgCaptcha = require('svg-captcha');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const HMAC_SECRET = process.env.CAPTCHA_HMAC_SECRET || 'CHANGE_ME_TO_STRONG_SECRET';
const RATE_LIMIT_WINDOW_SEC = parseInt(process.env.RATE_LIMIT_WINDOW_SEC || '60', 10);
const RATE_LIMIT_MAX_PER_WINDOW = parseInt(process.env.RATE_LIMIT_MAX_PER_WINDOW || '20', 10);

const ipRateMap = new Map();
const spamPatterns = [
  /roeddwn i eisiau gwybod eich pris/i,
  /bengifuna ukwazi intengo yakho/i,
  /kam dashur të di çmimin tuaj/i,
];

function signToken(payloadJson) {
  const payload = Buffer.from(payloadJson).toString('base64url');
  const h = crypto.createHmac('sha256', HMAC_SECRET).update(payload).digest('base64url');
  return `${payload}.${h}`;
}

function verifyToken(token) {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expect = crypto.createHmac('sha256', HMAC_SECRET).update(payload).digest('base64url');
  if (!timingSafeEqual(expect, sig)) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return null;
  }
}

function timingSafeEqual(a, b) {
  try {
    const A = Buffer.from(a);
    const B = Buffer.from(b);
    if (A.length !== B.length) return false;
    return crypto.timingSafeEqual(A, B);
  } catch {
    return false;
  }
}

function isRateLimited(ip) {
  const now = Math.floor(Date.now() / 1000);
  const rec = ipRateMap.get(ip);
  if (!rec || now - rec.windowStartSec >= RATE_LIMIT_WINDOW_SEC) {
    ipRateMap.set(ip, { windowStartSec: now, count: 1 });
    return false;
  }
  rec.count += 1;
  if (rec.count > RATE_LIMIT_MAX_PER_WINDOW) {
    return true;
  }
  ipRateMap.set(ip, rec);
  return false;
}

// 获取客户端 IP（本地开发用，简单版）
function getIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
         req.connection.remoteAddress ||
         'unknown';
}

// GET /captcha
app.get('/captcha', (req, res) => {
  const captcha = svgCaptcha.create({
    size: 4,
    ignoreChars: '0oO1ilI',
    noise: 2,
    color: true,
    background: '#f2f2f2',
    width: 120,
    height: 40
  });
  const solution = (captcha.text || '').toLowerCase();
  const exp = Date.now() + 2 * 60 * 1000;

  const token = signToken(JSON.stringify({
    id: uuidv4(),
    sol: solution,
    exp
  }));

  res.json({
    success: true,
    svg: captcha.data,
    token
  });
});

// POST /lead-collect
app.post('/lead-collect', (req, res) => {
  const ip = getIp(req);
  const {
    name = '',
    company = '',
    phone = '',
    email = '',
    message = '',
    website = '',
    captcha_token = '',
    captcha_input = '',
    client_ts = ''
  } = req.body;

  const _name = String(name).trim();
  const _company = String(company).trim();
  const _message = String(message).trim();
  const _email = String(email).trim();
  const _phone = String(phone).trim();
  const _honeypot = String(website).trim();
  const _captchaInput = String(captcha_input).trim().toLowerCase();
  const _clientTs = parseInt(client_ts || '0', 10) || 0;

  // 基本空内容
  if (!_name && !_message && !_email && !_phone) {
    return res.status(400).json({ success: false, message: 'empty payload' });
  }

  // 蜜罐命中：视为垃圾
  if (_honeypot) {
    console.warn('Honeypot hit', { ip, _name, _company, _email });
    return res.json({ success: true, spam: true, message: 'spam blocked (honeypot)' });
  }

  // 速率限制
  if (isRateLimited(ip)) {
    console.warn('Rate limited', ip);
    return res.status(429).json({ success: false, message: 'Too many requests' });
  }

  // 验证码 token 校验
  const payload = verifyToken(captcha_token);
  if (!payload || !payload.sol || !payload.exp) {
    return res.status(400).json({ success: false, message: 'Invalid captcha token' });
  }
  if (Date.now() > payload.exp) {
    return res.status(400).json({ success: false, message: 'Captcha expired' });
  }
  if (_captchaInput !== payload.sol) {
    return res.status(400).json({ success: false, message: 'Captcha mismatch' });
  }

  // 提交速度校验：小于 1.5 秒视为可疑
  const now = Date.now();
  if (_clientTs && (now - _clientTs) < 1500) {
    console.warn('Too fast submit', { ip, delta: now - _clientTs });
    return res.json({ success: true, spam: true, message: 'received but flagged (too fast)' });
  }

  // 文本模板规则
  const combined = `${_name} ${_company} ${_message}`.toLowerCase();
  let isSpam = false;
  for (const re of spamPatterns) {
    if (re.test(combined)) {
      isSpam = true;
      break;
    }
  }
  if (isSpam || (_name && _company && _name === _company)) {
    console.warn('Template spam', { ip, _name, _company });
    return res.json({ success: true, spam: true, message: 'received but flagged (template)' });
  }

  // 正常线索（这里先只打印，实际你可以写入 DB / 发企业微信）
  const lead = {
    id: uuidv4(),
    name: _name,
    company: _company,
    phone: _phone,
    email: _email,
    message: _message,
    ip,
    spam: false,
    status: 'pending_review',
    createdAt: new Date().toISOString()
  };
  console.log('Lead accepted (pending review):', lead);

  res.json({ success: true, id: lead.id, message: 'Lead accepted (pending review).' });
});

// 启动本地服务（开发用）
if (require.main === module) {
  const PORT = process.env.LEAD_PORT || 8787;
  app.listen(PORT, () => {
    console.log(`Lead-collect dev server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
