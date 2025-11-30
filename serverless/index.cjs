// serverless/index.cjs  —— CJS Handler 垫片
exports.main = async (...args) => {
  const mod = await import('./lead-collect.js');  // 动态 import 你的 ESM 文件
  return mod.main(...args);                       // 调用 ESM 的 main(req, res)
};
