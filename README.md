# Nara AI Insurance PoC

> 在线体验：[nara-ai-insurance-poc.tangyiris.chatgpt.site](https://nara-ai-insurance-poc.tangyiris.chatgpt.site)

Nara 是一个基于虚构数据的保险助手项目，来自内部 AI Challenge（第一名）。本仓库同时保留两类互补产出：一类用于验证决策方案是否可行，另一类用于完整呈现面向业务的 AI 产品体验。

## 两类项目产出

| 产出 | 目的 | 查看方式 |
| --- | --- | --- |
| **PoC 可行性验证** | 验证 LLM 与规则引擎的混合决策方式，并对比三种运行模式 | [在线交互 Demo](https://nara-ai-insurance-poc.tangyiris.chatgpt.site) / 本仓库源码 |
| **AI Demo 参赛作品** | 展示从用户需求理解、推荐、在线投保到流失识别与后台跟进的 Agent/Admin 业务闭环 | [最终参赛视频](https://my.feishu.cn/file/QV6sbiMlhoekrXxT16VcyIfJnQc?from=from_copylink) / [Figma 关键帧](https://www.figma.com/design/qDrQZjREMHG7DOBcmahceX/nara_shopee?node-id=0-1&t=gdx1QpTnOgnOZEsX-1) |

## PoC 可行性验证

PoC 验证了从用户咨询、优惠券决策、产品推荐到产品比较的四阶段决策流程。

### 项目展示什么

- 混合决策思路：LLM 可负责语义理解，资格、合规、定价和来源校验等高风险环节保留确定性规则。
- 三种可对照模式：`Hybrid`、`Rules Only` 与 `LLM Only`。
- 每阶段均提供可追溯信息：结构化字段、规则校验、决策原因、来源证据及人工核对标记。
- 固定测试集覆盖正常咨询、信息缺失、优惠券频控、PDP 字段冲突和产品硬过滤等情况。

公开网页仅使用虚构和脱敏数据，当前为 **Public Mock Demo**：不暴露 API Key、不产生付费模型调用，也不保留访问者输入。项目通过 `LLMProvider` 预留了服务端接入真实模型的接口；本仓库默认使用确定性的 Mock 实现。

### 四阶段流程

1. **Chat**：将自然语言需求整理为 `UserNeed` 结构，并识别缺失信息。
2. **Voucher**：依次校验市场、用户分群、续保窗口、预算、频控、适用范围和折扣规则，再选择可用券。
3. **Recommendation**：先进行产品硬过滤，再按保障匹配度（60%）与用券后价格相对预算（40%）排序。
4. **Comparison**：仅从虚构 PDP 的可见内容中提取字段；没有证据的字段不补全，存在冲突时转人工核对。

### 三种模式的意义

同一批案例会在三种模式下运行，用于观察不同方案的边界：

| 模式 | 决策方式 |
| --- | --- |
| `Hybrid` | 使用语义理解，并在高风险决策处加入可审计的规则门禁 |
| `Rules Only` | 全流程依赖确定性规则与模式匹配 |
| `LLM Only` | 以模型输出为主，不具备相同的下游硬规则和来源校验门禁 |

本项目不试图证明某种模型在所有场景都更好，而是验证 LLM 适合承担哪些工作，以及哪些环节需要保留可控的产品规则。

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://127.0.0.1:5173`。

```bash
npm test
npm run build
```

当前包含 28 项单元与端到端检查。

## 数据与边界

- 用户、车辆、优惠券、产品和 PDP 页面均为虚构数据。
- 不包含 Shopee、保险公司、客户、保单、支付或核保的真实数据。
- `.env` 已排除在版本控制之外，请勿提交模型 Key。
- 这是可行性验证原型，不是生产环境的保险服务。

## 目录说明

```text
src/client/       React 交互式验证界面
src/server/data/  虚构数据、测试案例和预期结果
src/server/llm/   Provider 接口与确定性 Mock 实现
src/server/services/
                  Chat、优惠券、推荐、比较和评估逻辑
tests/            单元与端到端验证
```

## AI Demo 参赛作品

这部分回答的是“AI 如何在完整业务流程中影响用户体验和转化”。用户侧 Agent 负责需求理解、推荐和投保引导；后台 Admin 聚合对话进度与流失信号，支持后续触达。

制作过程以 [Figma 关键帧](https://www.figma.com/design/qDrQZjREMHG7DOBcmahceX/nara_shopee?node-id=0-1&t=gdx1QpTnOgnOZEsX-1) 与动效说明为输入，由 Codex 协助实现可演示网页，经人工校验、录制和剪辑后形成 [最终参赛成片](https://my.feishu.cn/file/QV6sbiMlhoekrXxT16VcyIfJnQc?from=from_copylink)。

