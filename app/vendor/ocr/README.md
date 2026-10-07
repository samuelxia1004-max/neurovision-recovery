# 本地报告 OCR

`offline-assets.js` 内含 Tesseract.js 6.0.1 browser worker、Tesseract.js-core 6.0.0 非 SIMD LSTM WASM，以及固定 `@tesseract.js-data/{eng,chi_sim}@1.0.0/4.0.0_best_int` 模型。脚本约 9.82 MiB，首次识别时按需加载。准确来源、字节数和 SHA-256 见 `manifest.json`；许可证与上游声明保存在本目录。语言 npm 包的 package.json 标注 MIT，上游 tessdata 仓库使用 Apache-2.0；两类原始声明均保留，不能把 package 元数据当成模型来源许可的替代。

运行时通过普通本地 `<script>` 加载资源、Blob Worker 执行；WASM 与语言模型作为内存字节传入。不会通过 fetch 读取本地模型，也没有 CDN 回退。Worker 明确禁用 fetch、XMLHttpRequest、importScripts；关闭模型 IndexedDB 缓存；识别结束、取消或超时销毁 Worker。图片没有进入 localStorage/sessionStorage/IndexedDB。主界面应只保存患者确认后的字段，不保存原图、整段 OCR 文本或未确认候选。

建议 CSP：`script-src 'self' file: 'wasm-unsafe-eval'; worker-src blob:; img-src 'self' data: blob: file:; connect-src 'none'`。无需 `unsafe-eval`；合成实验禁用了 VM 内 JavaScript 动态代码生成，WASM 仍能完成识别。此测试不能替代具体浏览器的 CSP/file:// 行为验证。总流程超时与取消覆盖图片解码、canvas、资源脚本加载及识别；默认 120 秒，最大 180 秒。

## 集成

加载 `app/report-import.js` 即获得 `window.NVReportImport`，无需提前加载本文件夹内的大脚本。

```js
const controller = new AbortController();
const result = await NVReportImport.recognize(file, {
  report_id: '由界面生成的唯一标识',
  signal: controller.signal,
  onProgress: ({ status, progress }) => updateProgress(status, progress)
});
// result.text / result.candidates / result.warnings / result.ocr
// 每个 candidate 必须经患者逐项核对；此 API 不会提交或保存任何记录。
```

`extract(textOrLines, {report_id})` 接受文字或 `{text, confidence}` 行数组，也接受 Tesseract `{blocks,text}` 对象。返回 `{version,report_id,candidates,warnings,lines,review_required:true}`。`recognize` 在此基础上增加 `text` 和 `ocr`。`combine([result,...])` 保留所有候选，标记可能冲突，绝不合并同字段值。

每个候选包括 `field, eye, stage, value, unit, suggested_unit, original_value, original_unit, source_snippet, source_line, confidence, flags, requires_confirmation`。日期另有 `date_kind`。`confidence` 为引擎的行置信度 0–1，缺失时 null，不能解释为临床准确率。缺失单位返回 `unit:null`，不推定单位；可明确换算的 mm/µm、kPa/mmHg 保留原值和原单位。范围检查仅用于发现录入异常，不是临床正常范围或诊断阈值。

屈光 `cyl/axis` 与晶体 `icl_cyl/icl_axis` 分开提取。仅看到明确 TICL/ICL 或晶体标签才生成后者；不会从普通散光度数推断晶体参数。

输入为 PNG/JPG（最多 20 MiB、2400 万像素）或受限静态 SVG（最多 1 MiB）。SVG 仅支持简单文本/路径/图形；脚本、样式、外部引用、图片、foreignObject、XML 声明/实体等会拒绝，需转为 PNG/JPG。图片透明区会铺白，最长边缩至 3000 像素。一次仅识别一张图。

## 验证范围与限制

`tests/report-import.test.cjs` 检查字段标签、眼别、术前术后、单位转换、日期、低置信、参考范围排除、冲突保留和输入校验。`analysis/ocr-synthetic.cjs` 使用纯合成报告图片，在 Node VM 中执行交付同一 browser worker + WASM + 模型，没有启动浏览器、HTTP 服务，也没有访问真实报告。结果见 `analysis/ocr-synthetic-results.json`。

`analysis/build-ocr-assets.py` 可用 manifest 指定的四个已下载原始文件重建资源包；脚本先验证源哈希，再检查输出哈希，不联网。浏览器直接使用已交付脚本，无需 Python/Node/Tesseract 安装。

这不等于完成了 Chrome/Safari/内嵌浏览器的 file:// UI 兼容性验证。Blob Worker、WebAssembly 或本地脚本被浏览器/安全策略禁止时，识别会失败；界面应始终提供粘贴报告文字及手工录入。未验证真实医院版式、拍照倾斜、手写、低分辨率及复杂表格准确率。此合成图片中的“拱高”曾被引擎识别为 `HE`，因此没有产生拱高候选；`cells/mm²` 也可能损坏而触发单位缺失。缺失项目必须由患者对照原报告补录，不应自动猜测。

目前支持明确标签和明确 OD/OS/OU、右眼/左眼/双眼、RIGHT/LEFT 眼别，支持常见左右眼列标题和 SPH/CYL/AXIS 行表。复杂跨页/跨列版式可能无法恢复关系。所有识别结果均是候选，不是已确认病历，也不产生医疗判断。
