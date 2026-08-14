import { defineMessageCatalog } from "./i18n.js";
import type {
  AutomationCadence,
  AutomationKind,
  AutomationRunStatus,
} from "./automations.js";

export const AUTOMATION_UI_COPY = defineMessageCatalog({
  "zh-CN": { search: "搜索已安排任务", suggestions: "建议" },
  "zh-TW": { search: "搜尋已排程工作", suggestions: "建議" },
  en: { search: "Search scheduled tasks", suggestions: "Suggestions" },
  ja: { search: "スケジュール済みタスクを検索", suggestions: "おすすめ" },
  ko: { search: "예약된 작업 검색", suggestions: "추천" },
});

export interface AutomationCopy {
  title: string;
  subtitle: string;
  newAutomation: string;
  loading: string;
  emptyTitle: string;
  emptyDescription: string;
  readyMade: string;
  useTemplate: string;
  blankTask: string;
  templateOptional: string;
  browseTemplates: string;
  templateCount: string;
  safetyNote: string;
  overviewStatus: string;
  runningNormally: string;
  allPaused: string;
  attentionSummary: string;
  enabledSummary: string;
  noUpcoming: string;
  filter: string;
  all: string;
  filterEmpty: string;
  openTask: string;
  runWithoutSummary: string;
  scheduleLabel: string;
  nextRun: string;
  paused: string;
  enabled: string;
  disabled: string;
  runNow: string;
  running: string;
  edit: string;
  delete: string;
  confirmDelete: string;
  cancel: string;
  dismiss: string;
  editAutomation: string;
  editorDescription: string;
  type: string;
  typeHint: string;
  taskDetails: string;
  taskDetailsHint: string;
  name: string;
  cadence: string;
  scheduleHint: string;
  time: string;
  weekday: string;
  hostTime: string;
  instructions: string;
  instructionsHint: string;
  enableAfterSave: string;
  enableAfterSaveHint: string;
  savePausedHint: string;
  saving: string;
  save: string;
  kind: Record<AutomationKind, string>;
  kindDescription: Record<AutomationKind, string>;
  defaultName: Record<AutomationKind, string>;
  cadenceLabel: Record<AutomationCadence, string>;
  status: Record<AutomationRunStatus, string>;
  weekdays: readonly string[];
}

