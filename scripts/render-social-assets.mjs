import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = join(root, "docs/images/social");
const W = 1242;
const H = 1660;
const dark = "#101012";
const cream = "#f2f2f3";
const ink = "#18181a";
const mutedDark = "#9a9aa0";
const mutedLight = "#696970";
const accent = "#3a3a3f";
const green = "#78a88a";

const assets = {
  overview: join(root, "docs/images/threadlight-overview.png"),
  agents: join(root, "docs/images/threadlight-multi-agent.png"),
  plan: join(root, "docs/images/threadlight-plan-mode.png"),
  terminal: join(root, "docs/images/threadlight-terminal-workspace.png"),
  incidentProcess: join(
    root,
    "docs/images/showcase/incident-replay-lab.png",
  ),
  incidentResult: join(
    root,
    "docs/images/showcase/incident-replay-lab-result.png",
  ),
};

const posts = [
  {
    id: "01-visible-work",
    pages: [
      {
        kind: "cover",
        eyebrow: "我做了一个开源 Agent Runtime",
        title: ["我受够了 AI", "干完活只回一句", "「好了」"],
        accentLine: 2,
        body: ["代码改了什么？命令跑没跑？", "它找了谁帮忙？为什么说完成？"],
        footer: "所以我做了 Threadlight →",
      },
      {
        kind: "statement",
        eyebrow: "01 · 真正的问题",
        title: ["让我不安的", "不是 AI 会不会写代码"],
        titleSize: 78,
        body: ["而是当任务跨过很多轮模型调用，", "过程开始变成一团看不见的黑箱。"],
        bullets: [
          ["01", "计划", "它准备怎么做？"],
          ["02", "执行", "调用了什么工具？"],
          ["03", "交付", "结果真的验证过吗？"],
        ],
        theme: "light",
      },
      {
        kind: "image",
        eyebrow: "02 · 把过程摊开",
        title: ["一条任务线", "看见完整工程过程"],
        body: ["Plan、Agent、工具、终端、文件和 Diff，", "都留在产生它们的同一个任务里。"],
        image: assets.overview,
        tags: ["PLAN", "AGENTS", "TOOLS", "DIFF"],
      },
      {
        kind: "statement",
        eyebrow: "03 · 不只是多开聊天窗",
        title: ["多 Agent", "应该是 Runtime 行为"],
        body: ["委派不是复制一段 Prompt。", "它需要真实的生命周期和恢复能力。"],
        bullets: [
          ["A", "连续线程", "follow-up 保留自己的上下文"],
          ["B", "写入所有权", "避免多个 Agent 同时改坏工作区"],
          ["C", "可恢复状态", "中断后继续，而不是重新讲一遍"],
        ],
        theme: "light",
      },
      {
        kind: "image",
        eyebrow: "04 · 真正并行，也保持掌控",
        title: ["让不同 Agent", "各自负责一块工作"],
        body: ["研究可以并行；写入只有一个所有者。", "父 Agent 收齐结果后才能结束任务。"],
        image: assets.agents,
        tags: ["DELEGATE", "MESSAGE", "WAIT", "RECOVER"],
      },
      {
        kind: "cta",
        eyebrow: "OPEN SOURCE · APACHE-2.0",
        title: ["Threadlight", "已经开源"],
        body: ["macOS 桌面端 · Web 客户端 · 自部署 Host", "Provider-neutral · 可观察 · 可恢复"],
        command: "threadlight.xyz",
        question: "你最想让它接住哪一种长任务？",
      },
    ],
  },
  {
    id: "02-five-signals",
    pages: [
      {
        kind: "cover",
        eyebrow: "可以直接收藏的 Agent 验收清单",
        title: ["让 AI 改大项目", "我只看这", "5 类证据"],
        accentLine: 2,
        body: ["不是看它说得多自信，", "是看完整过程能不能被复查。"],
        footer: "第 5 条最容易被忽略 →",
      },
      {
        kind: "image",
        eyebrow: "01 · PLAN",
        title: ["先看它有没有", "把任务拆明白"],
        body: ["步骤、验收标准、当前状态都要显式。", "没有完成证据，就不能把步骤改成 done。"],
        image: assets.plan,
        tags: ["研究", "结构化", "执行", "验证"],
        theme: "light",
      },
      {
        kind: "image",
        eyebrow: "02 · OWNERSHIP",
        title: ["再看并行任务", "有没有清楚的所有者"],
        body: ["谁研究、谁实现、谁审查，要能对上。", "并行不是把同一件事复制四份。"],
        image: assets.agents,
        tags: ["角色", "任务", "状态", "结果"],
      },
      {
        kind: "image",
        eyebrow: "03 · TOOL OUTPUT",
        title: ["命令真的跑过", "还是只说跑过？"],
        body: ["工具参数、输出、耗时和错误都应可见。", "失败之后做了什么，也要留痕。"],
        image: assets.terminal,
        tags: ["COMMAND", "OUTPUT", "ERROR", "DURATION"],
      },
      {
        kind: "image",
        eyebrow: "04 · FILES & DIFF",
        title: ["最后答案不重要", "真实变更才重要"],
        body: ["文件列表、聚焦 Diff、工作区状态，", "要和 Agent 的结论互相印证。"],
        image: assets.overview,
        tags: ["FILES", "DIFF", "REVIEW", "WORKTREE"],
        theme: "light",
      },
      {
        kind: "statement",
        eyebrow: "05 · RECOVERY",
        title: ["最容易漏掉的证据：", "中断后能不能继续"],
        body: ["长任务一定会遇到网络断开、模型中止、", "应用重启。恢复能力不是锦上添花。"],
        bullets: [
          ["✓", "对话", "消息和进度还在"],
          ["✓", "Agent 树", "父子关系和状态还在"],
          ["✓", "模型状态", "工具调用链路没有断"],
        ],
      },
      {
        kind: "cta",
        eyebrow: "我的验收顺序",
        title: ["Plan → Agent → Tool", "→ Diff → Recovery"],
        body: ["这套检查被我做进了 Threadlight。", "开源，不绑定单一模型厂商。"],
        command: "github.com/nagisa77/threadlight",
        question: "收藏备用，也欢迎补充你的第 6 条。",
      },
    ],
  },
  {
    id: "03-incident-replay",
    pages: [
      {
        kind: "cover",
        eyebrow: "这不是设计稿，是 Agent 跑出来的结果",
        title: ["只给一句需求", "它做出了", "事故回放沙盘"],
        accentLine: 2,
        body: ["服务拓扑、实时指标、事件流、时间轴，", "还有自动复盘报告。"],
        footer: "往后看完整过程 →",
      },
      {
        kind: "quote",
        eyebrow: "01 · INPUT",
        title: ["我只给了这一段 Query"],
        quote: [
          "“从零创建 incident-replay-lab：",
          "制作可播放的电商线上事故沙盘，",
          "包含服务拓扑、实时指标、事件流、",
          "时间轴和自动复盘。”",
        ],
        body: ["没有准备项目骨架，也没有逐页 UI 说明。"],
        theme: "light",
      },
      {
        kind: "image",
        eyebrow: "02 · PROCESS",
        title: ["先拆任务，再并行推进"],
        body: ["研究、实现、运行、验证不是一条隐藏链路。", "每个 Agent 的任务和输出都能单独展开。"],
        image: assets.incidentProcess,
        tags: ["DELEGATE", "BUILD", "RUN", "VERIFY"],
      },
      {
        kind: "image",
        eyebrow: "03 · RESULT",
        title: ["结果不是一张", "“看起来完成了”的截图"],
        body: ["它是可播放、可筛选、可制造故障的", "确定性事故模拟器。"],
        image: assets.incidentResult,
        tags: ["PLAYBACK", "METRICS", "TIMELINE", "POSTMORTEM"],
        theme: "light",
      },
      {
        kind: "statement",
        eyebrow: "04 · 为什么我留下这个案例",
        title: ["漂亮不是重点", "可复查才是"],
        body: ["我更在意：最终界面里的每一块能力，", "能不能在任务时间线上找到过程证据。"],
        bullets: [
          ["01", "服务拓扑", "对应故障传播关系"],
          ["02", "三通道指标", "对应事故阶段变化"],
          ["03", "时间轴与复盘", "对应可重复的状态机"],
        ],
      },
      {
        kind: "cta",
        eyebrow: "THREADLIGHT SHOWCASE",
        title: ["不是一次抽中好结果", "是过程可以被复盘"],
        body: ["Threadlight 已开源。官网也放了这个案例", "以及地震观察站、地铁运行沙盘。"],
        command: "threadlight.xyz",
        question: "下一次想看它从零做什么？",
      },
    ],
  },
];

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function textLines(lines, x, y, options = {}) {
  const {
    size = 72,
    lineHeight = Math.round(size * 1.15),
    color = cream,
    weight = 700,
    letter = -2,
    accentLine = -1,
    anchor = "start",
  } = options;
  return lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${y + index * lineHeight}" fill="${index === accentLine ? accent : color}" font-family="PingFang SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif" font-size="${size}" font-weight="${weight}" letter-spacing="${letter}" text-anchor="${anchor}">${escapeXml(line)}</text>`,
    )
    .join("");
}

