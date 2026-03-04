/**
 * SkillBridge — YouTube Auto-Subtitle Enabler
 *
 * Features:
 * 1. Auto-enable subtitles on YouTube embeds (cc_load_policy + postMessage)
 * 2. Auto-translate subtitles to user's target language
 * 3. MutationObserver to catch lazily-loaded iframes
 */

class YouTubeSubtitleManager {
  constructor(translator, targetLang) {
    this.translator = translator;
    this.targetLang = targetLang;
    this._iframes = new Set();
    this._observer = null;
  }

  /**
   * Initialize: find all YouTube embeds, enable subtitles,
   * and start observing for new iframes added later.
   */
  async initialize() {
    this._processExistingIframes();
    this._startObserving();

    // Retry after delays — Skilljar may lazy-load video sections
    setTimeout(() => this._processExistingIframes(), 2000);
    setTimeout(() => this._processExistingIframes(), 5000);
  }

  /**
   * Find and process all YouTube embed iframes currently in the DOM.
   */
  _processExistingIframes() {
    const iframes = document.querySelectorAll(
      'iframe[src*="youtube.com/embed"], iframe[src*="youtube-nocookie.com/embed"]'
    );
    if (iframes.length === 0) return;

    for (const iframe of iframes) {
      if (this._iframes.has(iframe)) continue; // Already processed
      console.log(`[SkillBridge] Found YouTube embed, enabling auto-subtitles`);
      this._enableAutoSubtitles(iframe);
      this._iframes.add(iframe);
    }
  }

  /**
   * Watch for dynamically added YouTube iframes (lazy-loaded content).
   */
  _startObserving() {
    if (this._observer) return;

    this._observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          // Check if the added node IS a YouTube iframe
          if (node.tagName === 'IFRAME' && this._isYouTubeEmbed(node)) {
            if (!this._iframes.has(node)) {
              console.log('[SkillBridge] New YouTube iframe detected');
              this._enableAutoSubtitles(node);
              this._iframes.add(node);
            }
          }

          // Check children for YouTube iframes
          const childIframes = node.querySelectorAll?.(
            'iframe[src*="youtube.com/embed"], iframe[src*="youtube-nocookie.com/embed"]'
          );
          if (childIframes) {
            for (const iframe of childIframes) {
              if (!this._iframes.has(iframe)) {
                console.log('[SkillBridge] New YouTube iframe detected (child)');
                this._enableAutoSubtitles(iframe);
                this._iframes.add(iframe);
              }
            }
          }
        }
      }
    });

    this._observer.observe(document.body, { childList: true, subtree: true });
  }

  _isYouTubeEmbed(iframe) {
    const src = iframe.src || '';
    return src.includes('youtube.com/embed') || src.includes('youtube-nocookie.com/embed');
  }

  /**
   * Update target language and re-apply to all iframes.
   */
  setLanguage(newLang) {
    this.targetLang = newLang;
    for (const iframe of this._iframes) {
      this._enableAutoSubtitles(iframe);
    }
  }

  destroy() {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    this._iframes.clear();
  }

  // ==================== SUBTITLE AUTO-ENABLE ====================

  _ytLangCode(lang) {
    const map = {
      'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant', 'pt-BR': 'pt',
    };
    return map[lang] || lang;
  }

  _ytLangName(lang) {
    const names = {
      'ko': 'Korean', 'ja': 'Japanese', 'zh-CN': 'Chinese (Simplified)',
      'zh-TW': 'Chinese (Traditional)', 'es': 'Spanish', 'fr': 'French',
      'de': 'German', 'pt-BR': 'Portuguese', 'pt': 'Portuguese',
      'vi': 'Vietnamese', 'th': 'Thai', 'id': 'Indonesian', 'ar': 'Arabic',
      'hi': 'Hindi', 'ru': 'Russian', 'tr': 'Turkish', 'it': 'Italian',
      'nl': 'Dutch', 'pl': 'Polish', 'uk': 'Ukrainian', 'cs': 'Czech',
      'sv': 'Swedish', 'da': 'Danish', 'fi': 'Finnish', 'no': 'Norwegian',
      'ms': 'Malay', 'tl': 'Filipino', 'bn': 'Bengali', 'he': 'Hebrew',
      'ro': 'Romanian', 'hu': 'Hungarian', 'el': 'Greek',
    };
    return names[lang] || lang;
  }

  /**
   * Enable auto-subtitles on a YouTube embed iframe.
   * Sets cc_load_policy=1 to force captions on, and cc_lang_pref
   * to prefer the user's language. After iframe loads, sends
   * postMessage commands to load the captions module and set
   * auto-translation to the target language.
   */
  _enableAutoSubtitles(iframe) {
    try {
      const url = new URL(iframe.src);

      // Force captions on + enable JS API for postMessage control
      url.searchParams.set('cc_load_policy', '1');
      url.searchParams.set('enablejsapi', '1');

      // Set origin for postMessage security
      url.searchParams.set('origin', window.location.origin);

      if (this.targetLang && this.targetLang !== 'en') {
        url.searchParams.set('cc_lang_pref', this._ytLangCode(this.targetLang));
        url.searchParams.set('hl', this._ytLangCode(this.targetLang));
      }

      const newSrc = url.toString();
      if (iframe.src !== newSrc) {
        console.log(`[SkillBridge] Setting iframe src with cc_load_policy=1, lang=${this.targetLang || 'en'}`);
        iframe.src = newSrc;

        // After iframe loads, send postMessage to enable auto-translate
        if (this.targetLang && this.targetLang !== 'en') {
          iframe.addEventListener('load', () => {
            this._setAutoTranslate(iframe);
          }, { once: true });
        }
      } else {
        // Src already set — still try postMessage in case player is ready
        if (this.targetLang && this.targetLang !== 'en') {
          this._setAutoTranslate(iframe);
        }
      }
    } catch (err) {
      console.warn('[SkillBridge] Failed to enable subtitles:', err);
    }
  }

  /**
   * Use YouTube IFrame API postMessage to set auto-translation.
   * Sends commands with retries to handle varying player load times.
   */
  _setAutoTranslate(iframe) {
    const ytLang = this._ytLangCode(this.targetLang);

    const sendCaptionCommands = (delay) => {
      setTimeout(() => {
        try {
          // Load captions module
          iframe.contentWindow.postMessage(JSON.stringify({
            event: 'command',
            func: 'loadModule',
            args: ['captions']
          }), '*');

          // Set caption track with auto-translate
          setTimeout(() => {
            try {
              iframe.contentWindow.postMessage(JSON.stringify({
                event: 'command',
                func: 'setOption',
                args: ['captions', 'track', {
                  languageCode: 'en',
                  translationLanguage: {
                    languageCode: ytLang,
                    languageName: this._ytLangName(this.targetLang)
                  }
                }]
              }), '*');
              console.log(`[SkillBridge] Auto-translate caption → ${ytLang} (delay: ${delay}ms)`);
            } catch (err) {
              // Silent — cross-origin postMessage may fail
            }
          }, 1000);
        } catch (err) {
          // Silent
        }
      }, delay);
    };

    // Send commands at multiple delays to handle varying player load times
    sendCaptionCommands(1500);
    sendCaptionCommands(3000);
    sendCaptionCommands(5000);
  }
}

if (typeof window !== 'undefined') {
  window.YouTubeSubtitleManager = YouTubeSubtitleManager;
}
