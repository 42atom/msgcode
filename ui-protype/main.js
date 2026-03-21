const navItems = document.querySelectorAll("[data-view]");
const panels = document.querySelectorAll("[data-view-panel]");

const workspaceTree = document.getElementById("workspace-tree");
const threadTitle = document.getElementById("thread-title");
const threadChannelChip = document.getElementById("thread-channel-chip");
const threadKindChip = document.getElementById("thread-kind-chip");
const chatLog = document.getElementById("chat-log");
const observerTitle = document.getElementById("observer-title");
const workStatusLine1 = document.getElementById("work-status-line-1");
const workStatusLine2 = document.getElementById("work-status-line-2");
const observerSecondaryTitle = document.getElementById("observer-secondary-title");
const observerSecondaryContent = document.getElementById("observer-secondary-content");
const sendButton = document.getElementById("send-button");
const composerInput = document.getElementById("composer-input");
const composerStatus = document.getElementById("composer-status");
const composerCommandPreview = document.getElementById("composer-command-preview");
const observerPanel = document.getElementById("observer-panel");
const observerToggle = document.getElementById("observer-toggle");
const observerClose = document.getElementById("observer-close");
const newChatButton = document.getElementById("new-chat-button");

const WORKSPACE_ORDER_STORAGE_KEY = "msgcode-ui-workspace-order";

const familySchedules = [
  {
    id: "pick-up-kids",
    enabled: true,
    cron: "45 11 * * 1-5",
    tz: "Asia/Shanghai",
    message: "通知用户 ⏰ 中午要接小孩回家了",
  },
  {
    id: "send-kids-school",
    enabled: true,
    cron: "40 13 * * 1-5",
    tz: "Asia/Shanghai",
    message: "通知用户 ⏰: 1:40了该送小孩上学了",
  },
  {
    id: "pickup-kid",
    enabled: true,
    cron: "0 16 * * 1-5",
    tz: "Asia/Shanghai",
    message: "通知用户去学校接娃 ⏰: 放学接娃",
  },
];

const workspaceTreeData = {
  workspaceRoot: "/Users/admin/msgcode-workspaces",
  workspaces: [
    { key: "acme", name: "acme", threads: [] },
    { key: "artifacts", name: "artifacts", threads: [] },
    { key: "charai", name: "charai", threads: [] },
    {
      key: "default",
      name: "default",
      currentThreadId: "thread-default-reminder",
      threads: [
        {
          threadId: "thread-default-reminder",
          title: "以后所有定时提醒文字内容前面加一个‘⏰’,这样",
          source: "feishu",
          lastTurnAt: "2026-03-18T08:20:00.000Z",
        },
        {
          threadId: "thread-default-hi",
          title: "hi",
          source: "feishu",
          lastTurnAt: "2026-03-17T02:10:00.000Z",
        },
      ],
    },
    {
      key: "family",
      name: "family",
      currentThreadId: "thread-family-door",
      peopleCount: 2,
      open: true,
      threads: [
        {
          threadId: "thread-family-door",
          title: "我在门口准备好了",
          source: "feishu",
          lastTurnAt: "2026-03-20T05:43:18.204Z",
        },
        {
          threadId: "thread-family-missed-reminder",
          title: "今天为什么没有提醒我",
          source: "feishu",
          lastTurnAt: "2026-03-19T02:14:00.000Z",
        },
        {
          threadId: "thread-family-vision",
          title: "@_user_1 你看看这个小朋友的视力检查结果",
          source: "feishu",
          lastTurnAt: "2026-03-17T07:10:00.000Z",
        },
        {
          threadId: "thread-family-copy-edit",
          title: "145了该接小孩了",
          source: "feishu",
          lastTurnAt: "2026-03-16T11:30:00.000Z",
        },
      ],
    },
    {
      key: "game01",
      name: "game01",
      currentThreadId: "thread-game01-smoke",
      threads: [
        {
          threadId: "thread-game01-smoke",
          title: "【SMOKE-SKILL-1771572317】-2",
          source: "feishu",
          lastTurnAt: "2026-03-14T10:00:00.000Z",
        },
      ],
    },
    {
      key: "medicpass",
      name: "medicpass",
      currentThreadId: "thread-medicpass-model",
      threads: [
        {
          threadId: "thread-medicpass-model",
          title: "你是什么模型",
          source: "feishu",
          lastTurnAt: "2026-03-13T01:30:00.000Z",
        },
      ],
    },
    { key: "mlx-whisper", name: "mlx-whisper", threads: [] },
    { key: "mycompany", name: "mycompany", threads: [] },
    {
      key: "mylife",
      name: "mylife",
      currentThreadId: "thread-mylife-update",
      threads: [
        {
          threadId: "thread-mylife-update",
          title: "之前是老代码 现在更新了",
          source: "feishu",
          lastTurnAt: "2026-03-10T08:15:00.000Z",
        },
      ],
    },
    { key: "r9-smoke-20260222-181939", name: "r9-smoke-20260222-181939", threads: [] },
    { key: "real-test", name: "real-test", threads: [] },
    { key: "skill-wpkg", name: "skill-wpkg", threads: [] },
    {
      key: "test-real",
      name: "test-real",
      currentThreadId: "thread-test-real-subagent",
      threads: [
        {
          threadId: "thread-test-real-subagent",
          title: "哥，先别实际委派。请读取 subagent 这个",
          source: "feishu",
          lastTurnAt: "2026-03-09T03:20:00.000Z",
        },
      ],
    },
  ],
};

