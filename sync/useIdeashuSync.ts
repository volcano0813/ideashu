/**
 * useIdeashuSync Hook
 * 
 * 用于 React 前端实时同步 IdeaShu 飞书对话内容
 * 
 * 修复版：解决 WebSocket 反复连接/断开的问题
 * - 用 useRef 存储回调，避免回调变化触发重连
 * - 加连接锁，防止并发创建多个 WebSocket
 * - 加心跳 ping 保活
 */

import { useEffect, useRef, useState, useCallback } from 'react';

// ===== Types =====

export interface Draft {
  id: string;
  title: string;
  body: string;
  tags: string[];
  cover?: {
    type: 'photo' | 'text' | 'collage' | 'compare' | 'list';
    description: string;
    overlayText?: string;
  };
  status: 'draft' | 'finalized';
  platform: string;
  created_at: string;
  updated_at: string;
}

export interface Topic {
  id: number;
  title: string;
  source: string;
  angle: string;
  hook: string;
  timing: 'hot' | 'evergreen';
  timingDetail: string;
  materialMatch: boolean;
  materialCount: number;
}

export interface ScoreData {
  hook: number;
  authentic: number;
  aiSmell: number;
  diversity: number;
  cta: number;
  platform: number;
  total: number;
  brandMatch: 'match' | 'mismatch';
  suggestions: string[];
  dedup: 'no_duplicate' | string;
}

export interface OriginalityData {
  userMaterialPct: number;
  aiAssistPct: number;
  compliance: 'safe' | 'caution' | 'risk';
  materialSources: string[];
}

export interface UseIdeashuSyncOptions {
  userId?: string;
  serverUrl?: string;
  wsUrl?: string;
  autoConnect?: boolean;
  onDraftUpdate?: (draft: Draft) => void;
  onTopicsUpdate?: (topics: Topic[]) => void;
  onScoreUpdate?: (data: { score: ScoreData; originality: OriginalityData }) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
}

export interface UseIdeashuSyncReturn {
  isConnected: boolean;
  isLoading: boolean;
  error: Error | null;
  drafts: Draft[];
  latestDraft: Draft | null;
  topics: Topic[] | null;
  connect: () => void;
  disconnect: () => void;
  refreshDrafts: () => Promise<void>;
  getDraft: (id: string) => Promise<Draft | null>;
}

// ===== Hook =====