function brand(page, total, isLight) {
  const color = isLight ? ink : cream;
  return `
    <g transform="translate(72 62)">
      <rect width="42" height="42" rx="12" fill="${isLight ? ink : cream}"/>
      <path d="M12 21h18M21 12v18M14.5 14.5l13 13M27.5 14.5l-13 13" stroke="${accent}" stroke-width="2" stroke-linecap="round" opacity=".88"/>
      <text x="58" y="30" fill="${color}" font-family="Inter, PingFang SC, sans-serif" font-size="24" font-weight="700" letter-spacing="-0.6">Threadlight</text>
    </g>
    <text x="1170" y="91" fill="${isLight ? mutedLight : mutedDark}" font-family="ui-monospace, monospace" font-size="18" text-anchor="end">${String(page).padStart(2, "0")} / ${String(total).padStart(2, "0")}</text>`;
}

function grid(isLight) {
  const stroke = isLight ? "#171815" : "#ffffff";
  return `<g opacity="${isLight ? 0.045 : 0.055}">${Array.from({ length: 18 }, (_, i) => `<path d="M${i * 78} 0V1660" stroke="${stroke}"/>`).join("")}${Array.from({ length: 23 }, (_, i) => `<path d="M0 ${i * 78}H1242" stroke="${stroke}"/>`).join("")}</g>`;
}

