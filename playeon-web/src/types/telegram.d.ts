type TelegramInsets = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

type TelegramHapticFeedback = {
  impactOccurred?: (
    style: "light" | "medium" | "heavy" | "rigid" | "soft",
  ) => void;
  notificationOccurred?: (type: "error" | "success" | "warning") => void;
  selectionChanged?: () => void;
};

type TelegramWebApp = {
  ready: () => void;
  expand: () => void;
  close?: () => void;
  openTelegramLink?: (url: string) => void;
  /** Raw signed launch payload; re-verified server-side before it's trusted. */
  initDataUnsafe?: { start_param?: string };
  /** "unknown" when the script is running outside a Telegram client */
  platform?: string;
  initData?: string;
  colorScheme: "light" | "dark";
  safeAreaInset?: TelegramInsets;
  contentSafeAreaInset?: TelegramInsets;
  isVersionAtLeast: (version: string) => boolean;
  isFullscreen?: boolean;
  requestFullscreen?: () => void;
  exitFullscreen?: () => void;
  disableVerticalSwipes?: () => void;
  HapticFeedback?: TelegramHapticFeedback;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  onEvent: (event: string, handler: () => void) => void;
  offEvent: (event: string, handler: () => void) => void;
};

interface Window {
  Telegram?: { WebApp?: TelegramWebApp };
}
