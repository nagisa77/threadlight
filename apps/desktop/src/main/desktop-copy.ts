import type { HostLanguage } from "@threadlight/protocol";

export interface DesktopCopy {
  readonly openProjectFolder: string;
  readonly taskCompleted: string;
  readonly deliveryAttention: {
    readonly conflict: string;
    readonly failed: string;
  };
  readonly automation: {
    readonly attention: string;
    readonly failed: string;
  };
  readonly computerPreview: {
    readonly close: string;
    readonly empty: string;
    readonly bringToFront: string;
  };
}

const DESKTOP_COPY = {
  "zh-CN": {
    openProjectFolder: "打开项目文件夹",
    taskCompleted: "任务已完成",
    deliveryAttention: {
      conflict: "自动同步有冲突",
      failed: "自动同步失败",
    },
    automation: {
      attention: "自动化需要关注",
      failed: "自动化运行失败",
    },
    computerPreview: {
      close: "关闭画中画",
      empty: "没有正在共享的窗口",
      bringToFront: "将共享窗口放到最前",
    },
  },
  "zh-TW": {
    openProjectFolder: "開啟專案資料夾",
    taskCompleted: "工作已完成",
    deliveryAttention: {
      conflict: "自動同步發生衝突",
      failed: "自動同步失敗",
    },
    automation: {
      attention: "自動化需要關注",
      failed: "自動化執行失敗",
    },
    computerPreview: {
      close: "關閉子母畫面",
      empty: "目前沒有共享中的視窗",
      bringToFront: "將共享視窗移到最前方",
    },
  },
  en: {
    openProjectFolder: "Open project folder",
    taskCompleted: "Task completed",
    deliveryAttention: {
      conflict: "Automatic sync conflict",
      failed: "Automatic sync failed",
    },
    automation: {
      attention: "Automation needs attention",
      failed: "Automation run failed",
    },
    computerPreview: {
      close: "Close picture in picture",
      empty: "No windows are being shared",
      bringToFront: "Bring shared window to front",
    },
  },
  ja: {
    openProjectFolder: "プロジェクトフォルダーを開く",
    taskCompleted: "タスクが完了しました",
    deliveryAttention: {
      conflict: "自動同期に競合があります",
      failed: "自動同期に失敗しました",
    },
    automation: {
      attention: "自動化の確認が必要です",
      failed: "自動化の実行に失敗しました",
    },
    computerPreview: {
      close: "ピクチャ・イン・ピクチャを閉じる",
      empty: "共有中のウインドウはありません",
      bringToFront: "共有ウインドウを最前面に移動",
    },
  },
  ko: {
    openProjectFolder: "프로젝트 폴더 열기",
    taskCompleted: "작업 완료",
    deliveryAttention: {
      conflict: "자동 동기화 충돌",
      failed: "자동 동기화 실패",
    },
    automation: {
      attention: "자동화를 확인해야 합니다",
      failed: "자동화 실행 실패",
    },
    computerPreview: {
      close: "화면 속 화면 닫기",
      empty: "공유 중인 창이 없습니다",
      bringToFront: "공유 창을 맨 앞으로 가져오기",
    },
  },
} satisfies Record<HostLanguage, DesktopCopy>;

export function desktopCopy(language: HostLanguage): DesktopCopy {
  return DESKTOP_COPY[language];
}
