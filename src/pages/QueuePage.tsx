import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useAPI } from "@/context/APIContext";
import { api } from "@/utils/apiClient";
import { toast } from "sonner";
import { XIcon, RefreshCwIcon, PlusIcon, SearchIcon, PlayIcon, PauseIcon, Trash2Icon, ArrowUpDownIcon, HeartIcon, CopyIcon } from 'lucide-react';
import { useIsMobile } from "@/hooks/use-mobile";
import { 
  API_URL, 
  TASK_RETRY_INTERVAL, 
  MIN_RETRY_INTERVAL, 
  MAX_RETRY_INTERVAL,
  QUEUE_POLLING_INTERVAL,
  validateRetryInterval,
  formatInterval
} from "@/config/constants";
import { OVH_DATACENTERS, DatacenterInfo } from "@/config/ovhConstants";

interface QueueItem {
  id: string;
  intentId?: string;
  groupId?: string;
  slotIndex?: number;
  planCode: string;
  datacenter: string;
  options: string[];
  requestedOptions?: string[];
  requiredOptions?: string[];
  matchedOptions?: string[];
  actualCartOptions?: string[];
  strictConfig?: boolean;
  status: "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";
  phase?: string;
  createdAt: string;
  updatedAt: string;
  retryInterval: number;
  retryCount: number;
  failureCode?: string | null;
  failureDetail?: string | null;
}

interface ServerOption {
  label: string;
  value: string;
}

interface ServerPlan {
  planCode: string;
  name: string;
  cpu: string;
  memory: string;
  storage: string;
  datacenters: {
    datacenter: string;
    dcName: string;
    region: string;
    availability: string;
  }[];
  defaultOptions: ServerOption[];
  availableOptions: ServerOption[];
}

const shortId = (value?: string | null) => value ? value.slice(0, 8) : "-";

