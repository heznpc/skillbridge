/**
 * Skilljar i18n Assistant - AI Translation Engine
 * Uses a bridge iframe to load Puter.js (bypasses Chrome extension CSP)
 * The bridge.html is a web_accessible_resource that can load external scripts
 *
 * Copyright respecting: translates on-the-fly only, never stores or redistributes original content
 */

class SkilljarTranslator {
  constructor() {
    this.cache = new Map();
    this.maxCacheSize = 500;
    this.isReady = false;
    this.pendingCallbacks = new Map();
    this.requestId = 0;
    this.bridgeIframe = null;
    this.rateLimitDelay = 400;
    this.lastRequestTime = 0;
    this.supportedLanguages = {
      'ko': '한국어',
      'ja': '日本語',
      'zh-CN': '中文(简体)',
      'zh-TW': '中文(繁體)',
      'es': 'Español',
      'fr': 'Français',
      'de': 'Deutsch',
      'pt-BR': 'Português (BR)',
      'vi': 'Tiếng Việt',
      'th': 'ภาษาไทย',
      'id': 'Bahasa Indonesia',
      'ar': 'العربية',
      'hi': 'हिन्दी',
      'ru': 'Русский',
      'tr': 'Türkçe',
    };
  }

  async initialize() {
    try {
      // Set up the global message listener ONCE
      this._setupMessageListener();
      await this._createBridge();
      console.log('[Skilljar i18n] Translator initialized successfully');
      return true;
    } catch (err) {
      console.error('[Skilljar i18n] Failed to initialize translator:', err);
      return false;
    }
  }

  /**
   * Single global message listener for all bridge responses
   */
  _setupMessageListener() {
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || !data.type) return;

      if (data.type === 'PUTER_BRIDGE_READY') {
        console.log('[Skilljar i18n] Received PUTER_BRIDGE_READY');
        this.isReady = true;
        if (this._bridgeReadyResolve) {
          this._bridgeReadyResolve();
          this._bridgeReadyResolve = null;
        }
      }

      if (data.type === 'PUTER_BRIDGE_ERROR') {
        console.error('[Skilljar i18n] Bridge error:', data.error);
        if (this._bridgeReadyReject) {
          this._bridgeReadyReject(new Error(data.error));
          this._bridgeReadyReject = null;
        }
      }