export const AUTOMATION_COPY = defineMessageCatalog<AutomationCopy>({
  "zh-CN": {
    title: "已安排的任务",
    subtitle: "让 Threadlight 为 {project} 定时执行任务或监测更新。",
    newAutomation: "创建",
    loading: "正在读取自动化…",
    emptyTitle: "把重复检查交给 Threadlight",
    emptyDescription:
      "每次运行都会创建一个可审阅的任务；只有发现异常或运行失败时才发送系统通知。",
    readyMade: "从可靠模板开始",
    useTemplate: "使用模板",
    blankTask: "创建空白任务",
    templateOptional: "可选，不会限制任务内容",
    browseTemplates: "浏览任务模板",
    templateCount: "20 个常用场景",
    safetyNote: "自动化只执行只读检查，不会修改仓库或外部系统。",
    overviewStatus: "当前状态",
    runningNormally: "运行正常",
    allPaused: "所有任务已暂停",
    attentionSummary: "{count} 个任务需要关注",
    enabledSummary: "{enabled} / {total} 个任务已启用",
    noUpcoming: "暂无计划",
    filter: "筛选自动化",
    all: "全部",
    filterEmpty: "这里没有需要处理的自动化。",
    openTask: "查看任务",
    runWithoutSummary: "本次运行尚未生成摘要。",
    scheduleLabel: "执行计划",
    nextRun: "下一次运行",
    paused: "已暂停",
    enabled: "启用",
    disabled: "停用",
    runNow: "立即运行",
    running: "运行中",
    edit: "编辑自动化",
    delete: "删除自动化",
    confirmDelete: "确认删除",
    cancel: "取消",
    dismiss: "关闭",
    editAutomation: "编辑自动化",
    editorDescription: "设置运行节奏和交给 Agent 的只读检查说明。",
    type: "类型",
    typeHint: "选择模板，然后按项目需要调整",
    taskDetails: "任务内容",
    taskDetailsHint: "直接描述你希望 Agent 定期完成的工作",
    name: "名称",
    cadence: "频率",
    scheduleHint: "计划由当前连接的 Host 执行",
    time: "时间",
    weekday: "星期",
    hostTime: "Host 时区",
    instructions: "运行说明",
    instructionsHint: "运行时会自动追加只读约束和状态标记要求。",
    enableAfterSave: "保存后启用",
    enableAfterSaveHint: "保存后按计划自动运行",
    savePausedHint: "先保存为已暂停，稍后再启用",
    saving: "正在保存…",
    save: "保存自动化",
    kind: {
      custom: "自定义任务",
      tests: "测试",
      dependencies: "依赖检查",
      "issue-triage": "Issue 分诊",
    },
    kindDescription: {
      custom: "自由定义任务内容和检查目标",
      tests: "运行项目测试并定位失败",
      dependencies: "检查过期依赖和安全风险",
      "issue-triage": "整理优先级、重复项与阻塞项",
    },
    defaultName: {
      custom: "",
      tests: "定时测试",
      dependencies: "依赖健康检查",
      "issue-triage": "Issue 分诊",
    },
    cadenceLabel: {
      daily: "每天",
      weekdays: "工作日",
      weekly: "每周",
    },
    status: {
      running: "运行中",
      succeeded: "正常",
      attention: "需关注",
      failed: "失败",
    },
    weekdays: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"],
  },
  "zh-TW": {
    title: "已排程的工作",
    subtitle: "讓 Threadlight 為 {project} 定時執行工作或監測更新。",
    newAutomation: "建立",
    loading: "正在讀取自動化…",
    emptyTitle: "把重複檢查交給 Threadlight",
    emptyDescription:
      "每次執行都會建立可檢閱的工作；只有發現異常或執行失敗時才發送系統通知。",
    readyMade: "從可靠範本開始",
    useTemplate: "使用範本",
    blankTask: "建立空白工作",
    templateOptional: "選填，不會限制工作內容",
    browseTemplates: "瀏覽工作範本",
    templateCount: "20 個常用情境",
    safetyNote: "自動化只執行唯讀檢查，不會修改儲存庫或外部系統。",
    overviewStatus: "目前狀態",
    runningNormally: "執行正常",
    allPaused: "所有工作已暫停",
    attentionSummary: "{count} 個工作需要關注",
    enabledSummary: "{enabled} / {total} 個工作已啟用",
    noUpcoming: "暫無排程",
    filter: "篩選自動化",
    all: "全部",
    filterEmpty: "這裡沒有需要處理的自動化。",
    openTask: "查看工作",
    runWithoutSummary: "本次執行尚未產生摘要。",
    scheduleLabel: "執行排程",
    nextRun: "下次執行",
    paused: "已暫停",
    enabled: "啟用",
    disabled: "停用",
    runNow: "立即執行",
    running: "執行中",
    edit: "編輯自動化",
    delete: "刪除自動化",
    confirmDelete: "確認刪除",
    cancel: "取消",
    dismiss: "關閉",
    editAutomation: "編輯自動化",
    editorDescription: "設定執行節奏和交給 Agent 的唯讀檢查說明。",
    type: "類型",
    typeHint: "選擇範本，再依專案需求調整",
    taskDetails: "工作內容",
    taskDetailsHint: "直接描述希望 Agent 定期完成的工作",
    name: "名稱",
    cadence: "頻率",
    scheduleHint: "排程由目前連線的 Host 執行",
    time: "時間",
    weekday: "星期",
    hostTime: "Host 時區",
    instructions: "執行說明",
    instructionsHint: "執行時會自動附加唯讀限制與狀態標記要求。",
    enableAfterSave: "儲存後啟用",
    enableAfterSaveHint: "儲存後依排程自動執行",
    savePausedHint: "先儲存為已暫停，稍後再啟用",
    saving: "正在儲存…",
    save: "儲存自動化",
    kind: {
      custom: "自訂工作",
      tests: "測試",
      dependencies: "依賴檢查",
      "issue-triage": "Issue 分流",
    },
    kindDescription: {
      custom: "自由定義工作內容和檢查目標",
      tests: "執行專案測試並定位失敗",
      dependencies: "檢查過期依賴與安全風險",
      "issue-triage": "整理優先級、重複項與阻塞項",
    },
    defaultName: {
      custom: "",
      tests: "定時測試",
      dependencies: "依賴健康檢查",
      "issue-triage": "Issue 分流",
    },
    cadenceLabel: { daily: "每天", weekdays: "工作日", weekly: "每週" },
    status: {
      running: "執行中",
      succeeded: "正常",
      attention: "需關注",
      failed: "失敗",
    },
    weekdays: ["週日", "週一", "週二", "週三", "週四", "週五", "週六"],
  },
  en: {
    title: "Scheduled tasks",
    subtitle: "Let Threadlight run recurring tasks and monitor {project}.",
    newAutomation: "Create",
    loading: "Loading automations…",
    emptyTitle: "Hand repetitive checks to Threadlight",
    emptyDescription:
      "Every run creates a reviewable task. System notifications are sent only when a check needs attention or fails.",
    readyMade: "Start with a proven template",
    useTemplate: "Use template",
    blankTask: "Create blank task",
    templateOptional: "Optional — templates never limit the task",
    browseTemplates: "Browse task templates",
    templateCount: "20 common workflows",
    safetyNote:
      "Automations run read-only checks and never modify the repository or external systems.",
    overviewStatus: "Current status",
    runningNormally: "Running normally",
    allPaused: "All automations paused",
    attentionSummary: "{count} need attention",
    enabledSummary: "{enabled} of {total} enabled",
    noUpcoming: "Nothing scheduled",
    filter: "Filter automations",
    all: "All",
    filterEmpty: "There are no automations to review here.",
    openTask: "Open task",
    runWithoutSummary: "This run has not produced a summary yet.",
    scheduleLabel: "Schedule",
    nextRun: "Next run",
    paused: "Paused",
    enabled: "Enabled",
    disabled: "Disabled",
    runNow: "Run now",
    running: "Running",
    edit: "Edit automation",
    delete: "Delete automation",
    confirmDelete: "Delete",
    cancel: "Cancel",
    dismiss: "Dismiss",
    editAutomation: "Edit automation",
    editorDescription:
      "Set the schedule and the read-only instructions given to the agent.",
    type: "Type",
    typeHint: "Choose a template, then tailor it to the project",
    taskDetails: "Task details",
    taskDetailsHint: "Describe what the agent should complete on each run",
    name: "Name",
    cadence: "Cadence",
    scheduleHint: "The connected Host owns and runs this schedule",
    time: "Time",
    weekday: "Weekday",
    hostTime: "Host time zone",
    instructions: "Run instructions",
    instructionsHint:
      "Read-only constraints and a status marker are appended automatically.",
    enableAfterSave: "Enable after saving",
    enableAfterSaveHint: "Run automatically on the saved schedule",
    savePausedHint: "Save paused and enable it when you are ready",
    saving: "Saving…",
    save: "Save automation",
    kind: {
      custom: "Custom task",
      tests: "Tests",
      dependencies: "Dependency check",
      "issue-triage": "Issue triage",
    },
    kindDescription: {
      custom: "Define any recurring task or review goal",
      tests: "Run project tests and locate failures",
      dependencies: "Check outdated packages and security risks",
      "issue-triage": "Prioritize, deduplicate, and flag blockers",
    },
    defaultName: {
      custom: "",
      tests: "Scheduled tests",
      dependencies: "Dependency health check",
      "issue-triage": "Issue triage",
    },
    cadenceLabel: { daily: "Daily", weekdays: "Weekdays", weekly: "Weekly" },
    status: {
      running: "Running",
      succeeded: "Healthy",
      attention: "Attention",
      failed: "Failed",
    },
    weekdays: [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ],
  },
  ja: {
    title: "スケジュール済みタスク",
    subtitle: "Threadlight で {project} の定期タスクと監視を実行します。",
    newAutomation: "作成",
    loading: "自動化を読み込み中…",
    emptyTitle: "反復チェックを Threadlight に任せる",
    emptyDescription:
      "実行ごとに確認可能なタスクを作成し、問題または失敗がある場合のみ通知します。",
    readyMade: "実績あるテンプレートから開始",
    useTemplate: "テンプレートを使用",
    blankTask: "空のタスクを作成",
    templateOptional: "任意。タスク内容は制限されません",
    browseTemplates: "タスクテンプレートを見る",
    templateCount: "20 の一般的なワークフロー",
    safetyNote:
      "自動化は読み取り専用で、リポジトリや外部システムを変更しません。",
    overviewStatus: "現在の状態",
    runningNormally: "正常に稼働中",
    allPaused: "すべて一時停止中",
    attentionSummary: "{count} 件の確認が必要",
    enabledSummary: "{total} 件中 {enabled} 件が有効",
    noUpcoming: "予定なし",
    filter: "自動化を絞り込む",
    all: "すべて",
    filterEmpty: "確認が必要な自動化はありません。",
    openTask: "タスクを開く",
    runWithoutSummary: "この実行の概要はまだありません。",
    scheduleLabel: "実行予定",
    nextRun: "次回実行",
    paused: "一時停止",
    enabled: "有効",
    disabled: "無効",
    runNow: "今すぐ実行",
    running: "実行中",
    edit: "自動化を編集",
    delete: "自動化を削除",
    confirmDelete: "削除",
    cancel: "キャンセル",
    dismiss: "閉じる",
    editAutomation: "自動化を編集",
    editorDescription:
      "スケジュールと Agent に渡す読み取り専用の指示を設定します。",
    type: "種類",
    typeHint: "テンプレートを選び、プロジェクトに合わせて調整",
    taskDetails: "タスク内容",
    taskDetailsHint: "Agent が定期的に行う作業を直接記述します",
    name: "名前",
    cadence: "頻度",
    scheduleHint: "接続中の Host がスケジュールを実行します",
    time: "時刻",
    weekday: "曜日",
    hostTime: "Host タイムゾーン",
    instructions: "実行指示",
    instructionsHint:
      "読み取り専用制約とステータスマーカーは自動で追加されます。",
    enableAfterSave: "保存後に有効化",
    enableAfterSaveHint: "保存したスケジュールで自動実行",
    savePausedHint: "一時停止で保存し、準備後に有効化",
    saving: "保存中…",
    save: "自動化を保存",
    kind: {
      custom: "カスタムタスク",
      tests: "テスト",
      dependencies: "依存関係チェック",
      "issue-triage": "Issue トリアージ",
    },
    kindDescription: {
      custom: "任意の反復タスクや確認目標を定義",
      tests: "テストを実行して失敗箇所を特定",
      dependencies: "古い依存関係と安全性を確認",
      "issue-triage": "優先度、重複、ブロッカーを整理",
    },
    defaultName: {
      custom: "",
      tests: "定期テスト",
      dependencies: "依存関係ヘルスチェック",
      "issue-triage": "Issue トリアージ",
    },
    cadenceLabel: { daily: "毎日", weekdays: "平日", weekly: "毎週" },
    status: {
      running: "実行中",
      succeeded: "正常",
      attention: "要確認",
      failed: "失敗",
    },
    weekdays: [
      "日曜日",
      "月曜日",
      "火曜日",
      "水曜日",
      "木曜日",
      "金曜日",
      "土曜日",
    ],
  },
  ko: {
    title: "예약된 작업",
    subtitle: "Threadlight가 {project}의 반복 작업과 모니터링을 실행합니다.",
    newAutomation: "만들기",
    loading: "자동화 불러오는 중…",
    emptyTitle: "반복 검사를 Threadlight에 맡기세요",
    emptyDescription:
      "실행할 때마다 검토 가능한 작업을 만들고, 주의가 필요하거나 실패한 경우에만 알립니다.",
    readyMade: "검증된 템플릿으로 시작",
    useTemplate: "템플릿 사용",
    blankTask: "빈 작업 만들기",
    templateOptional: "선택 사항이며 작업 내용을 제한하지 않습니다",
    browseTemplates: "작업 템플릿 보기",
    templateCount: "20가지 일반 워크플로",
    safetyNote:
      "자동화는 읽기 전용으로 실행되며 저장소나 외부 시스템을 수정하지 않습니다.",
    overviewStatus: "현재 상태",
    runningNormally: "정상 실행 중",
    allPaused: "모든 자동화 일시 중지",
    attentionSummary: "{count}개 작업 확인 필요",
    enabledSummary: "{total}개 중 {enabled}개 활성화",
    noUpcoming: "예정 없음",
    filter: "자동화 필터",
    all: "전체",
    filterEmpty: "확인할 자동화가 없습니다.",
    openTask: "작업 열기",
    runWithoutSummary: "아직 실행 요약이 없습니다.",
    scheduleLabel: "실행 일정",
    nextRun: "다음 실행",
    paused: "일시 중지",
    enabled: "활성",
    disabled: "비활성",
    runNow: "지금 실행",
    running: "실행 중",
    edit: "자동화 편집",
    delete: "자동화 삭제",
    confirmDelete: "삭제",
    cancel: "취소",
    dismiss: "닫기",
    editAutomation: "자동화 편집",
    editorDescription:
      "일정과 Agent에 전달할 읽기 전용 검사 지침을 설정합니다.",
    type: "유형",
    typeHint: "템플릿을 선택한 뒤 프로젝트에 맞게 조정하세요",
    taskDetails: "작업 내용",
    taskDetailsHint: "Agent가 정기적으로 수행할 작업을 직접 설명하세요",
    name: "이름",
    cadence: "주기",
    scheduleHint: "연결된 Host가 일정을 실행합니다",
    time: "시간",
    weekday: "요일",
    hostTime: "Host 시간대",
    instructions: "실행 지침",
    instructionsHint: "읽기 전용 제약과 상태 표시는 자동으로 추가됩니다.",
    enableAfterSave: "저장 후 활성화",
    enableAfterSaveHint: "저장된 일정에 따라 자동 실행",
    savePausedHint: "일시 중지 상태로 저장하고 나중에 활성화",
    saving: "저장 중…",
    save: "자동화 저장",
    kind: {
      custom: "사용자 지정 작업",
      tests: "테스트",
      dependencies: "의존성 검사",
      "issue-triage": "Issue 분류",
    },
    kindDescription: {
      custom: "반복 작업이나 검토 목표를 자유롭게 정의",
      tests: "프로젝트 테스트 실행 및 실패 위치 확인",
      dependencies: "오래된 패키지와 보안 위험 확인",
      "issue-triage": "우선순위, 중복, 차단 항목 정리",
    },
    defaultName: {
      custom: "",
      tests: "예약 테스트",
      dependencies: "의존성 상태 검사",
      "issue-triage": "Issue 분류",
    },
    cadenceLabel: { daily: "매일", weekdays: "평일", weekly: "매주" },
    status: {
      running: "실행 중",
      succeeded: "정상",
      attention: "확인 필요",
      failed: "실패",
    },
    weekdays: [
      "일요일",
      "월요일",
      "화요일",
      "수요일",
      "목요일",
      "금요일",
      "토요일",
    ],
  },
});
