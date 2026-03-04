/**
 * SkillBridge — YouTube Auto-Subtitle Enabler
 *
 * Features:
 * 1. Auto-enable subtitles on YouTube embeds (cc_load_policy + postMessage)
 * 2. Auto-translate subtitles to user's target language
 */

class YouTubeSubtitleManager {
  constructor(translator, targetLang) {
    this.translator = translator;
    this.targetLang = targetLang;
    this._iframes = [];
  }

  /**
   * Initialize: find all YouTube embeds and enable subtitles.
   */
  async initialize() {
    const iframes = document.querySelectorAll(
      'iframe[src*="youtube.com/embed"], iframe[src*="youtube-nocookie.com/embed"]'
    );
    if (iframes.length === 0) {
      console.log('[SkillBridge] No YouTube embeds found');
      return;
    }

    console.log(`[SkillBridge] Found ${iframes.length} YouTube embed(s)`);

    for (const iframe of iframes) {
      this._enableAutoSubtitles(iframe);
      this._iframes.push(iframe);
    }
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
    this._iframes = [];
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

      // Force captions on + enable JS API
      url.searchParams.set('cc_load_policy', '1');
      url.searchParams.set('enablejsapi', '1');

      if (this.targetLang && this.targetLang !== 'en') {
        url.searchParams.set('cc_lang_pref', this._ytLangCode(this.targetLang));
        url.searchParams.set('hl', this._ytLangCode(this.targetLang));
      }

      const newSrc = url.toString();
      if (iframe.src !== newSrc) {
        console.log(`[SkillBridge] Enabling auto-subtitles (${this.targetLang || 'en'})`);
        iframe.src = newSrc;

        // After iframe loads, send postMessage to enable auto-translate
        if (this.targetLang && this.targetLang !== 'en') {
          iframe.addEventListener('load', () => {
            this._setAutoTranslate(iframe);
          }, { once: true });
        }
      }
    } catch (err) {
      console.warn('[SkillBridge] Failed to enable subtitles:', err);
    }
  }

  /**
   * Use YouTube IFrame API postMessage to set auto-translation.
   * First loads the captions module, then sets the track to
   * English with auto-translation to the target language.
   */
  _setAutoTranslate(iframe) {
    const ytLang = this._ytLangCode(this.targetLang);

    // Step 1: Load captions module (wait 2s for player to initialize)
    setTimeout(() => {
      try {
        iframe.contentWindow.postMessage(JSON.stringify({
          event: 'command',
          func: 'loadModule',
          args: ['captions']
        }), '*');

        // Step 2: Set caption track with auto-translate (wait 1.5s for module)
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
            console.log(`[SkillBridge] Auto-translate caption → ${ytLang}`);
          } catch (err) {
            console.warn('[SkillBridge] setOption failed:', err);
          }
        }, 1500);
      } catch (err) {
        console.warn('[SkillBridge] loadModule failed:', err);
      }
    }, 2000);
  }
}

if (typeof window !== 'undefined') {
  window.YouTubeSubtitleManager = YouTubeSubtitleManager;
}
