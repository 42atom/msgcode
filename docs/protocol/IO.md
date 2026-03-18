# IO Protocol

## 定位

I/O 系统只回答两件事：

- 输入事件怎么进来
- 交付结果怎么送出去

I/O 系统不做三件事：

- 不做任务编排
- 不做调度决策
- 不创造新的状态真相源

一句话：

- 输入是事件
- 输出是可验证交付

## 当前现役入口

当前主入口固定为：

- Feishu

后续入口可以继续接：

- browser / ghost
- mail
- voice

但它们都必须服从同一条薄边界：

- 通道只负责收和发
- 任务推进仍回到 `issues/`、`.msgcode/dispatch/`、`.msgcode/subagents/`

## 输入合同

一个输入事件，最少要能回答：

- 从哪里来
- 谁发来的
- 原始文本是什么
- 附件落在什么路径
- 能不能反查回原消息

最小字段：

```ts
type IoInboundEvent = {
  transport: string;
  chatId: string;
  messageId: string;
  text?: string;
  attachments?: Array<{
    kind: "audio" | "image" | "file";
    localPath: string;
    mime?: string;
    fileName?: string;
  }>;
};
```

规则：

- 通道层只做归一化
- 附件先落文件，再把路径交给主脑
- 不在 I/O 层偷做理解、派单、任务验收

## 输出合同

一个输出交付，最少要能回答：

- 发到哪里
- 发了什么
- 关联了哪些产物
- 发送是否成功

最小字段：

```ts
type IoDelivery = {
  transport: string;
  chatId: string;
  text?: string;
  artifacts?: string[];
  delivered: boolean;
  receipt?: string;
  error?: string;
};
```

规则：

- 文本回复只是交付的一种
- 文件、图片、音频都算交付
- 没有真实回执，不算已送达
- 通道失败要回真实错误，不做假成功

## 真相源边界

I/O 层不额外保状态。

真相仍然只看：

- `issues/`
- `.msgcode/dispatch/`
- `.msgcode/subagents/`
- workspace 内真实产物路径

I/O 相关日志和回执，只作为证据，不升级成第二状态层。

## 当前阶段口径

第一阶段只收：

- Feishu 输入事件归一化
- Feishu 文本/文件/图片发送交付
- 真实回执与失败保真

不收：

- 多通道统一抽象平台
- 通道级调度
- 通道级任务状态机

## 一句话

I/O 系统不是“消息中台”。

它只是：

- 把世界的输入变成事件
- 把系统的结果变成可验证交付