const QueuePage = () => {
  const copyText = async (label: string, value?: string | null) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} 已复制`);
    } catch (error) {
      console.error(`Failed to copy ${label}:`, error);
      toast.error(`复制${label}失败`);
    }
  };

  const isMobile = useIsMobile();
  const { isAuthenticated } = useAPI();
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false); // 区分初始加载和刷新
  const [showAddForm, setShowAddForm] = useState(true); // 默认展开表单
  const [servers, setServers] = useState<ServerPlan[]>([]);
  const [planCodeInput, setPlanCodeInput] = useState<string>("");
  const [selectedServer, setSelectedServer] = useState<ServerPlan | null>(null);
  const [selectedDatacenters, setSelectedDatacenters] = useState<string[]>([]);
  const [retryInterval, setRetryInterval] = useState<number>(TASK_RETRY_INTERVAL);
  const [retryIntervalInput, setRetryIntervalInput] = useState<string>(String(TASK_RETRY_INTERVAL)); // 用于自由输入
  const [quantity, setQuantity] = useState<number>(1); // 每个数据中心的抢购数量
  const [quantityInput, setQuantityInput] = useState<string>("1"); // 用于自由输入
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]); // 选中的可选配置
  const [optionsInput, setOptionsInput] = useState<string>(''); // 用户自定义输入
  const [showClearConfirm, setShowClearConfirm] = useState(false); // 清空确认对话框

  // Fetch queue items
  const fetchQueueItems = async (isRefresh = false) => {
    // 如果是刷新，只设置刷新状态，不改变加载状态
    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    try {
      const response = await api.get(`/queue`);
      setQueueItems(response.data);
    } catch (error) {
      console.error("Error fetching queue items:", error);
      toast.error("获取队列失败");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  // Fetch servers for the add form
  const fetchServers = async () => {
    try {
      const response = await api.get(`/servers`, {
        params: { showApiServers: isAuthenticated },
      });
      
      const serversList = response.data.servers || response.data || [];
      setServers(serversList);

    } catch (error) {
      console.error("Error fetching servers:", error);
      toast.error("获取服务器列表失败");
    }
  };

  // Add new queue item
  const addQueueItem = async () => {
    if (!planCodeInput.trim() || selectedDatacenters.length === 0) {
      toast.error("请输入服务器计划代码并至少选择一个数据中心");
      return;
    }

    const finalQuantity = Number(quantityInput) || 1;
    if (finalQuantity < 1) {
      toast.error("抢购数量必须大于 0");
      return;
    }

    const finalRetryInterval = Number(retryIntervalInput) || TASK_RETRY_INTERVAL;

    let successCount = 0;
    let errorCount = 0;
    const totalTasks = selectedDatacenters.length * finalQuantity;

    toast.info(`正在创建 ${totalTasks} 个抢购任务...`);

    const createUuid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const intentId = createUuid();
    const groupIds = Array.from({ length: finalQuantity }, () => createUuid());

    // 同一数量槽位下的多个机房共享同一个 groupId，确保最多只成功 1 单
    for (let i = 0; i < finalQuantity; i++) {
      for (const dc of selectedDatacenters) {
        try {
          await api.post(`/queue`, {
            planCode: planCodeInput.trim(),
            datacenter: dc,
            retryInterval: finalRetryInterval,
            options: selectedOptions,
            intentId,
            groupId: groupIds[i],
            slotIndex: i + 1,
            source: 'queue_page',
          });
          successCount++;
        } catch (error) {
          console.error(`Error adding ${planCodeInput.trim()} in ${dc} (${i + 1}/${finalQuantity}) to queue:`, error);
          errorCount++;
        }
      }
    }

    if (successCount > 0) {
      toast.success(`${successCount}/${totalTasks} 个任务已成功添加到抢购队列`);
    }
    if (errorCount > 0) {
      toast.error(`${errorCount}/${totalTasks} 个任务添加失败`);
    }

    if (successCount > 0 || errorCount === 0) {
      fetchQueueItems(true);
      setPlanCodeInput("");
      setSelectedDatacenters([]);
      setRetryInterval(TASK_RETRY_INTERVAL);
      setRetryIntervalInput(String(TASK_RETRY_INTERVAL));
      setQuantity(1);
      setQuantityInput("1");
      setSelectedOptions([]);
      setOptionsInput('');
    }
  };

  // Remove queue item
  const removeQueueItem = async (id: string) => {
    try {
      await api.delete(`/queue/${id}`);
      toast.success("已从队列中移除");
      fetchQueueItems(true);
    } catch (error) {
      console.error("Error removing queue item:", error);
      toast.error("从队列中移除失败");
    }
  };

  // Start/stop queue item
  const toggleQueueItemStatus = async (id: string, currentStatus: string) => {
    // 优化状态切换逻辑：
    // running → paused (暂停运行中的任务)
    // paused → running (恢复已暂停的任务)
    // pending/completed/failed → running (启动其他状态的任务)
    let newStatus: string;
    let actionText: string;
    
    if (currentStatus === "running") {
      newStatus = "paused";
      actionText = "暂停";
    } else if (currentStatus === "paused") {
      newStatus = "running";
      actionText = "恢复";
    } else {
      newStatus = "running";
      actionText = "启动";
    }
    
    try {
      await api.put(`/queue/${id}/status`, {
        status: newStatus,
      });
      
      toast.success(`已${actionText}队列项`);
      fetchQueueItems(true);
    } catch (error) {
      console.error("Error updating queue item status:", error);
      toast.error("更新队列项状态失败");
    }
  };

  // Clear all queue items
  const clearAllQueue = async () => {
    try {
      const response = await api.delete(`/queue/clear`);
      toast.success(`已清空队列（共 ${response.data.count} 项）`);
      fetchQueueItems(true);
      setShowClearConfirm(false);
    } catch (error) {
      console.error("Error clearing queue:", error);
      toast.error("清空队列失败");
      setShowClearConfirm(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchQueueItems();
    fetchServers();
    
    // Set up polling interval
    const interval = setInterval(fetchQueueItems, QUEUE_POLLING_INTERVAL);
    
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // Update selectedServer when planCodeInput or servers list changes
  useEffect(() => {
    if (planCodeInput.trim()) {
      const server = servers.find(s => s.planCode === planCodeInput.trim());
      setSelectedServer(server || null);
    } else {
      setSelectedServer(null);
    }
  }, [planCodeInput, servers]);

  // 不自动重置选项 - 用户可能只是修改了 planCode，应保留已选配置
  
  // 双向同步：输入框 ↔ selectedOptions
  useEffect(() => {
    setOptionsInput(selectedOptions.join(', '));
  }, [selectedOptions]);
  
  // 从输入框更新到数组
  const updateOptionsFromInput = () => {
    const options = optionsInput
      .split(',')
      .map(v => v.trim())
      .filter(v => v);
    setSelectedOptions(options);
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { 
      opacity: 1,
      transition: { 
        staggerChildren: 0.05
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 }
  };

  const handleDatacenterChange = (dcCode: string) => {
    setSelectedDatacenters(prev => 
      prev.includes(dcCode) ? prev.filter(d => d !== dcCode) : [...prev, dcCode]
    );
  };

  // 全选数据中心
  const selectAllDatacenters = () => {
    const allDcCodes = OVH_DATACENTERS.map(dc => dc.code);
    setSelectedDatacenters(allDcCodes);
  };

  // 取消全选数据中心
  const deselectAllDatacenters = () => {
    setSelectedDatacenters([]);
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className={`${isMobile ? 'text-2xl' : 'text-3xl'} font-bold mb-1 cyber-glow-text`}>抢购队列</h1>
        <p className="text-cyber-muted text-sm mb-4 sm:mb-6">管理自动抢购服务器的队列</p>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 mb-4 sm:mb-6">
        <button
          onClick={() => fetchQueueItems(true)}
          className="cyber-button text-xs flex items-center justify-center"
          disabled={isLoading || isRefreshing}
        >
          <RefreshCwIcon size={12} className={`mr-1 flex-shrink-0 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span className="min-w-[2.5rem]">刷新</span>
        </button>
        <button
          onClick={() => setShowClearConfirm(true)}
          className="cyber-button text-xs flex items-center bg-red-900/30 border-red-700/40 text-red-300 hover:bg-red-800/40 hover:border-red-600/50 hover:text-red-200 justify-center disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={isLoading || queueItems.length === 0}
        >
          <Trash2Icon size={12} className="mr-1" />
          {!isMobile && '清空队列'}
          {isMobile && '清空'}
        </button>
      </div>

      {/* Add Form */}
      {showAddForm && (
        <div className="bg-cyber-surface-dark p-4 sm:p-6 rounded-lg shadow-xl border border-cyber-border">
          <h2 className={`${isMobile ? 'text-lg' : 'text-xl'} font-semibold mb-4 sm:mb-6 text-cyber-primary-accent`}>添加抢购任务</h2>
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 mb-4 sm:mb-6">
            {/* Left Column: Plan Code, Quantity & Retry Interval */}
            <div className="md:col-span-1 space-y-4">
              <div>
                <label htmlFor="planCode" className="block text-sm font-medium text-cyber-secondary mb-1">服务器计划代码</label>
                <input
                  type="text"
                  id="planCode"
                  value={planCodeInput}
                  onChange={(e) => setPlanCodeInput(e.target.value)}
                  placeholder="例如: 24sk202"
                  className="w-full cyber-input bg-cyber-surface text-cyber-text border-cyber-border focus:ring-cyber-primary focus:border-cyber-primary"
                />
              </div>
              <div>
                <label htmlFor="quantity" className="block text-sm font-medium text-cyber-secondary mb-1">
                  每个数据中心抢购数量
                  <span className="text-xs text-cyber-muted ml-2">
                    每台服务器单独成单
                  </span>
                </label>
                <input
                  type="text"
                  id="quantity"
                  value={quantityInput}
                  onChange={(e) => {
                    const value = e.target.value;
                    // 允许空字符串和数字输入
                    if (value === '' || /^\d*$/.test(value)) {
                      setQuantityInput(value);
                      const numValue = Number(value);
                      if (!isNaN(numValue) && numValue > 0) {
                        setQuantity(numValue);
                      }
                    }
                  }}
                  onBlur={(e) => {
                    const value = Number(e.target.value);
                    if (isNaN(value) || value < 1) {
                      if (e.target.value.trim() === '') {
                        setQuantityInput("1");
                        setQuantity(1);
                      } else {
                        setQuantityInput(String(value < 1 ? 1 : value));
                        setQuantity(value < 1 ? 1 : value);
                      }
                    } else {
                      setQuantity(value);
                      setQuantityInput(String(value));
                    }
                  }}
                  className="w-full cyber-input bg-cyber-surface text-cyber-text border-cyber-border focus:ring-cyber-primary focus:border-cyber-primary"
                  placeholder="默认: 1台"
                />
                <p className="text-xs text-cyber-muted mt-1">
                  💡 例如：选择3个数据中心，数量填10，将创建30个独立订单（每个数据中心10台）
                </p>
              </div>
              <div>
                <label htmlFor="retryInterval" className="block text-sm font-medium text-cyber-secondary mb-1">
                  抢购失败后重试间隔 (秒)
                  <span className="text-xs text-cyber-muted ml-2">
                    推荐: {TASK_RETRY_INTERVAL}秒
                  </span>
                </label>
                <input
                  type="text"
                  id="retryInterval"
                  value={retryIntervalInput}
                  onChange={(e) => {
                    const value = e.target.value;
                    // 允许空字符串和数字输入
                    if (value === '' || /^\d*$/.test(value)) {
                      setRetryIntervalInput(value);
                      const numValue = Number(value);
                      if (!isNaN(numValue) && numValue > 0) {
                        setRetryInterval(numValue);
                      }
                    }
                  }}
                  onBlur={(e) => {
                    const value = Number(e.target.value);
                    if (isNaN(value) || value < 1) {
                      if (e.target.value.trim() === '') {
                        setRetryIntervalInput(String(TASK_RETRY_INTERVAL));
                        setRetryInterval(TASK_RETRY_INTERVAL);
                      } else {
                        setRetryIntervalInput(String(value < 1 ? TASK_RETRY_INTERVAL : value));
                        setRetryInterval(value < 1 ? TASK_RETRY_INTERVAL : value);
                      }
                    } else {
                      setRetryInterval(value);
                      setRetryIntervalInput(String(value));
                    }
                  }}
                  className="w-full cyber-input bg-cyber-surface text-cyber-text border-cyber-border focus:ring-cyber-primary focus:border-cyber-primary"
                  placeholder={`推荐: ${TASK_RETRY_INTERVAL}秒`}
                />
              </div>
            </div>

            {/* Right Column: Datacenter Selection */}
            <div className="md:col-span-2">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-cyber-secondary">选择数据中心 (可选)</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={selectAllDatacenters}
                    className="px-2 py-1 text-xs bg-cyber-accent/10 hover:bg-cyber-accent/20 text-cyber-accent border border-cyber-accent/30 hover:border-cyber-accent/50 rounded transition-all"
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    onClick={deselectAllDatacenters}
                    className="px-2 py-1 text-xs bg-cyber-grid/10 hover:bg-cyber-grid/20 text-cyber-muted hover:text-cyber-text border border-cyber-accent/20 hover:border-cyber-accent/40 rounded transition-all"
                  >
                    取消全选
                  </button>
                </div>
              </div>
              <div className="h-48 p-3 bg-cyber-surface border border-cyber-border rounded-md overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 custom-scrollbar">
                {OVH_DATACENTERS.sort((a, b) => a.name.localeCompare(b.name)).map(dc => (
                  <div key={dc.code} className="flex items-center">
                    <input
                      type="checkbox"
                      id={`dc-${dc.code}`}
                      checked={selectedDatacenters.includes(dc.code)}
                      onChange={() => handleDatacenterChange(dc.code)}
                      className="cyber-checkbox h-4 w-4 text-cyber-primary bg-cyber-surface border-cyber-border focus:ring-cyber-primary"
                    />
                    <label htmlFor={`dc-${dc.code}`} className="ml-2 text-sm text-cyber-text-dimmed truncate" title={`${dc.name} (${dc.code})`}>
                      {dc.name} ({dc.code})
                    </label>
                  </div>
                ))}
              </div>
              
              {/* 可选配置 - 用户自定义输入 */}
              <div className="mt-4">
                <div className="text-xs font-medium text-cyber-secondary mb-2">
                  ⚙️ 可选配置（自定义）
                  <span className="text-[10px] text-cyber-muted ml-2">
                    (留空使用默认配置，用逗号分隔多个选项)
                  </span>
                </div>
                
                <input
                  type="text"
                  placeholder="例如: ram-64g-ecc-2400, softraid-2x450nvme-24sk50"
                  value={optionsInput}
                  onChange={(e) => setOptionsInput(e.target.value)}
                  onBlur={updateOptionsFromInput}
                  className="w-full cyber-input bg-cyber-surface text-cyber-text border-cyber-border focus:ring-cyber-primary focus:border-cyber-primary text-xs py-1.5"
                />
                <div className="mt-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded">
                  <p className="text-[10px] text-yellow-400 leading-relaxed">
                    ⚠️ <strong>重要提示：</strong>如您提供的可选参数不正确，系统将不会按默认配置偷偷下单；
                    它会在严格配置校验失败后停止本次结账并重试/记录失败。请务必在
                    <a 
                      href="https://api.ovh.com/1.0/order/catalog/public/eco?ovhSubsidiary=IE" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-cyber-accent hover:text-cyber-primary underline mx-1"
                    >
                      OVH API 目录
                    </a>
                    获取准确参数。
                  </p>
                </div>
                <p className="text-[10px] text-cyber-muted mt-1">
                  💡 示例：ram-64g-ecc-2400, softraid-2x450nvme-24sk50
                </p>
                
                {/* 已选配置显示 */}
                {selectedOptions.length > 0 && (
                  <div className="mt-2 p-1.5 bg-cyber-accent/10 border border-cyber-accent/30 rounded">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[10px] font-medium text-cyber-accent">已选配置 ({selectedOptions.length})</div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedOptions([]);
                          setOptionsInput('');
                        }}
                        className="text-[10px] text-cyber-muted hover:text-cyber-accent"
                      >
                        清除
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {selectedOptions.map((optValue, index) => (
                        <div key={index} className="flex items-center gap-1 px-1.5 py-0.5 bg-cyber-accent/20 rounded text-[10px]">
                          <span className="font-mono">{optValue}</span>
                          <button
                            onClick={() => {
                              const newOptions = selectedOptions.filter((_, i) => i !== index);
                              setSelectedOptions(newOptions);
                            }}
                            className="text-cyber-muted hover:text-cyber-accent"
                          >
                            <XIcon size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={addQueueItem}
            className="w-full cyber-button bg-cyber-primary hover:bg-cyber-primary-dark text-white font-semibold py-2.5"
            disabled={!planCodeInput.trim() || selectedDatacenters.length === 0}
          >
            {selectedDatacenters.length > 0 && (() => {
              const qty = Number(quantityInput) || 1;
              const totalTasks = selectedDatacenters.length * qty;
              return qty > 1 
                ? `添加到队列（将创建 ${totalTasks} 个独立任务${selectedOptions.length > 0 ? `，含${selectedOptions.length}个可选配置` : ''}）`
                : `添加到队列（${selectedDatacenters.length} 个任务${selectedOptions.length > 0 ? `，含${selectedOptions.length}个可选配置` : ''}）`;
            })()}
            {selectedDatacenters.length === 0 && '添加到队列'}
          </button>
        </div>
      )}

      {/* Telegram WEBHOOK 下单说明 */}
      <div className="bg-cyber-surface-dark p-4 sm:p-6 rounded-lg shadow-xl border border-cyber-border">
        <h3 className={`${isMobile ? 'text-base' : 'text-lg'} font-semibold mb-3 text-cyber-primary-accent flex items-center gap-2`}>
          📱 Telegram WEBHOOK 下单说明
        </h3>
        <p className="text-sm text-cyber-muted mb-3">
          您可以通过 Telegram 发送特定格式的消息来快速下单。系统会自动解析消息并创建订单。
        </p>
        
        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-cyber-secondary mb-2">📝 消息格式：</p>
            <code className="block text-xs bg-cyber-dark p-2 rounded border border-cyber-border text-cyber-accent mb-1">
              plancode [datacenter] [quantity] [options]
            </code>
            <p className="text-xs text-cyber-muted">
              下单规则：可用配置 × 可用机房 × 指定数量 = 总订单数
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-cyber-secondary mb-2">💡 支持的模式：</p>
            <div className="space-y-2 text-xs">
              <div className="bg-cyber-grid/10 p-2 rounded border border-cyber-accent/20">
                <p className="text-cyber-accent font-mono mb-1">1. 24sk202</p>
                <p className="text-cyber-muted">只有型号，使用所有可用配置和所有可用机房，数量默认为1</p>
              </div>
              <div className="bg-cyber-grid/10 p-2 rounded border border-cyber-accent/20">
                <p className="text-cyber-accent font-mono mb-1">2. 24sk202 rbx 1</p>
                <p className="text-cyber-muted">型号 + 机房 + 数量（指定机房和数量）</p>
              </div>
              <div className="bg-cyber-grid/10 p-2 rounded border border-cyber-accent/20">
                <p className="text-cyber-accent font-mono mb-1">3. 24sk202 1</p>
                <p className="text-cyber-muted">型号 + 数量（不指定机房，使用所有可用机房）</p>
              </div>
              <div className="bg-cyber-grid/10 p-2 rounded border border-cyber-accent/20">
                <p className="text-cyber-accent font-mono mb-1">4. 24sk202 rbx 1 ram-64g-ecc-2133-24sk20,softraid-2x450nvme-24sk20</p>
                <p className="text-cyber-muted">完整格式：型号 + 机房 + 数量 + 可选配置（用逗号分隔）</p>
              </div>
              <div className="bg-cyber-grid/10 p-2 rounded border border-cyber-accent/20">
                <p className="text-cyber-accent font-mono mb-1">5. 24sk202 1 ram-64g-ecc-2133-24sk20,softraid-2x450nvme-24sk20</p>
                <p className="text-cyber-muted">型号 + 数量 + 可选配置（不指定机房）</p>
              </div>
            </div>
          </div>

          <div className="mt-3 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded">
            <p className="text-xs text-yellow-400">
              ⚠️ <strong>注意事项：</strong>
            </p>
            <ul className="text-xs text-yellow-300/80 mt-1 space-y-1 list-disc list-inside">
              <li>系统会自动过滤无货的配置和机房</li>
              <li>如果指定了配置选项，只会匹配包含这些选项的配置</li>
              <li>如果指定了机房，只会在该机房创建订单</li>
              <li>未指定的参数将使用默认值（所有可用配置/所有可用机房/数量1）</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Queue List */}
      <div>
        {/* 温馨提示 */}
        <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <p className="text-sm text-blue-300 flex items-start gap-2">
            <span className="text-base">💡</span>
            <span>
              <strong className="text-blue-200">温馨提示：</strong>
              已抢购成功的订单不会出现在抢购队列中，成功订单请前往
              <Link 
                to="/history" 
                className="text-cyber-accent hover:text-cyber-primary underline mx-1"
              >
                抢购历史
              </Link>
              查看订单详情。
            </span>
          </p>
        </div>
        
        <div className="space-y-3">
            {queueItems.map(item => (
              <div 
                key={item.id}
                className="bg-cyber-surface p-4 rounded-lg shadow-md border border-cyber-border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3"
              >
                <div className="flex-grow">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="px-2 py-0.5 text-xs bg-cyber-primary-accent/20 text-cyber-primary-accent rounded-full font-mono">
                      {item.planCode}
                    </span>
                    <span className="text-sm text-cyber-text-dimmed">DC: {item.datacenter.toUpperCase()}</span>
                    {item.groupId && (
                      <button
                        type="button"
                        onClick={() => copyText('Group ID', item.groupId)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] bg-cyber-grid/20 text-cyber-muted rounded-full font-mono hover:bg-cyber-grid/30"
                        title={item.groupId}
                      >
                        Group {shortId(item.groupId)}
                        <CopyIcon size={10} />
                      </button>
                    )}
                    {item.slotIndex && (
                      <span className="px-2 py-0.5 text-[10px] bg-cyber-grid/20 text-cyber-muted rounded-full">
                        Slot #{item.slotIndex}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => copyText('Task ID', item.id)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] bg-cyber-grid/20 text-cyber-muted rounded-full font-mono hover:bg-cyber-grid/30"
                      title={item.id}
                    >
                      Task {shortId(item.id)}
                      <CopyIcon size={10} />
                    </button>
                    {item.strictConfig && (
                      <span className="px-2 py-0.5 text-[10px] bg-yellow-500/15 text-yellow-300 rounded-full">
                        严格配置
                      </span>
                    )}
                    {item.options && item.options.length > 0 && (
                      <span className="px-2 py-0.5 text-xs bg-cyber-accent/20 text-cyber-accent rounded-full">
                        含 {item.options.length} 个可选配置
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-cyber-muted">
                    阶段: {item.phase || 'queued'} | 下次尝试: {item.retryCount > 0 ? `${item.retryInterval}秒后 (第${item.retryCount + 1}次)` : `即将开始` } | 创建于: {new Date(item.createdAt).toLocaleString()}
                  </p>
                  {(item.requestedOptions && item.requestedOptions.length > 0) && (
                    <p className="text-xs text-cyber-muted mt-1 break-all">
                      🎯 请求配置: {item.requestedOptions.join(', ')}
                    </p>
                  )}
                  {(item.actualCartOptions && item.actualCartOptions.length > 0) && (
                    <p className="text-xs text-cyber-muted mt-1 break-all">
                      🛒 实际购物车配置: {item.actualCartOptions.join(', ')}
                    </p>
                  )}
                  {item.failureCode && (
                    <p className="text-xs text-red-300 mt-1 break-all">
                      ❌ {item.failureCode}{item.failureDetail ? `：${item.failureDetail}` : ''}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-2 sm:mt-0 flex-shrink-0">
                  <span 
                    className={`text-xs px-2 py-1 rounded-full font-medium
                      ${item.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                        item.status === 'running' ? 'bg-green-500/20 text-green-400' :
                        item.status === 'paused' ? 'bg-orange-500/20 text-orange-400' :
                        item.status === 'completed' ? 'bg-blue-500/20 text-blue-400' :
                        item.status === 'failed' ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400'}
                    `}
                  >
                    {item.status === "pending" && "待命中"}
                    {item.status === "running" && "运行中"}
                    {item.status === "paused" && "已暂停"}
                    {item.status === "completed" && "已完成"}
                    {item.status === "failed" && "失败"}
                  </span>
                  <button 
                    onClick={() => toggleQueueItemStatus(item.id, item.status)}
                    className="p-1.5 hover:bg-cyber-hover rounded text-cyber-secondary hover:text-cyber-primary transition-colors"
                    title={item.status === 'running' ? "暂停" : item.status === 'paused' ? "恢复" : "启动"}
                  >
                    {item.status === 'running' ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
                  </button>
                  <button 
                    onClick={() => removeQueueItem(item.id)}
                    className="p-1.5 hover:bg-cyber-hover rounded text-cyber-secondary hover:text-red-500 transition-colors"
                    title="移除"
                  >
                    <Trash2Icon size={16} />
                  </button>
                </div>
              </div>
            ))}
        </div>
      </div>
      
      {/* 确认清空对话框 */}
      {createPortal(
        <AnimatePresence>
          {showClearConfirm && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999]"
                onClick={() => setShowClearConfirm(false)}
              />
              <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 pointer-events-none">
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="cyber-card p-6 max-w-md w-full pointer-events-auto"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h3 className="text-xl font-bold text-cyber-text mb-2">⚠️ 确认清空</h3>
                  <p className="text-cyber-muted mb-6 whitespace-pre-line">
                    确定要清空所有队列任务吗？{'\n'}
                    <span className="text-red-400 text-sm">此操作不可撤销。</span>
                  </p>
                  <div className="flex gap-3 justify-end">
                    <button
                      onClick={() => setShowClearConfirm(false)}
                      className="cyber-button px-4 py-2"
                    >
                      取消
                    </button>
                    <button
                      onClick={clearAllQueue}
                      className="cyber-button px-4 py-2 bg-cyber-accent/20 border-cyber-accent/40 text-cyber-accent hover:bg-cyber-accent/30 hover:border-cyber-accent/60 hover:text-cyber-accent"
                    >
                      确认清空
                    </button>
                  </div>
                </motion.div>
              </div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
};

export default QueuePage;