function eyebrow(value, isLight) {
  return `<path d="M72 180h34" stroke="${accent}" stroke-width="3"/><text x="122" y="187" fill="${accent}" font-family="ui-monospace, PingFang SC, monospace" font-size="19" font-weight="700" letter-spacing="2.4">${escapeXml(value.toUpperCase())}</text>`;
}

async function embeddedImage(path, x, y, width, height, id) {
  const data = (await readFile(path)).toString("base64");
  return `<defs><clipPath id="${id}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="18"/></clipPath></defs><image href="data:image/png;base64,${data}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="18" fill="none" stroke="${accent}" stroke-opacity=".32" stroke-width="2"/>`;
}

function tags(values, y, isLight) {
  let x = 72;
  return values
    .map((value) => {
      const width = Math.max(116, value.length * 14 + 42);
      const item = `<rect x="${x}" y="${y}" width="${width}" height="44" rx="22" fill="${isLight ? "#171815" : "#ffffff"}" fill-opacity="${isLight ? ".06" : ".07"}" stroke="${isLight ? "#171815" : "#ffffff"}" stroke-opacity=".12"/><text x="${x + width / 2}" y="${y + 28}" fill="${isLight ? mutedLight : "#b7b5ad"}" font-family="ui-monospace, PingFang SC, monospace" font-size="15" font-weight="700" letter-spacing="1" text-anchor="middle">${escapeXml(value)}</text>`;
      x += width + 12;
      return item;
    })
    .join("");
}

function bulletRows(items, startY, isLight) {
  return items
    .map(([number, title, body], index) => {
      const y = startY + index * 190;
      return `<g><path d="M72 ${y - 38}H1170" stroke="${isLight ? "#171815" : "#ffffff"}" stroke-opacity=".13"/><text x="74" y="${y + 16}" fill="${accent}" font-family="ui-monospace, monospace" font-size="20" font-weight="700">${escapeXml(number)}</text><text x="156" y="${y + 14}" fill="${isLight ? ink : cream}" font-family="PingFang SC, sans-serif" font-size="31" font-weight="700">${escapeXml(title)}</text><text x="156" y="${y + 64}" fill="${isLight ? mutedLight : mutedDark}" font-family="PingFang SC, sans-serif" font-size="23">${escapeXml(body)}</text></g>`;
    })
    .join("");
}

