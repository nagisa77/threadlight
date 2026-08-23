# 我受够了 AI 干完活只回一句「好了」

做 AI 编程工具越久，我越不在意它能不能一口气写很多代码。

真正让我不放心的是：任务一长，Plan 在哪、谁改了文件、命令到底跑没跑、测试是不是真的通过，最后常常只剩一句「完成了」。

所以我做了 Threadlight。

它不是把几个聊天窗口并排，而是把多 Agent 协作做成 Runtime 行为：每个子 Agent 有持续线程；写工作区时只有一个所有者；对话、Agent 树和模型状态都可以恢复。

同一条任务时间线上，可以直接看到 Plan、Agent、Tool / Terminal、Files / Diff 和最终交付。

目前有 macOS 桌面端、Web 客户端和可自部署的 Host。核心保持 Provider-neutral，不把某家模型的协议写死在 Agent Loop 里。

项目已经按 Apache-2.0 开源：threadlight.xyz，GitHub 搜 nagisa77/threadlight。

先说清楚边界：它不是安全沙箱，内置工具使用当前用户权限；放到重要环境之前，仍然需要自己评估权限和隔离。

如果你也在做长任务 Agent，你最想先解决哪一个问题：过程不可见、任务不可恢复，还是多个 Agent 同时乱改？
