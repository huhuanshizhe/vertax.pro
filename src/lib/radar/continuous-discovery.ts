// ==================== Continuous Discovery Service ====================
// 持续发现服务：后台运行，持续扫描直到无新结果

import {
  getAdapter,
  ensureAdaptersInitialized,
  type RadarSearchQuery,
  type NormalizedCandidate,
} from './adapters';

// ==================== 类型定义 ====================

export interface ContinuousDiscoveryConfig {
  profileId: string;
  sourceCode: string;
  keywords: string[];
  countries: string[];
  regions: string[];
  maxIterations?: number;        // 最大迭代次数，0=无限制
  maxResultsPerIteration?: number;
  iterationDelayMs?: number;    // 迭代间延迟
  onProgress?: (progress: ContinuousDiscoveryProgress) => void;
}

export interface ContinuousDiscoveryState {
  isRunning: boolean;
  isPaused: boolean;
  iterations: number;
  totalFound: number;
  uniqueFound: number;
  lastIterationAt: Date | null;
  startedAt: Date;
  errors: string[];
}

export interface ContinuousDiscoveryProgress {
  state: ContinuousDiscoveryState;
  recentCandidates: Array<{
    displayName: string;
    country: string;
    matchScore: number;
  }>;
}

export interface ContinuousDiscoveryInstance {
  instanceId: string;
  config: ContinuousDiscoveryConfig;
  state: ContinuousDiscoveryState;
  candidates: NormalizedCandidate[];
  abortController: AbortController;
}

// ==================== 持续发现管理器 ====================

class ContinuousDiscoveryManager {
  private instances = new Map<string, ContinuousDiscoveryInstance>();
  private static readonly MAX_CANDIDATES_PER_INSTANCE = 10000;
  private static readonly MAX_COMPLETED_INSTANCES = 50;

  // 启动持续发现
  async start(profileId: string, config: ContinuousDiscoveryConfig): Promise<string> {
    // 清理已完成的旧实例，防止内存泄漏
    this.cleanupCompletedInstances();

    const instanceId = `continuous_${profileId}_${Date.now()}`;

    // 检查是否已有运行中的实例
    for (const [id, inst] of this.instances) {
      if (id.startsWith(`continuous_${profileId}_`) && inst.state.isRunning) {
        throw new Error(`Continuous discovery already running for profile ${profileId}`);
      }
    }

    ensureAdaptersInitialized();

    // 获取适配器
    const adapter = getAdapter(config.sourceCode, {});

    // 初始化实例
    const instance: ContinuousDiscoveryInstance = {
      instanceId,
      config,
      state: {
        isRunning: true,
        isPaused: false,
        iterations: 0,
        totalFound: 0,
        uniqueFound: 0,
        lastIterationAt: null,
        startedAt: new Date(),
        errors: [],
      },
      candidates: [],
      abortController: new AbortController(),
    };

    this.instances.set(instanceId, instance);

    // 后台执行发现
    this.runDiscovery(instanceId, adapter).catch(error => {
      console.error(`[ContinuousDiscovery] ${instanceId} error:`, error);
      const inst = this.instances.get(instanceId);
      if (inst) {
        inst.state.isRunning = false;
        inst.state.errors.push(error instanceof Error ? error.message : String(error));
      }
    });

    return instanceId;
  }

  // 停止持续发现
  stop(instanceId: string): boolean {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;

    instance.abortController.abort();
    instance.state.isRunning = false;
    return true;
  }

  // 暂停
  pause(instanceId: string): boolean {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;

    instance.state.isPaused = true;
    return true;
  }

  // 恢复
  resume(instanceId: string): boolean {
    const instance = this.instances.get(instanceId);
    if (!instance || !instance.state.isPaused) return false;

    instance.state.isPaused = false;
    return true;
  }

  // 获取进度
  getProgress(instanceId: string): ContinuousDiscoveryProgress | null {
    const instance = this.instances.get(instanceId);
    if (!instance) return null;

    return {
      state: { ...instance.state },
      recentCandidates: instance.candidates.slice(-10).map(c => ({
        displayName: c.displayName,
        country: c.country || '',
        matchScore: c.matchScore || 0,
      })),
    };
  }

  // 获取所有实例
  getAllInstances(): ContinuousDiscoveryInstance[] {
    return Array.from(this.instances.values());
  }

  // 获取活跃实例ID列表
  getActiveInstanceIds(): string[] {
    return Array.from(this.instances.entries())
      .filter(([, inst]) => inst.state.isRunning)
      .map(([id]) => id);
  }

  // ==================== 实例清理 ====================

  /** 清理已完成且超过1小时的实例，保留数量上限 */
  private cleanupCompletedInstances(): void {
    const oneHourAgo = Date.now() - 3600000;
    const completed: Array<{ id: string; startedAt: number }> = [];

    for (const [id, inst] of this.instances) {
      if (!inst.state.isRunning) {
        completed.push({ id, startedAt: inst.state.startedAt.getTime() });
      }
    }

    // 优先清理超过1小时的实例
    for (const { id, startedAt } of completed) {
      if (startedAt < oneHourAgo) {
        this.instances.delete(id);
      }
    }

    // 如果仍超过上限，按启动时间从早到晚继续清理
    if (this.instances.size > ContinuousDiscoveryManager.MAX_COMPLETED_INSTANCES) {
      const remaining = Array.from(this.instances.entries())
        .filter(([, inst]) => !inst.state.isRunning)
        .sort((a, b) => a[1].state.startedAt.getTime() - b[1].state.startedAt.getTime());

      for (const [id] of remaining) {
        if (this.instances.size <= ContinuousDiscoveryManager.MAX_COMPLETED_INSTANCES) break;
        this.instances.delete(id);
      }
    }
  }

