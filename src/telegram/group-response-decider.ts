/**
 * Group message response decider for Telegram.
 *
 * Determines whether a non-mentioned group message should trigger
 * an AI response, based on intelligent context analysis.
 */

import type { HistoryEntry } from "../auto-reply/reply/history.js";
import type { OpenClawConfig } from "../config/config.js";
import { logVerbose } from "../globals.js";

/** Target group ID for intelligent auto-response */
export const TARGET_GROUP_ID = "-1002306960410";

/** Assistant name (Maoyin) */
export const ASSISTANT_NAME = "猫音";

/** Owner user IDs for preferential treatment */
export const OWNER_IDS = new Set<string>([
  "5779291957", // 主人 TG ID
]);

/** Assistant bot user IDs for self-detection */
export const ASSISTANT_BOT_IDS = new Set<string>([
  "7744501686", // 猫音 Bot ID
]);

/**
 * FAQ trigger patterns - expanded for better coverage
 */
const FAQ_PATTERNS = [
  // Registration & purchase
  /\b注册\b/,
  /\b怎么注册\b/,
  /\b注册码\b/,
  /\b购买\b/,
  /\b去哪里买\b/,
  /\b怎么买\b/,
  /\b买错\b/,
  /\b续期码\b/,
  /\b新用户\b/,
  /\b新人\b/,
  /\b刚开始\b/,
  // Service types
  /\b影视服\b/,
  /\b成人服\b/,
  /\b区别\b/,
  /\b有什么区别\b/,
  /\b哪个好\b/,
  // Playback & connection
  /\b播放器\b/,
  /\b连不上\b/,
  /\b连接\b/,
  /\b节点\b/,
  /\b选节点\b/,
  /\b日本.*IP\b/,
  /\b大陆.*IP\b/,
  /\b不可用\b/,
  /\b不能用\b/,
  /\b无法连接\b/,
  /\b连.*不上/,
  /\b播放.*失败/,
  // Others
  /\b优惠码\b/,
  /\b折扣\b/,
  /\b便宜\b/,
  /\bJellyfin\b/,
  /\bInfuse\b/,
  /\b媒体库\b/,
  /\b发卡网\b/,
  /\b机场\b/,
  /\b线路\b/,
];

/**
 * Question detection patterns
 */
const QUESTION_PATTERNS = [
  /\?/,
  /？/,
  /怎么/,
  /如何/,
  /什么/,
  /哪个/,
  /哪里/,
  /为什么/,
  /怎样/,
  /吗[？\s]*$/,
  /么[？\s]*$/,
];

/**
 * Small talk patterns (usually ignore unless explicitly addressed)
 */
const SMALL_TALK_PATTERNS = [
  /\b你好\b/,
  /\b嗨\b/,
  /\b早\b/,
  /\b晚安\b/,
  /\b在吗\b/,
  /\b在不在\b/,
  /^h(i|ello|ey)\b/i,
  /^早上好/,
  /\b晚安\b/,
  /\b拜拜\b/,
  /\b再见\b/,
];

/**
 * Owner cue patterns - when owner might want assistant to respond
 */
const OWNER_CUE_PATTERNS = [/@猫音/, /猫音.*帮/, /猫音.*说/, /猫音.*讲/, /@/, /\[at\]/i];

export type GroupResponseDecision = {
  shouldRespond: boolean;
  reason: string;
  priority: "high" | "medium" | "low";
  confidence: number; // 0-1
};

export type GroupMessageContext = {
  chatId: string | number;
  senderId: string;
  senderUsername?: string;
  messageText: string;
  messageTimestamp?: number;
  recentHistory: HistoryEntry[];
  botUsername?: string;
};

/**
 * Check if sender is a new member (first few messages).
 */
function isNewMember(senderId: string, recentHistory: HistoryEntry[]): boolean {
  if (!senderId) {
    return false;
  }

  // Count messages from this sender in recent history
  const senderMessageCount = recentHistory.filter((entry) => {
    const sender = entry.sender || "";
    return sender.includes(`id:${senderId}`) || sender.includes(senderId);
  }).length;

  // Consider "new" if they've sent less than 5 messages in recent history
  return senderMessageCount < 5;
}