const threadSurfaceData = {
  "family:thread-family-door": {
    workspacePath: "/Users/admin/msgcode-workspaces/family",
    threadId: "thread-family-door",
    thread: {
      threadId: "thread-family-door",
      title: "我在门口准备好了",
      source: "feishu",
      lastTurnAt: "2026-03-20T05:43:18.204Z",
      messages: [
        {
          turn: 1,
          at: "2026-03-20T05:41:18.204Z",
          user: "我在门口准备好了",
          assistant: "好的，Chandler的健康档案已经建好了。去接小孩的路上注意安全。",
        },
        {
          turn: 2,
          at: "2026-03-20T05:43:18.204Z",
          user: "好",
          assistant: "好的，路上慢点。",
        },
      ],
      chatId: "feishu:family:door",
    },
    people: { count: 2 },
    workStatus: {
      updatedAt: "2026-03-20T05:43:18.204Z",
      currentThreadEntries: [
        {
          timestamp: "2026-03-20T05:43:18.204Z",
          thread: "我在门口准备好了",
          kind: "state",
          summary: "已经出门，当前这条线只剩路上确认。",
          refPath: ".msgcode/threads/2026-03-20_feishu-door.md",
          refLine: 23,
          ref: ".msgcode/threads/2026-03-20_feishu-door.md#L23",
          raw: "",
        },
      ],
      recentEntries: [
        {
          timestamp: "2026-03-20T05:43:18.204Z",
          thread: "我在门口准备好了",
          kind: "state",
          summary: "已经出门，当前这条线只剩路上确认。",
          refPath: ".msgcode/threads/2026-03-20_feishu-door.md",
          refLine: 23,
          ref: ".msgcode/threads/2026-03-20_feishu-door.md#L23",
          raw: "",
        },
      ],
    },
    schedules: familySchedules,
  },
  "family:thread-family-missed-reminder": {
    workspacePath: "/Users/admin/msgcode-workspaces/family",
    threadId: "thread-family-missed-reminder",
    thread: {
      threadId: "thread-family-missed-reminder",
      title: "今天为什么没有提醒我",
      source: "feishu",
      lastTurnAt: "2026-03-19T02:14:00.000Z",
      messages: [
        {
          turn: 1,
          at: "2026-03-19T02:10:00.000Z",
          user: "今天为什么没有提醒我",
          assistant: "我查到了 pick-up-kids 的配置：周一至周五 11:45，消息是“通知用户 ⏰ 中午要接小孩回家了”，配置本身正常。",
        },
        {
          turn: 2,
          at: "2026-03-19T02:14:00.000Z",
          user: "帮我看看这个结果",
          assistant: "后续这条线又接上了一张眼科报告图片，话题开始从提醒排查转向报告解读。",
        },
      ],
      chatId: "feishu:family:missed-reminder",
    },
    people: { count: 2 },
    workStatus: {
      updatedAt: "2026-03-19T02:14:00.000Z",
      currentThreadEntries: [
        {
          timestamp: "2026-03-19T02:14:00.000Z",
          thread: "今天为什么没有提醒我",
          kind: "state",
          summary: "围绕接娃提醒未触发继续排查。",
          refPath: ".msgcode/status.log",
          refLine: 2,
          ref: ".msgcode/status.log#L2",
          raw: "",
        },
        {
          timestamp: "2026-03-19T02:15:00.000Z",
          thread: "今天为什么没有提醒我",
          kind: "decision",
          summary: "先看 schedules，再看运行日志。",
          refPath: ".msgcode/status.log",
          refLine: 3,
          ref: ".msgcode/status.log#L3",
          raw: "",
        },
      ],
      recentEntries: [
        {
          timestamp: "2026-03-19T02:15:00.000Z",
          thread: "今天为什么没有提醒我",
          kind: "decision",
          summary: "先看 schedules，再看运行日志。",
          refPath: ".msgcode/status.log",
          refLine: 3,
          ref: ".msgcode/status.log#L3",
          raw: "",
        },
        {
          timestamp: "2026-03-19T02:14:00.000Z",
          thread: "今天为什么没有提醒我",
          kind: "state",
          summary: "围绕接娃提醒未触发继续排查。",
          refPath: ".msgcode/status.log",
          refLine: 2,
          ref: ".msgcode/status.log#L2",
          raw: "",
        },
      ],
    },
    schedules: familySchedules.slice(0, 2),
  },
  "family:thread-family-vision": {
    workspacePath: "/Users/admin/msgcode-workspaces/family",
    threadId: "thread-family-vision",
    thread: {
      threadId: "thread-family-vision",
      title: "@_user_1 你看看这个小朋友的视力检查结果",
      source: "feishu",
      lastTurnAt: "2026-03-17T07:10:00.000Z",
      messages: [
        {
          turn: 1,
          at: "2026-03-17T06:48:00.000Z",
          user: "@_user_1 你看看这个小朋友的视力检查结果 给我一些建议 7岁小朋友",
          assistant: "先是把报告误解成右眼 300 度近视，后面又回到 DS / DC / AXIS 的解释，承认了前面的矛盾。",
        },
        {
          turn: 2,
          at: "2026-03-17T07:10:00.000Z",
          user: "@_user_1 你搜索一下相关信息 给出一个准确合理的信息 比如ds到底代表什么",
          assistant: "最后收口到 DS 是球镜度数，DC 是柱镜度数，AXIS 是散光轴位，并提醒要确认到底是裸眼还是矫正视力。",
        },
      ],
      chatId: "feishu:family:vision",
    },
    people: { count: 2 },
    workStatus: {
      updatedAt: "2026-03-17T07:10:00.000Z",
      currentThreadEntries: [
        {
          timestamp: "2026-03-17T07:10:00.000Z",
          thread: "@_user_1 你看看这个小朋友的视力检查结果",
          kind: "decision",
          summary: "DS/DC/AXIS 的解释已经收稳。",
          refPath: ".msgcode/status.log",
          refLine: 7,
          ref: ".msgcode/status.log#L7",
          raw: "",
        },
      ],
      recentEntries: [
        {
          timestamp: "2026-03-17T07:10:00.000Z",
          thread: "@_user_1 你看看这个小朋友的视力检查结果",
          kind: "decision",
          summary: "DS/DC/AXIS 的解释已经收稳。",
          refPath: ".msgcode/status.log",
          refLine: 7,
          ref: ".msgcode/status.log#L7",
          raw: "",
        },
      ],
    },
    schedules: [],
  },
  "family:thread-family-copy-edit": {
    workspacePath: "/Users/admin/msgcode-workspaces/family",
    threadId: "thread-family-copy-edit",
    thread: {
      threadId: "thread-family-copy-edit",
      title: "145了该接小孩了",
      source: "feishu",
      lastTurnAt: "2026-03-16T11:30:00.000Z",
      messages: [
        {
          turn: 1,
          at: "2026-03-16T11:20:00.000Z",
          user: "1:45了该接小孩了 这句话改成 ‘⏰中午要接小孩回家了’ 其他不变",
          assistant: "这条线先没定位到任务，后面才回到 3 个 schedules，并开始实际改文案。",
        },
        {
          turn: 2,
          at: "2026-03-16T11:30:00.000Z",
          user: "是⏰中午要接小孩回家了 ,不是 ⏰中午要接小孩回了家",
          assistant: "最后确认消息内容应为“⏰中午要接小孩回家了”。",
        },
      ],
      chatId: "feishu:family:copy-edit",
    },
    people: { count: 2 },
    workStatus: {
      updatedAt: "2026-03-16T11:30:00.000Z",
      currentThreadEntries: [
        {
          timestamp: "2026-03-16T11:30:00.000Z",
          thread: "145了该接小孩了",
          kind: "decision",
          summary: "接娃提醒文案已改成“⏰中午要接小孩回家了”。",
          refPath: ".msgcode/status.log",
          refLine: 8,
          ref: ".msgcode/status.log#L8",
          raw: "",
        },
      ],
      recentEntries: [
        {
          timestamp: "2026-03-16T11:30:00.000Z",
          thread: "145了该接小孩了",
          kind: "decision",
          summary: "接娃提醒文案已改成“⏰中午要接小孩回家了”。",
          refPath: ".msgcode/status.log",
          refLine: 8,
          ref: ".msgcode/status.log#L8",
          raw: "",
        },
      ],
    },
    schedules: familySchedules.slice(0, 1),
  },
  "default:thread-default-reminder": {
    workspacePath: "/Users/admin/msgcode-workspaces/default",
    threadId: "thread-default-reminder",
    thread: {
      threadId: "thread-default-reminder",
      title: "以后所有定时提醒文字内容前面加一个‘⏰’,这样",
      source: "feishu",
      lastTurnAt: "2026-03-18T08:20:00.000Z",
      messages: [
        {
          turn: 1,
          at: "2026-03-18T08:20:00.000Z",
          user: "以后所有定时提醒文字内容前面加一个‘⏰’,这样更醒目。",
          assistant: "收到，这条线主要围绕提醒文案的统一调整。",
        },
      ],
      chatId: "feishu:default:reminder",
    },
    people: { count: 0 },
    workStatus: {
      updatedAt: "2026-03-18T08:20:00.000Z",
      currentThreadEntries: [],
      recentEntries: [],
    },
    schedules: [
      {
        id: "pick-up-kids",
        enabled: true,
        cron: "45 11 * * 1-5",
        tz: "Asia/Shanghai",
        message: "文案统一调整为带 ⏰ 前缀",
      },
    ],
  },
  "default:thread-default-hi": {
    workspacePath: "/Users/admin/msgcode-workspaces/default",
    threadId: "thread-default-hi",
    thread: {
      threadId: "thread-default-hi",
      title: "hi",
      source: "feishu",
      lastTurnAt: "2026-03-17T02:10:00.000Z",
      messages: [
        {
          turn: 1,
          at: "2026-03-17T02:10:00.000Z",
          user: "hi",
          assistant: "你好。",
        },
      ],
      chatId: "feishu:default:hi",
    },
    people: { count: 0 },
    workStatus: {
      updatedAt: "",
      currentThreadEntries: [],
      recentEntries: [],
    },
    schedules: [],
  },
  "game01:thread-game01-smoke": {
    workspacePath: "/Users/admin/msgcode-workspaces/game01",
    threadId: "thread-game01-smoke",
    thread: {
      threadId: "thread-game01-smoke",
      title: "【SMOKE-SKILL-1771572317】-2",
      source: "feishu",
      lastTurnAt: "2026-03-14T10:00:00.000Z",
      messages: [
        {
          turn: 1,
          at: "2026-03-14T10:00:00.000Z",
          user: "【SMOKE-SKILL-1771572317】-2",
          assistant: "这是一条 smoke 线程，占位展示。后续应通过 archive 收起来。",
        },
      ],
      chatId: "feishu:game01:smoke",
    },
    people: { count: 0 },
    workStatus: {
      updatedAt: "2026-03-14T10:00:00.000Z",
      currentThreadEntries: [],
      recentEntries: [
        {
          timestamp: "2026-03-14T10:00:00.000Z",
          thread: "【SMOKE-SKILL-1771572317】-2",
          kind: "state",
          summary: "这类冒烟线程是 archive 的典型目标。",
          refPath: ".msgcode/status.log",
          refLine: 1,
          ref: ".msgcode/status.log#L1",
          raw: "",
        },
      ],
    },
    schedules: [],
  },
  "medicpass:thread-medicpass-model": {
    workspacePath: "/Users/admin/msgcode-workspaces/medicpass",
    threadId: "thread-medicpass-model",
    thread: {
      threadId: "thread-medicpass-model",
      title: "你是什么模型",
      source: "feishu",
      lastTurnAt: "2026-03-13T01:30:00.000Z",
      messages: [
        {
          turn: 1,
          at: "2026-03-13T01:30:00.000Z",
          user: "你是什么模型",
          assistant: "这里先只模拟线程，不展开正文。",
        },
      ],
      chatId: "feishu:medicpass:model",
    },
    people: { count: 0 },
    workStatus: {
      updatedAt: "",
      currentThreadEntries: [],
      recentEntries: [],
    },
    schedules: [],
  },
  "mylife:thread-mylife-update": {
    workspacePath: "/Users/admin/msgcode-workspaces/mylife",
    threadId: "thread-mylife-update",
    thread: {
      threadId: "thread-mylife-update",
      title: "之前是老代码 现在更新了",
      source: "feishu",
      lastTurnAt: "2026-03-10T08:15:00.000Z",
      messages: [
        {
          turn: 1,
          at: "2026-03-10T08:15:00.000Z",
          user: "之前是老代码 现在更新了",
          assistant: "这条线先保留成工作区树中的真实标题示意。",
        },
      ],
      chatId: "feishu:mylife:update",
    },
    people: { count: 0 },
    workStatus: {
      updatedAt: "",
      currentThreadEntries: [],
      recentEntries: [],
    },
    schedules: [],
  },
  "test-real:thread-test-real-subagent": {
    workspacePath: "/Users/admin/msgcode-workspaces/test-real",
    threadId: "thread-test-real-subagent",
    thread: {
      threadId: "thread-test-real-subagent",
      title: "哥，先别实际委派。请读取 subagent 这个",
      source: "feishu",
      lastTurnAt: "2026-03-09T03:20:00.000Z",
      messages: [
        {
          turn: 1,
          at: "2026-03-09T03:20:00.000Z",
          user: "哥，先别实际委派。请读取 subagent 这个",
          assistant: "这是一条 test-real 工作区的历史线程示意。",
        },
      ],
      chatId: "feishu:test-real:subagent",
    },
    people: { count: 0 },
    workStatus: {
      updatedAt: "",
      currentThreadEntries: [],
      recentEntries: [],
    },
    schedules: [],
  },
};

