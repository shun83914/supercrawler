export interface LaunchOverride {
  headless?: boolean;
  humanize?: boolean;
  proxy?: string;
  timezone?: string;
  locale?: string;
  platform?: string; // 用于平台隔离（xhs, douyin, meituan 等）
  antiDetection?: boolean; // 是否启用反爬增强（默认 true）
}