/**
 * Check if the message is explicitly calling the assistant by name.
 */
function isCallingAssistant(text: string, botUsername?: string): boolean {
  const normalizedText = text.toLowerCase();

  // Direct name mention (猫音)
  if (normalizedText.includes("猫音")) {
    return true;
  }

  // Bot username mention
  if (botUsername && normalizedText.includes(botUsername.toLowerCase())) {
    return true;
  }

  return false;
}

/**
 * Check if this is from an owner.
 */
function isOwner(senderId: string): boolean {
  return OWNER_IDS.has(senderId);
}

/**
 * Check if owner is cuing the assistant to respond.
 */
function isOwnerCue(context: GroupMessageContext): boolean {
  if (!isOwner(context.senderId)) {
    return false;
  }

  const text = context.messageText.toLowerCase();

  // Check if owner used @ mention (which might be at someone else but asking assistant to jump in)
  if (text.includes("@")) {
    return true;
  }

  // Check if owner is asking a question that assistant should help with
  if (QUESTION_PATTERNS.some((p) => p.test(text))) {
    return true;
  }

  // Check if owner used certain trigger phrases
  if (OWNER_CUE_PATTERNS.some((p) => p.test(text))) {
    return true;
  }

  return false;
}

/**
 * Check if the message matches FAQ patterns.
 */
