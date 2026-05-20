export interface LaunchOverride {
  headless?: boolean;
  humanize?: boolean;
  proxy?: string;
  timezone?: string;
  locale?: string;
  platform?: string; // 用于平台隔离（xhs, douyin, meituan 等）
}