export function useIdeashuSync(options: UseIdeashuSyncOptions = {}): UseIdeashuSyncReturn {
  const {
    userId = 'default',
    serverUrl = 'http://localhost:3001',
    wsUrl = 'ws://localhost:3001',
    autoConnect = true,
  } = options;

  // ---- 用 ref 存回调，避免回调引用变化触发重连 ----
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isConnectingRef = useRef(false);
  const isMountedRef = useRef(true);
  const reconnectCountRef = useRef(0);
  const MAX_RECONNECT = 5;

  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [latestDraft, setLatestDraft] = useState<Draft | null>(null);
  const [topics, setTopics] = useState<Topic[] | null>(null);

  // ---- HTTP 方法（稳定引用，只依赖 serverUrl/userId）----
  const refreshDrafts = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${serverUrl}/api/drafts?userId=${userId}`);
      const result = await response.json();
      if (result.success) {
        setDrafts(result.data);
        if (result.data.length > 0) {
          setLatestDraft(result.data[0]);
        }
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error('Failed to fetch drafts');
      setError(e);
      callbacksRef.current.onError?.(e);
    } finally {
      setIsLoading(false);
    }
  }, [serverUrl, userId]);

  const getDraft = useCallback(async (id: string): Promise<Draft | null> => {
    try {
      const response = await fetch(`${serverUrl}/api/drafts/${id}`);
      const result = await response.json();
      return result.success ? result.data : null;
    } catch (err) {
      callbacksRef.current.onError?.(
        err instanceof Error ? err : new Error('Failed to fetch draft')
      );
      return null;
    }
  }, [serverUrl]);

  // ---- 清理函数 ----
  const cleanup = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
  }, []);

  // ---- 断开连接 ----
  const disconnect = useCallback(() => {
    cleanup();
    isConnectingRef.current = false;
    reconnectCountRef.current = 0;
    if (wsRef.current) {
      // 移除所有事件监听，防止 onclose 触发重连
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, [cleanup]);

  // ---- 连接 WebSocket ----
  const connect = useCallback(() => {
    // 防止并发连接
    if (isConnectingRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (!isMountedRef.current) return;

    // 先清理旧连接
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    cleanup();

    isConnectingRef.current = true;
    console.log('[IdeaShu Sync] Connecting to', `${wsUrl}/api?userId=${userId}`);

    const ws = new WebSocket(`${wsUrl}/api?userId=${userId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!isMountedRef.current) {
        ws.close();
        return;
      }
      console.log('[IdeaShu Sync] Connected');
      isConnectingRef.current = false;
      reconnectCountRef.current = 0;
      setIsConnected(true);
      setError(null);
      callbacksRef.current.onConnect?.();

      // 连接后获取历史数据
      refreshDrafts();

      // 启动心跳 ping（每 30 秒）
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30000);
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        
        switch (payload.type) {
          case 'draft_updated': {
            const draft = payload.data;
            setLatestDraft(draft);
            setDrafts(prev => [draft, ...prev.filter(d => d.id !== draft.id)]);
            callbacksRef.current.onDraftUpdate?.(draft);
            break;
          }
          case 'topics_updated': {
            const topicsList = payload.data.topics || payload.data;
            setTopics(topicsList);
            callbacksRef.current.onTopicsUpdate?.(topicsList);
            break;
          }
          case 'score_updated':
            callbacksRef.current.onScoreUpdate?.({
              score: payload.data.score_data,
              originality: payload.data.originality
            });
            break;
          case 'connected':
            console.log('[IdeaShu Sync] Server acknowledged connection');
            break;
          case 'pong':
            break;
        }
      } catch (err) {
        console.error('[IdeaShu Sync] Failed to parse message:', err);
      }
    };

    ws.onclose = () => {
      if (!isMountedRef.current) return;

      console.log('[IdeaShu Sync] Disconnected');
      isConnectingRef.current = false;
      setIsConnected(false);
      cleanup();
      callbacksRef.current.onDisconnect?.();

      // 自动重连，带退避和上限
      if (reconnectCountRef.current < MAX_RECONNECT) {
        reconnectCountRef.current += 1;
        const delay = Math.min(3000 * reconnectCountRef.current, 15000);
        console.log(
          `[IdeaShu Sync] Reconnect ${reconnectCountRef.current}/${MAX_RECONNECT} in ${delay}ms`
        );
        reconnectTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            connect();
          }
        }, delay);
      } else {
        console.log('[IdeaShu Sync] Max reconnect reached, stopping. Call connect() to retry.');
        setError(new Error('WebSocket 连接失败，已停止重连。请刷新页面重试。'));
      }
    };

    ws.onerror = (err) => {
      console.error('[IdeaShu Sync] WebSocket error:', err);
      isConnectingRef.current = false;
      // 不在这里 setError，让 onclose 统一处理
    };
  }, [wsUrl, userId, cleanup, refreshDrafts]);

  // ---- 生命周期：只在 mount/unmount 时执行 ----
  useEffect(() => {
    isMountedRef.current = true;

    if (autoConnect) {
      connect();
    }

    return () => {
      isMountedRef.current = false;
      disconnect();
    };
    // 故意只在 mount/unmount 时执行，不依赖 connect/disconnect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    isConnected,
    isLoading,
    error,
    drafts,
    latestDraft,
    topics,
    connect,
    disconnect,
    refreshDrafts,
    getDraft
  };
}

export default useIdeashuSync;