async function renderPage(page, pageIndex, total) {
  const isLight = page.theme === "light";
  const background = isLight ? cream : dark;
  let body = `${grid(isLight)}${brand(pageIndex, total, isLight)}${eyebrow(page.eyebrow, isLight)}`;

  if (page.kind === "cover") {
    body += `<circle cx="1060" cy="370" r="330" fill="${accent}" opacity=".12"/><path d="M72 1200H1170" stroke="#fff" stroke-opacity=".12"/>`;
    body += textLines(page.title, 72, 380, {
      size: 96,
      lineHeight: 114,
      accentLine: page.accentLine,
      letter: -4,
    });
    body += textLines(page.body, 76, 790, {
      size: 28,
      lineHeight: 46,
      color: mutedDark,
      weight: 450,
      letter: 0,
    });
    body += `<rect x="72" y="1280" width="1098" height="186" rx="28" fill="#fff" fill-opacity=".055" stroke="#fff" stroke-opacity=".12"/><text x="110" y="1360" fill="${accent}" font-family="ui-monospace, monospace" font-size="17" font-weight="700" letter-spacing="2">THREADLIGHT / OPEN SOURCE</text><text x="110" y="1422" fill="${cream}" font-family="PingFang SC, sans-serif" font-size="29" font-weight="650">${escapeXml(page.footer)}</text>`;
  } else if (page.kind === "statement") {
    body += textLines(page.title, 72, 330, {
      size: page.titleSize ?? 82,
      lineHeight: 98,
      color: isLight ? ink : cream,
      letter: -3,
    });
    body += textLines(page.body, 76, 590, {
      size: 28,
      lineHeight: 45,
      color: isLight ? mutedLight : mutedDark,
      weight: 450,
      letter: 0,
    });
    body += bulletRows(page.bullets, 890, isLight);
  } else if (page.kind === "image") {
    body += textLines(page.title, 72, 310, {
      size: 72,
      lineHeight: 86,
      color: isLight ? ink : cream,
      letter: -3,
    });
    body += textLines(page.body, 76, 505, {
      size: 26,
      lineHeight: 42,
      color: isLight ? mutedLight : mutedDark,
      weight: 450,
      letter: 0,
    });
    body += await embeddedImage(
      page.image,
      72,
      660,
      1098,
      760,
      `clip-${pageIndex}`,
    );
    body += tags(page.tags, 1460, isLight);
  } else if (page.kind === "quote") {
    body += textLines(page.title, 72, 320, {
      size: 78,
      lineHeight: 92,
      color: isLight ? ink : cream,
      letter: -3,
    });
    body += `<rect x="72" y="510" width="1098" height="620" rx="32" fill="${isLight ? ink : cream}" fill-opacity="${isLight ? ".05" : ".06"}" stroke="${accent}" stroke-opacity=".35" stroke-width="2"/>`;
    body += textLines(page.quote, 120, 635, {
      size: 39,
      lineHeight: 76,
      color: isLight ? ink : cream,
      weight: 620,
      letter: -1,
    });
    body += textLines(page.body, 76, 1280, {
      size: 28,
      lineHeight: 44,
      color: isLight ? mutedLight : mutedDark,
      weight: 450,
      letter: 0,
    });
  } else if (page.kind === "cta") {
    body += `<circle cx="621" cy="690" r="420" fill="${accent}" opacity=".11"/><circle cx="621" cy="690" r="290" fill="none" stroke="${accent}" stroke-opacity=".18"/><circle cx="621" cy="690" r="170" fill="none" stroke="${accent}" stroke-opacity=".25"/>`;
    body += textLines(page.title, 621, 500, {
      size: 86,
      lineHeight: 104,
      color: cream,
      letter: -4,
      anchor: "middle",
    });
    body += textLines(page.body, 621, 790, {
      size: 27,
      lineHeight: 45,
      color: mutedDark,
      weight: 450,
      letter: 0,
      anchor: "middle",
    });
    body += `<rect x="136" y="1040" width="970" height="116" rx="24" fill="#fff" fill-opacity=".065" stroke="#fff" stroke-opacity=".14"/><circle cx="190" cy="1098" r="8" fill="${green}"/><text x="224" y="1110" fill="${cream}" font-family="ui-monospace, PingFang SC, monospace" font-size="26" font-weight="650">${escapeXml(page.command)}</text><text x="621" y="1328" fill="${accent}" font-family="PingFang SC, sans-serif" font-size="31" font-weight="650" text-anchor="middle">${escapeXml(page.question)}</text>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${background}"/>${body}</svg>`;
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

await mkdir(outputRoot, { recursive: true });
for (const post of posts) {
  const postRoot = join(outputRoot, post.id);
  await mkdir(postRoot, { recursive: true });
  for (const [index, page] of post.pages.entries()) {
    const output = join(postRoot, `${String(index + 1).padStart(2, "0")}.png`);
    await sharp(await renderPage(page, index + 1, post.pages.length))
      .withMetadata({ density: 144 })
      .toFile(output);
  }
  console.log(`Rendered ${post.pages.length} pages to ${postRoot}`);
}
