import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AuthPlatform } from './dto/login.dto';

/**
 * 登录元数据接口
 * 用于追踪登录态的生命周期
 */
export interface LoginMetadata {
  platform: AuthPlatform;
  loginAt: string;          // 登录时间
  lastVerifiedAt: string;   // 最后验证成功时间
  lastFailedAt?: string;    // 最后验证失败时间（发现过期）
  userId?: string;
  nickname?: string;
  status: 'valid' | 'expired' | 'unknown';  // 登录态状态
}

/**
 * 多平台登录元数据文件结构
 * 一个文件存储所有平台的登录信息
 */
export interface MultiPlatformMetadata {
  [platform: string]: LoginMetadata;
}

/**
 * 登录元数据管理服务
 * 
 * 职责：
 * 1. 记录登录时间和验证历史
 * 2. 追踪登录态是否过期
 * 3. 为清理过期数据提供依据
 */
@Injectable()
export class LoginMetadataService {
  private readonly logger = new Logger(LoginMetadataService.name);
  private readonly metadataFile = 'login-metadata.json';

  constructor(private readonly profileDir: string) {}

  /**
   * 读取登录元数据
   * 
   * @param accountId 账号 ID
   * @param platform 平台
   * @returns 元数据对象，如果不存在则返回 null
   */
  async read(accountId: string, platform: AuthPlatform): Promise<LoginMetadata | null> {
    const metadataPath = this.getMetadataPath(accountId);
    
    if (!fs.existsSync(metadataPath)) {
      return null;
    }

    try {
      const content = await fs.promises.readFile(metadataPath, 'utf-8');
      const parsed = JSON.parse(content);
      
      // 自动迁移：如果是旧格式（单平台），自动转换为新格式（多平台）
      if (parsed.platform && typeof parsed.platform === 'string') {
        // 旧格式：{ platform: "xhs", ... }
        // 转换为新格式：{ "xhs": { platform: "xhs", ... } }
        const oldFormat = parsed as LoginMetadata;
        const newFormat: MultiPlatformMetadata = {
          [oldFormat.platform]: oldFormat,
        };
        
        // 写回新格式
        await fs.promises.writeFile(
          metadataPath,
          JSON.stringify(newFormat, null, 2),
          'utf-8',
        );
        
        this.logger.log(`Auto-migrated metadata for ${accountId} from single-platform to multi-platform`);
        
        // 返回当前平台的元数据
        return newFormat[platform] || null;
      }
      
      // 新格式：{ "xhs": {...}, "douyin": {...} }
      const allMetadata: MultiPlatformMetadata = parsed;
      return allMetadata[platform] || null;
    } catch (err) {
      this.logger.warn(`Failed to read metadata for ${accountId}/${platform}: ${err.message}`);
      return null;
    }
  }

  /**
   * 保存登录元数据（支持多平台）
   * 
   * @param accountId 账号 ID
   * @param metadata 元数据对象
   */
  async save(accountId: string, metadata: LoginMetadata): Promise<void> {
    const metadataPath = this.getMetadataPath(accountId);
    const profileDir = path.dirname(metadataPath);
    
    // 确保目录存在
    await fs.promises.mkdir(profileDir, { recursive: true });
    
    // 读取现有的多平台元数据
    let allMetadata: MultiPlatformMetadata = {};
    if (fs.existsSync(metadataPath)) {
      try {
        const content = await fs.promises.readFile(metadataPath, 'utf-8');
        allMetadata = JSON.parse(content);
      } catch {
        // 文件损坏，从头开始
        allMetadata = {};
      }
    }
    
    // 更新当前平台的元数据
    allMetadata[metadata.platform] = metadata;
    
    // 写回文件
    await fs.promises.writeFile(
      metadataPath,
      JSON.stringify(allMetadata, null, 2),
      'utf-8',
    );
    
    this.logger.log(`Saved login metadata for ${accountId}/${metadata.platform} (total platforms: ${Object.keys(allMetadata).length})`);
  }

  /**
   * 更新元数据（部分字段）
   * 
   * @param accountId 账号 ID
   * @param platform 平台
   * @param updates 要更新的字段
   */
  async update(
    accountId: string,
    platform: AuthPlatform,
    updates: Partial<Omit<LoginMetadata, 'platform'>>,
  ): Promise<void> {
    const existing = await this.read(accountId, platform);
    
    if (!existing) {
      throw new Error(`No metadata found for ${accountId}/${platform}`);
    }

    const updated: LoginMetadata = {
      ...existing,
      ...updates,
      platform, // 确保 platform 不变
    };
    
    await this.save(accountId, updated);
  }

  /**
   * 读取所有平台的元数据
   * 
   * @param accountId 账号 ID
   * @returns 所有平台的元数据映射
   */
  async readAll(accountId: string): Promise<MultiPlatformMetadata> {
    const metadataPath = this.getMetadataPath(accountId);
    
    if (!fs.existsSync(metadataPath)) {
      return {};
    }

    try {
      const content = await fs.promises.readFile(metadataPath, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      this.logger.warn(`Failed to read all metadata for ${accountId}: ${err.message}`);
      return {};
    }
  }

  /**
   * 删除元数据
   * 
   * @param accountId 账号 ID
   */
  async delete(accountId: string): Promise<void> {
    const metadataPath = this.getMetadataPath(accountId);
    
    if (fs.existsSync(metadataPath)) {
      await fs.promises.unlink(metadataPath);
      this.logger.log(`Deleted login metadata for ${accountId}`);
    }
  }

  /**
   * 检查元数据是否存在
   * 
   * @param accountId 账号 ID
   */
  async exists(accountId: string): Promise<boolean> {
    const metadataPath = this.getMetadataPath(accountId);
    return fs.existsSync(metadataPath);
  }

  /**
   * 检查是否在缓存时间内（7天）
   * 
   * @param metadata 元数据
   * @returns 是否在缓存时间内
   */
  isWithinCacheTime(metadata: LoginMetadata): boolean {
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000; // 7天
    const lastVerifiedAt = new Date(metadata.lastVerifiedAt).getTime();
    return Date.now() - lastVerifiedAt < sevenDaysMs;
  }

  /**
   * 检查是否过期超过 7 天
   * 
   * @param metadata 元数据
   * @returns 是否超过 7 天
   */
  isExpiredForSevenDays(metadata: LoginMetadata): boolean {
    if (!metadata.lastFailedAt) {
      return false;
    }

    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000; // 7天
    const lastFailedAt = new Date(metadata.lastFailedAt).getTime();
    return Date.now() - lastFailedAt >= sevenDaysMs;
  }

  /**
   * 获取元数据文件路径
   */
  private getMetadataPath(accountId: string): string {
    return path.join(this.profileDir, accountId, this.metadataFile);
  }
}