  // ==================== 核心发现循环 ====================

  private async runDiscovery(
    instanceId: string,
    adapter: ReturnType<typeof getAdapter>
  ): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    const { config, state } = instance;
    const seen = new Set<string>();
    const maxIterations = config.maxIterations || 0; // 0 = 无限制
    const delay = config.iterationDelayMs || 2000;

    try {
      while (state.isRunning) {
        // 检查中止信号
        if (instance.abortController.signal.aborted) break;

        // 暂停时等待
        while (state.isPaused && state.isRunning) {
          await this.sleep(1000);
        }
        if (!state.isRunning) break;

        // 检查最大迭代次数
        if (maxIterations > 0 && state.iterations >= maxIterations) {
          console.log(`[ContinuousDiscovery] ${instanceId} reached max iterations (${maxIterations})`);
          break;
        }

        // 生成查询
        const query: RadarSearchQuery = {
          keywords: config.keywords.slice(0, 3),
          countries: config.countries.slice(0, 5),
          regions: config.regions.slice(0, 3),
          maxResults: config.maxResultsPerIteration || 100,
          cursor: { queryIndex: state.iterations },
        };

        // 执行搜索
        const result = await adapter.search(query);

        // 去重
        const newCandidates = result.items.filter(c => {
          const key = this.getCandidateKey(c);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        // 更新状态
        state.iterations++;
        state.totalFound += result.total;
        state.uniqueFound += newCandidates.length;
        state.lastIterationAt = new Date();

        // 添加到候选列表（限制大小，防止内存泄漏）
        const remaining = ContinuousDiscoveryManager.MAX_CANDIDATES_PER_INSTANCE - instance.candidates.length;
        if (remaining > 0) {
          instance.candidates.push(...newCandidates.slice(0, remaining));
        }
        if (instance.candidates.length >= ContinuousDiscoveryManager.MAX_CANDIDATES_PER_INSTANCE) {
          console.log(`[ContinuousDiscovery] ${instanceId} reached max candidates limit, stopping`);
          break;
        }

        // 回调进度
        if (config.onProgress) {
          config.onProgress({
            state: { ...state },
            recentCandidates: newCandidates.slice(0, 10).map(c => ({
              displayName: c.displayName,
              country: c.country || '',
              matchScore: c.matchScore || 0,
            })),
          });
        }

        // 日志
        console.log(`[ContinuousDiscovery] ${instanceId} iter ${state.iterations}: +${newCandidates.length} new (total: ${state.uniqueFound})`);

        // 无更多结果则退出
        if (!result.hasMore || result.items.length === 0) {
          console.log(`[ContinuousDiscovery] ${instanceId} exhausted, stopping`);
          break;
        }

        // 延迟
        await this.sleep(delay);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log(`[ContinuousDiscovery] ${instanceId} aborted`);
      } else {
        throw error;
      }
    } finally {
      state.isRunning = false;
    }
  }

  // 生成唯一键
  private getCandidateKey(candidate: NormalizedCandidate): string {
    const name = candidate.displayName.toLowerCase().trim();
    const url = candidate.sourceUrl || '';
    const country = candidate.country || '';
    return `${name}|${url}|${country}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ==================== 导出单例 ====================

export const continuousDiscoveryManager = new ContinuousDiscoveryManager();

// ==================== 便捷 API ====================

export async function startContinuousDiscovery(
  profileId: string,
  sourceCode: string,
  options: {
    keywords: string[];
    countries: string[];
    regions?: string[];
    maxIterations?: number;
    onProgress?: (progress: ContinuousDiscoveryProgress) => void;
  }
): Promise<string> {
  return continuousDiscoveryManager.start(profileId, {
    profileId,
    sourceCode,
    keywords: options.keywords,
    countries: options.countries,
    regions: options.regions || [],
    maxIterations: options.maxIterations || 0,
    maxResultsPerIteration: 100,
    iterationDelayMs: 3000,
    onProgress: options.onProgress,
  });
}

export function stopContinuousDiscovery(instanceId: string): boolean {
  return continuousDiscoveryManager.stop(instanceId);
}

export function pauseContinuousDiscovery(instanceId: string): boolean {
  return continuousDiscoveryManager.pause(instanceId);
}

export function resumeContinuousDiscovery(instanceId: string): boolean {
  return continuousDiscoveryManager.resume(instanceId);
}

export function getDiscoveryProgress(instanceId: string): ContinuousDiscoveryProgress | null {
  return continuousDiscoveryManager.getProgress(instanceId);
}

export function getActiveDiscoveryInstances(): string[] {
  return continuousDiscoveryManager.getActiveInstanceIds();
}

// ==================== 批处理导出 ====================

export function exportCandidates(instanceId: string): NormalizedCandidate[] | null {
  const instance = continuousDiscoveryManager.getAllInstances().find(i => i.instanceId === instanceId);
  return instance ? [...instance.candidates] : null;
}