      if (data.type === 'TRANSLATE_RESPONSE' || data.type === 'CHAT_RESPONSE') {
        const cb = this.pendingCallbacks.get(data.id);
        if (cb) {
          this.pendingCallbacks.delete(data.id);
          cb(data);
        }
      }
    });
  }

  /**
   * Creates a hidden iframe that loads bridge.html
   * bridge.html is a web_accessible_resource that can load Puter.js externally
   * No sandbox attribute - let it run with full capabilities
   */
  _createBridge() {
    return new Promise((resolve, reject) => {
      this._bridgeReadyResolve = resolve;
      this._bridgeReadyReject = reject;

      const bridgeUrl = chrome.runtime.getURL('src/bridge/bridge.html');
      console.log('[Skilljar i18n] Loading bridge from:', bridgeUrl);

      const iframe = document.createElement('iframe');
      iframe.src = bridgeUrl;
      iframe.id = 'skilljar-i18n-bridge';
      // Hidden but still functional - NO sandbox attribute
      iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;opacity:0;pointer-events:none;';
      // Allow the iframe to load scripts
      iframe.allow = 'scripts';

      this.bridgeIframe = iframe;

      // Timeout after 20 seconds
      const timeout = setTimeout(() => {
        console.warn('[Skilljar i18n] Bridge timed out after 20s');
        this._bridgeReadyResolve = null;
        this._bridgeReadyReject = null;
        reject(new Error('Bridge timed out. Check if Puter.js is accessible.'));
      }, 20000);

      // Clear timeout when resolved/rejected
      const origResolve = resolve;
      const origReject = reject;
      this._bridgeReadyResolve = () => {
        clearTimeout(timeout);
        origResolve();
      };
      this._bridgeReadyReject = (err) => {
        clearTimeout(timeout);
        origReject(err);
      };

      // Handle iframe load errors
      iframe.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Bridge iframe failed to load'));
      };

      document.documentElement.appendChild(iframe);
      console.log('[Skilljar i18n] Bridge iframe appended to page');
    });
  }

  /**
   * Send a request to the bridge iframe and wait for response
   */
  _sendToBridge(message) {
    return new Promise((resolve, reject) => {
      if (!this.bridgeIframe) {
        reject(new Error('Bridge not created'));
        return;
      }
      if (!this.isReady) {
        reject(new Error('Bridge not ready'));
        return;
      }

      const id = ++this.requestId;
      message.id = id;

      const timeout = setTimeout(() => {
        this.pendingCallbacks.delete(id);
        console.warn('[Skilljar i18n] Request', id, 'timed out');
        resolve(message.text || message.userMessage || 'Translation timed out');
      }, 30000);

      this.pendingCallbacks.set(id, (response) => {
        clearTimeout(timeout);
        resolve(response.result);
      });

      try {
        this.bridgeIframe.contentWindow.postMessage(message, '*');
      } catch (e) {
        clearTimeout(timeout);
        this.pendingCallbacks.delete(id);
        console.error('[Skilljar i18n] postMessage failed:', e);
        resolve(message.text || message.userMessage || 'Error');
      }
    });
  }

  getCacheKey(text, targetLang) {
    return `${targetLang}::${text.substring(0, 100)}`;
  }

  async translate(text, targetLang, context = '') {
    if (!text || !text.trim()) return text;
    if (targetLang === 'en') return text;

    const cacheKey = this.getCacheKey(text, targetLang);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // Rate limiting
    const now = Date.now();
    const timeSinceLast = now - this.lastRequestTime;
    if (timeSinceLast < this.rateLimitDelay) {
      await new Promise(r => setTimeout(r, this.rateLimitDelay - timeSinceLast));
    }
    this.lastRequestTime = Date.now();

    try {
      const langName = this.supportedLanguages[targetLang] || targetLang;
      const systemPrompt = `You are a professional translator for technical education content. Translate the following text to ${langName}.
Rules:
- Keep technical terms (API, SDK, Claude, Anthropic, etc.) in English
- Maintain markdown formatting if present
- Keep code snippets unchanged
- Be natural and fluent, not literal
${context ? `Context: ${context}` : ''}
Return ONLY the translated text, nothing else.`;

      const translated = await this._sendToBridge({
        type: 'TRANSLATE_REQUEST',
        systemPrompt,
        text,
        targetLang,
        model: 'glm-4-flash',
      });

      // Cache
      if (this.cache.size >= this.maxCacheSize) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }
      this.cache.set(cacheKey, translated);

      return translated;
    } catch (err) {
      console.error('[Skilljar i18n] Translation error:', err);
      return text;
    }
  }

  async chat(userMessage, targetLang, courseContext = '') {
    try {
      const langName = this.supportedLanguages[targetLang] || 'English';
      const systemPrompt = `You are a helpful AI learning assistant for Anthropic's training courses on Skilljar.
Respond in ${langName}.
You help students understand course material, answer questions, and provide explanations.
Keep technical terms in English when appropriate.
Be encouraging and supportive.
${courseContext ? `Current course context: ${courseContext}` : ''}`;

      return await this._sendToBridge({
        type: 'CHAT_REQUEST',
        systemPrompt,
        userMessage,
        model: 'glm-4-flash',
      });
    } catch (err) {
      console.error('[Skilljar i18n] Chat error:', err);
      return targetLang === 'ko'
        ? '죄송합니다. 응답을 생성하지 못했습니다. 잠시 후 다시 시도해주세요.'
        : 'Sorry, I could not generate a response. Please try again.';
    }
  }

  clearCache() {
    this.cache.clear();
  }
}

if (typeof window !== 'undefined') {
  window.SkilljarTranslator = SkilljarTranslator;
}