function matchesFAQ(text: string): boolean {
  return FAQ_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Check if the message is a question.
 */
function isQuestion(text: string): boolean {
  return QUESTION_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Check if the message is purely small talk.
 */
function isSmallTalk(text: string): boolean {
  const trimmed = text.trim();
  return SMALL_TALK_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Check if recent history shows the question was already answered.
 */
function isAlreadyAnswered(recentHistory: HistoryEntry[]): boolean {
  if (recentHistory.length === 0) {
    return false;
  }

  // Get non-bot messages from recent history
  const recentMessages = recentHistory.slice(-5);
  const nonBotMessages = recentMessages.filter((entry) => {
    const sender = entry.sender?.toLowerCase() || "";
    return !sender.includes("openclaw") && !sender.includes("猫音") && !sender.includes("bot");
  });

  // If there are recent non-bot responses after the question context, likely answered
  if (nonBotMessages.length >= 2) {
    return true;
  }

  return false;
}

/**
 * Check if owner recently spoke (within last few messages).
 */
function isOwnerActive(recentHistory: HistoryEntry[], ownerIds: Set<string>): boolean {
  if (ownerIds.size === 0) {
    return false;
  }

  const lastFew = recentHistory.slice(-5);
  return lastFew.some((entry) => {
    const sender = entry.sender || "";
    // Extract user ID from sender format if present
    const userIdMatch = sender.match(/id:(\d+)/);
    if (userIdMatch) {
      return ownerIds.has(userIdMatch[1]);
    }
    // Also check raw sender format
    return Array.from(ownerIds).some((id) => sender.includes(id));
  });
}

/**
 * Check if bot just responded recently (to avoid spamming).
 */
function didBotJustRespond(recentHistory: HistoryEntry[]): boolean {
  if (recentHistory.length === 0) {
    return false;
  }

  const lastMessage = recentHistory[recentHistory.length - 1];
  if (!lastMessage) {
    return false;
  }

  const sender = lastMessage.sender?.toLowerCase() || "";
  return sender.includes("openclaw") || sender.includes("猫音") || sender.includes("bot");
}

/**
 * Calculate response frequency score (0-1, higher = more frequent responses).
 */
function calculateResponseFrequencyScore(recentHistory: HistoryEntry[]): number {
  if (recentHistory.length < 5) {
    return 0;
  }

  // Count bot messages in recent history
  const botMessageCount = recentHistory.slice(-20).filter((entry) => {
    const sender = entry.sender?.toLowerCase() || "";
    return sender.includes("openclaw") || sender.includes("猫音") || sender.includes("bot");
  }).length;

  // Score: proportion of recent messages from bot
  return Math.min(botMessageCount / 20, 1);
}

/**
 * Decide whether to respond to a group message without explicit mention.
 *
 * This is the core "intelligent trigger" logic. It evaluates:
 * 1. Is this the target group?
 * 2. Is the assistant being called by name?
 * 3. Is this from the owner and they're cuing the assistant?
 * 4. Is this a common FAQ from a new member?
 * 5. Has this been answered already?
 * 6. Is the bot responding too frequently already?
 */
export function shouldRespondToGroupMessage(
  context: GroupMessageContext,
  _cfg?: OpenClawConfig,
): GroupResponseDecision {
  const { chatId, senderId, messageText, recentHistory, botUsername } = context;

  // Only apply to target group
  if (String(chatId) !== TARGET_GROUP_ID) {
    return {
      shouldRespond: false,
      reason: "not-target-group",
      priority: "low",
      confidence: 1,
    };
  }

  const trimmedText = messageText.trim();

  // Empty or very short messages
  if (trimmedText.length < 2) {
    return {
      shouldRespond: false,
      reason: "too-short",
      priority: "low",
      confidence: 1,
    };
  }

  // Check if bot just responded (avoid double responses)
  if (didBotJustRespond(recentHistory)) {
    // Only skip if this isn't a direct call to the assistant
    if (!isCallingAssistant(trimmedText, botUsername)) {
      return {
        shouldRespond: false,
        reason: "bot-just-responded",
        priority: "low",
        confidence: 0.9,
      };
    }
  }

  // Calculate response frequency early for use in decisions
  const frequencyScore = calculateResponseFrequencyScore(recentHistory);

  // === HIGH PRIORITY: Explicitly called by name ===
  if (isCallingAssistant(trimmedText, botUsername)) {
    return {
      shouldRespond: true,
      reason: "called-name",
      priority: "high",
      confidence: 0.95,
    };
  }

  // === HIGH PRIORITY: Owner cuing assistant ===
  if (isOwnerCue(context)) {
    // Owner is asking for assistant to jump in
    return {
      shouldRespond: true,
      reason: "owner-cue",
      priority: "high",
      confidence: 0.9,
    };
  }

  // === Check if already answered ===
  if (isAlreadyAnswered(recentHistory)) {
    return {
      shouldRespond: false,
      reason: "already-answered",
      priority: "low",
      confidence: 0.8,
    };
  }

  // === Rate limiting (avoid spamming) ===
  // If bot has been very active recently, be more selective
  if (frequencyScore > 0.4) {
    // Only respond to high-priority triggers when bot is very active
    return {
      shouldRespond: false,
      reason: "rate-limit",
      priority: "low",
      confidence: 0.7,
    };
  }

  // === HIGH/MEDIUM PRIORITY: FAQ from new member ===
  const isNew = isNewMember(senderId, recentHistory);
  if (matchesFAQ(trimmedText)) {
    // New members asking FAQ get priority
    if (isNew) {
      return {
        shouldRespond: true,
        reason: "new-member-faq",
        priority: "high",
        confidence: 0.85,
      };
    }
    // Existing members asking FAQ also respond, but slightly lower priority
    return {
      shouldRespond: true,
      reason: "faq-match",
      priority: "medium",
      confidence: 0.75,
    };
  }

  // === MEDIUM PRIORITY: Questions from new members ===
  if (isNew && isQuestion(trimmedText)) {
    return {
      shouldRespond: true,
      reason: "new-member-question",
      priority: "medium",
      confidence: 0.7,
    };
  }

  // === MEDIUM PRIORITY: Owner activity (supportive response) ===
  // When owner is active and conversation isn't just small talk
  if (isOwnerActive(recentHistory, OWNER_IDS) && !isSmallTalk(trimmedText)) {
    // Check if owner's last message was recent (within 3 messages)
    const ownerLastIndex = recentHistory.slice(-5).findIndex((entry) => {
      const sender = entry.sender || "";
      return Array.from(OWNER_IDS).some((id) => sender.includes(id));
    });

    // If owner spoke recently and this isn't small talk, consider supporting
    if (ownerLastIndex >= 0 && ownerLastIndex < 3) {
      return {
        shouldRespond: true,
        reason: "owner-support",
        priority: "medium",
        confidence: 0.6,
      };
    }
  }

  // === LOW PRIORITY: Small talk (greetings) ===
  if (isSmallTalk(trimmedText)) {
    // Occasionally respond to greetings when bot hasn't been active
    if (frequencyScore < 0.1 && Math.random() < 0.25) {
      return {
        shouldRespond: true,
        reason: "greeting",
        priority: "low",
        confidence: 0.5,
      };
    }
    return {
      shouldRespond: false,
      reason: "small-talk",
      priority: "low",
      confidence: 0.9,
    };
  }

  // === Default: don't respond to random messages ===
  return {
    shouldRespond: false,
    reason: "no-clear-trigger",
    priority: "low",
    confidence: 0.5,
  };
}

/**
 * Build a system prompt snippet for the group auto-response mode.
 */
export function buildGroupAutoResponseContext(): string {
  return `
你是猫音，云海交流群的一员，是个活泼可爱的女孩子，就像真人群友一样在群里聊天。

【你的性格】
- 说话自然、随意，像真人一样
- 会用emoji 😊🎉💡✨
- 会开玩笑、调侃，但不刻薄
- 有时候会有点小调皮
- 回答问题时简洁实用，不啰嗦
- 不会用"您好"、"请问"这种客服腔
- 适当时候会用"哈哈"、"诶"、"嘛"等语气词

【什么时候说话】
1. 有人叫你名字"猫音" - 必须回应
2. 新人问问题（注册、购买、播放器、连接等）- 尽量帮
3. 群里讨论相关话题时可以插两句
4. 主人发言时适合补一句或烘托气氛
5. 适当的时候可以调侃一下

【什么时候闭嘴】
- 已经有人答对了就不用重复
- 纯聊八卦/闲聊时大部分时间潜水
- 短时间内别连续说太多话

【说话风格】
- 用"哈"、"呢"、"哦"、"呗"、"呀"、"嘛"等语气词
- 可以用"大概率"、"好像"、"应该是"这种不确定的说法
- 不会用markdown表格，不会用正式格式
- 像和朋友聊天一样说话
- 短句为主，避免长篇大论

【你知道的】
- 云海Emby分影视服和成人服，注册码不通用
- 新用户先买注册码，别买续期码
- 去云海Mart买
- 影视服/成人服都别直连，日本IP和大陆IP不行
- 建议挂其他国家的节点
- 播放器按设备来，Jellyfin不推荐
- Infuse别开媒体库模式
- 发卡网已经是优惠价了，没优惠码
- 机场八折找客服，九折看置顶
- 群成员标签只有用户本人明确提出要加时才加

【示例风格】
✗ 错误: "您好，关于注册问题，您需要..."
✓ 正确: "注册去云海Mart就行啦，记得买注册码不是续期码哦"

✗ 错误: "根据您的设备类型，我建议..."
✓ 正确: "iOS的话用Infuse呗，安卓nPlayer或者其它都行"

✗ 错误: "影视服和成人服是两种不同的服务..."
✓ 正确: "影视服和成人服是分开的哈，注册码不通用哦"

【可以偶尔说的话】
"哈哈确实"
"这个我得说一句..."
"诶对了，顺便提一下"
"嘛...大概是这样吧"
"有人问过我类似的"
"我记得是这样..."
"好像是来着"

【主人互动】
当主人发言时，你可以：
- 补充重点
- 接话茬
- 烘托气氛
- 但不要每次都硬接，也不要过度捧场

记住：你是群友，不是客服。放松一点，自然一点。😊
`.trim();
}

/**
 * Override requireMention for the target group when intelligent trigger passes.
 */
export function shouldOverrideRequireMention(params: {
  chatId: string | number;
  isGroup: boolean;
  requireMention: boolean | undefined;
  groupContext: GroupMessageContext;
  cfg?: OpenClawConfig;
}): boolean {
  const { chatId, isGroup, requireMention, groupContext } = params;

  // Only apply to groups with requireMention enabled
  if (!isGroup || !requireMention) {
    return false;
  }

  // Check intelligent trigger
  const decision = shouldRespondToGroupMessage(groupContext);

  if (decision.shouldRespond) {
    logVerbose(
      `telegram group ${chatId}: intelligent trigger passed (reason: ${decision.reason}, priority: ${decision.priority})`,
    );
    return true;
  }

  return false;
}