let selectedWorkspaceKey = "family";
let selectedThreadId = "thread-family-door";
let pendingDraftContext = null;

function quoteCliArg(value) {
  return `'${String(value ?? "").replaceAll("'", `'\\''`)}'`;
}

function buildSurfaceKey(workspaceKey, threadId) {
  return `${workspaceKey}:${threadId}`;
}

function getSelectedSurface() {
  return threadSurfaceData[buildSurfaceKey(selectedWorkspaceKey, selectedThreadId)] ?? null;
}

function getSelectedWorkspace() {
  return workspaceTreeData.workspaces.find((workspace) => workspace.key === selectedWorkspaceKey) ?? null;
}

function buildInboxAddCommand() {
  const text = composerInput?.value || "";
  const surface = getSelectedSurface();
  const source = surface?.thread?.source || "";
  const workspaceArg = quoteCliArg(selectedWorkspaceKey);
  const textArg = quoteCliArg(text);

  if (pendingDraftContext) {
    return `msgcode inbox add --workspace ${workspaceArg} --chat-id ${quoteCliArg(pendingDraftContext.chatId)} --text ${textArg} --transport web --json`;
  }

  if (source === "web" && surface?.thread?.chatId) {
    return `msgcode inbox add --workspace ${workspaceArg} --chat-id ${quoteCliArg(surface.thread.chatId)} --text ${textArg} --transport web --json`;
  }

  return "";
}

function renderComposerSurface() {
  const surface = getSelectedSurface();
  const source = surface?.thread?.source || "";
  const command = buildInboxAddCommand();

  if (composerStatus) {
    if (pendingDraftContext) {
      composerStatus.textContent = "当前是新的 web chatId 草稿上下文；首条消息会先进入 inbox，再由 runtime 落盘成 thread。";
    } else if (source === "web") {
      composerStatus.textContent = "当前输入会先投递到 runtime inbox；只有 runtime 落盘后，消息才会上屏。";
    } else {
      composerStatus.textContent = "当前选中的是非 web 线程；网页输入前请先点“新建聊天”。";
    }
  }

  if (composerCommandPreview) {
    composerCommandPreview.textContent = command || "msgcode inbox add --workspace <workspace> --chat-id <new-web-chat-id> --text <text> --transport web --json";
  }
}

function renderThread() {
  if (pendingDraftContext && pendingDraftContext.workspaceKey === selectedWorkspaceKey && !selectedThreadId) {
    renderPendingDraftThread();
    return;
  }

  const surface = getSelectedSurface();
  const workspace = getSelectedWorkspace();
  const currentThreadId = workspace?.currentThreadId || "";
  const thread = surface?.thread ?? null;

  if (threadTitle) {
    threadTitle.textContent = thread?.title || "未找到线程";
  }
  if (threadChannelChip) {
    threadChannelChip.textContent = thread?.source || "unknown";
  }
  if (threadKindChip) {
    threadKindChip.textContent = selectedThreadId === currentThreadId ? "当前线程" : "历史线程";
  }
  if (observerTitle) {
    observerTitle.textContent = thread?.title || "工作状况";
  }

  const primaryEntries = surface?.workStatus.currentThreadEntries ?? [];
  const recentEntries = surface?.workStatus.recentEntries ?? [];
  const line1 = primaryEntries[0]?.summary || recentEntries[0]?.summary || "暂无工作状况。";
  const line2 = primaryEntries[1]?.summary
    || (surface?.workStatus.updatedAt ? `最近更新时间：${formatTime(surface.workStatus.updatedAt)}` : "");

  if (workStatusLine1) {
    workStatusLine1.textContent = line1;
    workStatusLine1.hidden = !line1;
  }
  if (workStatusLine2) {
    workStatusLine2.textContent = line2;
    workStatusLine2.hidden = !line2;
  }

  if (observerSecondaryTitle) {
    observerSecondaryTitle.textContent = surface && surface.schedules.length > 0 ? "日历 / 定时任务" : "最近工作状况";
  }
  if (observerSecondaryContent) {
    observerSecondaryContent.innerHTML = surface && surface.schedules.length > 0
      ? renderScheduleList(surface.schedules)
      : renderStatusList(recentEntries);
  }

  if (chatLog) {
    if (!thread) {
      chatLog.innerHTML = `
        <article class="bubble bubble--agent">
          当前线程不存在或已被归档。请从左侧重新选择活跃线程。
        </article>
      `;
      return;
    }

    const orderedMessages = [...thread.messages].sort((a, b) => a.turn - b.turn);
    chatLog.innerHTML = orderedMessages.map((message) => `
      <article class="bubble bubble--user">
        ${escapeHtml(message.user)}
      </article>
      <article class="bubble bubble--agent">
        ${escapeHtml(message.assistant)}
      </article>
    `).join("");
  }

  renderComposerSurface();
}

function renderPendingDraftThread() {
  if (threadTitle) {
    threadTitle.textContent = "新网页聊天";
  }
  if (threadChannelChip) {
    threadChannelChip.textContent = "web";
  }
  if (threadKindChip) {
    threadKindChip.textContent = "草稿上下文";
  }
  if (observerTitle) {
    observerTitle.textContent = "新网页聊天";
  }
  if (workStatusLine1) {
    workStatusLine1.textContent = "当前只是新的 web chatId 草稿上下文。";
    workStatusLine1.hidden = false;
  }
  if (workStatusLine2) {
    workStatusLine2.textContent = "首条消息发出并落盘后，才会进入左侧活跃线程列表。";
    workStatusLine2.hidden = false;
  }
  if (observerSecondaryTitle) {
    observerSecondaryTitle.textContent = "最近工作状况";
  }
  if (observerSecondaryContent) {
    observerSecondaryContent.innerHTML = renderStatusList([]);
  }
  if (chatLog) {
    chatLog.innerHTML = `
      <article class="bubble bubble--agent">
        这里还没有真正的 thread 文件。首条消息发送后，runtime 才会创建新的 web thread。
      </article>
    `;
  }

  renderComposerSurface();
}

function renderScheduleList(items) {
  if (items.length === 0) {
    return `
      <article class="schedule-item">
        <div>
          <p>暂无定时任务</p>
        </div>
      </article>
    `;
  }

  return items.map((item) => `
    <article class="schedule-item">
      <strong>${escapeHtml(formatCronHint(item.cron))}</strong>
      <div>
        <p>${escapeHtml(item.id)}</p>
        <small>${escapeHtml(item.message)}</small>
      </div>
    </article>
  `).join("");
}

function renderStatusList(entries) {
  if (entries.length === 0) {
    return `
      <article class="schedule-item">
        <div>
          <p>暂无共享近况</p>
        </div>
      </article>
    `;
  }

  return entries.map((entry) => `
    <article class="schedule-item">
      <strong>${escapeHtml(formatTime(entry.timestamp))}</strong>
      <div>
        <p>${escapeHtml(entry.kind)}</p>
        <small>${escapeHtml(entry.summary)}</small>
      </div>
    </article>
  `).join("");
}

function formatTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatCronHint(cron) {
  if (!cron) return "--";
  const parts = String(cron).split(" ");
  if (parts.length < 2) return cron;
  return `${String(parts[1]).padStart(2, "0")}:${String(parts[0]).padStart(2, "0")}`;
}

function applyStoredWorkspaceOrder() {
  if (!workspaceTree) return;
  try {
    const raw = window.localStorage.getItem(WORKSPACE_ORDER_STORAGE_KEY);
    if (!raw) return;
    const order = JSON.parse(raw);
    if (!Array.isArray(order)) return;
    const workspaceMap = new Map(workspaceTreeData.workspaces.map((workspace) => [workspace.key, workspace]));
    const next = [];
    for (const workspaceKey of order) {
      const workspace = workspaceMap.get(workspaceKey);
      if (workspace) {
        next.push(workspace);
        workspaceMap.delete(workspaceKey);
      }
    }
    for (const workspace of workspaceTreeData.workspaces) {
      if (workspaceMap.has(workspace.key)) next.push(workspace);
    }
    workspaceTreeData.workspaces = next;
  } catch (error) {
    console.warn("failed to restore workspace order", error);
  }
}

function saveWorkspaceOrder() {
  const order = workspaceTreeData.workspaces.map((item) => item.key);
  window.localStorage.setItem(WORKSPACE_ORDER_STORAGE_KEY, JSON.stringify(order));
}

function bindWorkspaceSorting() {
  if (!workspaceTree) return;
  if (workspaceTree.dataset.sortBound === "true") return;
  workspaceTree.dataset.sortBound = "true";

  let draggingWorkspace = null;

  const getDragAfterElement = (container, clientY) => {
    const draggableCards = [...container.querySelectorAll(".workspace-group:not(.is-dragging)")];
    return draggableCards.reduce(
      (closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = clientY - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
          return { offset, element: child };
        }
        return closest;
      },
      { offset: Number.NEGATIVE_INFINITY, element: null }
    ).element;
  };

  workspaceTree.addEventListener("dragstart", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const card = target.closest(".workspace-group");
    if (!(card instanceof HTMLElement)) return;
    draggingWorkspace = card;
    card.classList.add("is-dragging");
  });

  workspaceTree.addEventListener("dragend", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const card = target.closest(".workspace-group");
    if (!(card instanceof HTMLElement)) return;
    card.classList.remove("is-dragging");
    draggingWorkspace = null;
    syncWorkspaceOrderFromDom();
    saveWorkspaceOrder();
  });

  workspaceTree.addEventListener("toggle", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const card = target.closest(".workspace-group");
    if (!(card instanceof HTMLElement)) return;
    const workspaceKey = card.dataset.workspaceKey;
    if (!workspaceKey) return;
    const workspace = workspaceTreeData.workspaces.find((item) => item.key === workspaceKey);
    if (workspace) {
      workspace.open = card.open;
    }
  });

  workspaceTree.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (!draggingWorkspace) return;
    const afterElement = getDragAfterElement(workspaceTree, event.clientY);
    if (!afterElement) {
      workspaceTree.appendChild(draggingWorkspace);
      return;
    }
    workspaceTree.insertBefore(draggingWorkspace, afterElement);
  });
}

function syncWorkspaceOrderFromDom() {
  if (!workspaceTree) return;
  const order = Array.from(workspaceTree.querySelectorAll(".workspace-group"))
    .map((item) => item.dataset.workspaceKey)
    .filter(Boolean);

  workspaceTreeData.workspaces = order
    .map((key) => workspaceTreeData.workspaces.find((workspace) => workspace.key === key))
    .filter(Boolean);
}

function renderWorkspaceTree() {
  if (!workspaceTree) return;

  workspaceTree.innerHTML = workspaceTreeData.workspaces.map((workspace) => {
    const threads = workspace.threads.length > 0
      ? workspace.threads.map((thread) => `
          <article class="thread-list-item${thread.threadId === selectedThreadId ? " is-selected" : ""}" data-thread-id="${thread.threadId}" data-workspace-key="${workspace.key}">
            <div class="thread-list-item__head">
              <strong>${escapeHtml(thread.title)}</strong>
              <span>${escapeHtml(thread.source)}</span>
            </div>
          </article>
        `).join("")
      : `
          <article class="thread-list-item">
            <div class="thread-list-item__head">
              <strong>暂无线程</strong>
              <span>0</span>
            </div>
          </article>
        `;

    const peopleLink = workspace.peopleCount !== undefined
      ? `
        <a class="project-mini-link" href="./people.html" title="人物角色" aria-label="人物角色">
          <span class="project-mini-link__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 12a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7Z"></path>
              <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0"></path>
            </svg>
          </span>
          <span class="project-mini-link__count">${workspace.peopleCount}</span>
        </a>
      `
      : "";

    return `
      <details class="workspace-group${workspace.key === selectedWorkspaceKey ? " is-selected" : ""}" data-workspace-key="${workspace.key}" ${workspace.open ? "open" : ""}>
        <summary class="workspace-group__title">
          <span class="workspace-group__name">${escapeHtml(workspace.name)}</span>
          ${peopleLink}
        </summary>
        <div class="workspace-group__items">
          ${threads}
        </div>
      </details>
    `;
  }).join("");

  bindWorkspaceSorting();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

for (const item of navItems) {
  item.addEventListener("click", () => {
    const target = item.dataset.view;
    for (const current of navItems) current.classList.toggle("is-active", current === item);
    for (const panel of panels) panel.classList.toggle("view--active", panel.dataset.viewPanel === target);
  });
}

if (workspaceTree) {
  workspaceTree.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const threadItem = target.closest("[data-thread-id]");
    if (threadItem instanceof HTMLElement) {
      const threadId = threadItem.dataset.threadId;
      const workspaceKey = threadItem.dataset.workspaceKey;
      if (threadId) {
        selectedThreadId = threadId;
        if (workspaceKey) selectedWorkspaceKey = workspaceKey;
        pendingDraftContext = null;
        renderWorkspaceTree();
        renderThread();
      }
    }
  });
}

if (newChatButton && composerStatus) {
  newChatButton.addEventListener("click", () => {
    pendingDraftContext = {
      workspaceKey: selectedWorkspaceKey,
      chatId: `web:${selectedWorkspaceKey}:${Date.now()}`,
    };
    selectedThreadId = "";
    renderWorkspaceTree();
    renderThread();
  });
}

if (sendButton && composerStatus) {
  sendButton.addEventListener("click", () => {
    const command = buildInboxAddCommand();
    const surface = getSelectedSurface();
    const source = surface?.thread?.source || "";

    if (!command) {
      composerStatus.textContent = source === "web"
        ? "当前线程缺少稳定 chatId，暂时不能投递。"
        : "当前是非 web 线程；请先点“新建聊天”，再发给 Agent。";
      renderComposerSurface();
      return;
    }

    sendButton.setAttribute("disabled", "true");
    if (composerCommandPreview) {
      composerCommandPreview.textContent = command;
    }
    composerStatus.textContent = pendingDraftContext
      ? "已投递到新的 web chatId；等待 runtime 落盘后再出现在左侧线程树。"
      : "已投递到当前 web 线程 inbox；等待 runtime 回写后再上屏。";
    setTimeout(() => {
      sendButton.removeAttribute("disabled");
      renderComposerSurface();
    }, 1800);
  });
}

if (composerInput) {
  composerInput.addEventListener("input", () => {
    renderComposerSurface();
  });
}

if (observerToggle && observerPanel) {
  observerToggle.addEventListener("click", () => {
    observerPanel.classList.add("is-open");
  });
}

if (observerClose && observerPanel) {
  observerClose.addEventListener("click", () => {
    observerPanel.classList.remove("is-open");
  });
}

applyStoredWorkspaceOrder();
renderWorkspaceTree();
renderThread();
