/**
 * SkillBridge - YouTube Auto-Subtitle Enabler + Transcript Panel
 *
 * Features:
 * 1. Auto-enable subtitles on YouTube embeds (cc_load_policy + postMessage)
 * 2. Auto-translate subtitles to target language
 * 3. Fetch English captions via timedtext API → translate → show transcript panel
 */

class YouTubeSubtitleManager {
  constructor(translator, targetLang) {
    this.translator = translator;
    this.targetLang = targetLang;
    this._iframes = [];
    this._transcriptPanels = new Map(); // iframe → panel element
  }

  /**
   * Initialize: find all YouTube embeds, enable subtitles, and create transcript panels.
   */
  async initialize() {
    const iframes = document.querySelectorAll('iframe[src*="youtube.com/embed"], iframe[src*="youtube-nocookie.com/embed"]');
    if (iframes.length === 0) {
      console.log('[SkillBridge] No YouTube embeds found');
      return;
    }

    console.log(`[SkillBridge] Found ${iframes.length} YouTube embed(s)`);

    for (const iframe of iframes) {
      this._enableAutoSubtitles(iframe);
      this._iframes.push(iframe);

      // Create transcript panel below each video
      if (this.targetLang && this.targetLang !== 'en') {
        this._createTranscriptPanel(iframe);
      }
    }
  }

  /**
   * Update target language and re-apply to all iframes.
   */
  setLanguage(newLang) {
    this.targetLang = newLang;
    for (const iframe of this._iframes) {
      this._enableAutoSubtitles(iframe);

      if (newLang && newLang !== 'en') {
        this._createTranscriptPanel(iframe);
      } else {
        this._removeTranscriptPanel(iframe);
      }
    }
  }

  destroy() {
    for (const iframe of this._iframes) {
      this._removeTranscriptPanel(iframe);
    }
    this._iframes = [];
    this._transcriptPanels.clear();
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

  _enableAutoSubtitles(iframe) {
    const url = new URL(iframe.src);
    url.searchParams.set('enablejsapi', '1');
    url.searchParams.set('cc_load_policy', '1');

    if (this.targetLang && this.targetLang !== 'en') {
      url.searchParams.set('cc_lang_pref', this._ytLangCode(this.targetLang));
      url.searchParams.set('hl', this._ytLangCode(this.targetLang));
    }

    const newSrc = url.toString();
    if (iframe.src !== newSrc) {
      console.log(`[SkillBridge] Enabling auto-subtitles (${this.targetLang}) for YouTube embed`);
      iframe.src = newSrc;

      if (this.targetLang && this.targetLang !== 'en') {
        iframe.addEventListener('load', () => {
          this._setAutoTranslate(iframe);
        }, { once: true });
      }
    }
  }

  _setAutoTranslate(iframe) {
    const ytLang = this._ytLangCode(this.targetLang);
    setTimeout(() => {
      try {
        iframe.contentWindow.postMessage(JSON.stringify({
          event: 'command', func: 'loadModule', args: ['captions']
        }), '*');

        setTimeout(() => {
          try {
            iframe.contentWindow.postMessage(JSON.stringify({
              event: 'command', func: 'setOption',
              args: ['captions', 'track', {
                languageCode: 'en',
                translationLanguage: {
                  languageCode: ytLang,
                  languageName: this._ytLangName(this.targetLang)
                }
              }]
            }), '*');
            console.log(`[SkillBridge] Sent auto-translate command (${ytLang})`);
          } catch (err) {
            console.warn('[SkillBridge] setOption failed:', err);
          }
        }, 1500);
      } catch (err) {
        console.warn('[SkillBridge] Auto-translate setup failed:', err);
      }
    }, 2000);
  }

  // ==================== TRANSCRIPT PANEL ====================

  _getVideoId(iframe) {
    try {
      const url = new URL(iframe.src);
      // pathname is like /embed/VIDEO_ID — get last segment, strip any params
      const parts = url.pathname.split('/').filter(Boolean);
      const raw = parts[parts.length - 1] || '';
      // Clean: remove query fragments that might be stuck
      return raw.split('?')[0].split('&')[0] || null;
    } catch { return null; }
  }

  /**
   * Fetch English captions from YouTube.
   * Strategy: Try page scrape first, fall back to timedtext direct URL.
   */
  async _fetchCaptions(videoId) {
    // Method 1: Scrape the YouTube watch page for captionTracks
    const tracks = await this._scrapeCaptionTracks(videoId);
    if (tracks) {
      const captions = await this._fetchFromTrack(tracks);
      if (captions) return captions;
    }

    // Method 2: Direct timedtext API (works for some auto-generated captions)
    const directCaptions = await this._fetchTimedTextDirect(videoId);
    if (directCaptions) return directCaptions;

    console.log('[SkillBridge] All caption fetch methods failed for', videoId);
    return null;
  }

  /**
   * Method 1: Scrape YouTube page for caption track URLs.
   */
  async _scrapeCaptionTracks(videoId) {
    try {
      const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const pageResp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'FETCH_URL', url: pageUrl }, resolve);
      });

      if (!pageResp?.ok) {
        console.log('[SkillBridge] YouTube page fetch failed:', pageResp?.error);
        return null;
      }

      // Try multiple regex patterns — YouTube changes their page structure
      const patterns = [
        /"captionTracks":(\[.*?\])(?=,")/,
        /"captionTracks":\s*(\[.+?\])\s*[,}]/,
        /captionTracks\\?":\s*(\[.+?\])/,
      ];

      let rawJson = null;
      for (const pat of patterns) {
        const m = pageResp.data.match(pat);
        if (m) { rawJson = m[1]; break; }
      }

      if (!rawJson) {
        console.log('[SkillBridge] No captionTracks in page data');
        return null;
      }

      // Clean escaped characters
      rawJson = rawJson
        .replace(/\\u0026/g, '&')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');

      const tracks = JSON.parse(rawJson);
      if (!Array.isArray(tracks) || tracks.length === 0) return null;

      // Prefer: manual English > auto English > any first track
      return tracks.find(t => t.languageCode === 'en' && t.kind !== 'asr') ||
             tracks.find(t => t.languageCode === 'en') ||
             tracks[0];
    } catch (err) {
      console.warn('[SkillBridge] Caption track scrape failed:', err);
      return null;
    }
  }

  /**
   * Fetch captions from a track's baseUrl in json3 format.
   */
  async _fetchFromTrack(track) {
    if (!track?.baseUrl) return null;
    try {
      const url = track.baseUrl + (track.baseUrl.includes('?') ? '&' : '?') + 'fmt=json3';
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'FETCH_URL', url }, resolve);
      });
      if (!resp?.ok) return null;
      return this._parseJson3(resp.data);
    } catch (err) {
      console.warn('[SkillBridge] Track fetch failed:', err);
      return null;
    }
  }

  /**
   * Method 2: Direct timedtext API — works for videos with auto-generated captions.
   */
  async _fetchTimedTextDirect(videoId) {
    try {
      // Try auto-generated English captions directly
      const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&kind=asr&fmt=json3`;
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'FETCH_URL', url }, resolve);
      });
      if (resp?.ok) {
        const captions = this._parseJson3(resp.data);
        if (captions) return captions;
      }

      // Try manual English captions
      const url2 = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3`;
      const resp2 = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'FETCH_URL', url: url2 }, resolve);
      });
      if (resp2?.ok) {
        return this._parseJson3(resp2.data);
      }

      return null;
    } catch (err) {
      console.warn('[SkillBridge] Direct timedtext failed:', err);
      return null;
    }
  }

  /**
   * Parse YouTube json3 caption format into our array format.
   */
  _parseJson3(rawData) {
    try {
      const data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      if (!data?.events) return null;

      const captions = data.events
        .filter(e => e.segs && e.segs.length > 0)
        .map(e => ({
          start: Math.floor((e.tStartMs || 0) / 1000),
          text: e.segs.map(s => s.utf8 || '').join('').trim()
        }))
        .filter(e => e.text.length > 0);

      return captions.length > 0 ? captions : null;
    } catch {
      return null;
    }
  }

  /**
   * Translate captions using Google Translate batch via background proxy.
   */
  async _translateCaptions(captions, targetLang) {
    const batchSize = 20;
    const translated = [];

    for (let i = 0; i < captions.length; i += batchSize) {
      const batch = captions.slice(i, i + batchSize);
      const texts = batch.map(c => c.text);

      try {
        const results = await this.translator.googleTranslateBatch(texts, targetLang);
        for (let j = 0; j < batch.length; j++) {
          translated.push({
            start: batch[j].start,
            original: batch[j].text,
            translated: results[j] || batch[j].text,
          });
        }
      } catch {
        for (const c of batch) {
          translated.push({ start: c.start, original: c.text, translated: c.text });
        }
      }
    }
    return translated;
  }

  _formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * Create or update the transcript panel below a YouTube iframe.
   */
  async _createTranscriptPanel(iframe) {
    const videoId = this._getVideoId(iframe);
    if (!videoId) return;

    this._removeTranscriptPanel(iframe);

    const langLabel = this._ytLangName(this.targetLang) || this.targetLang.toUpperCase();

    const panel = document.createElement('div');
    panel.className = 'sb-transcript-panel'; // starts collapsed
    panel.setAttribute('translate', 'no'); // prevent browser/extension translation
    panel.innerHTML = `
      <div class="sb-transcript-header">
        <span class="sb-transcript-arrow">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M6 3l5 5-5 5V3z"/></svg>
        </span>
        <span class="sb-transcript-header-title">Video Script</span>
        <div class="sb-transcript-header-meta">
          <button class="sb-transcript-toggle-lang" title="Toggle EN / ${langLabel}" style="display:none">EN ↔ ${langLabel}</button>
        </div>
      </div>
      <div class="sb-transcript-body">
        <div class="sb-transcript-loading">
          <span class="si18n-thinking-dots">
            <span class="si18n-dot"></span><span class="si18n-dot"></span><span class="si18n-dot"></span>
          </span>
          <span style="margin-left:8px">Loading...</span>
        </div>
      </div>
    `;

    // Insert after iframe or its parent wrapper
    const wrapper = iframe.closest('.embed-responsive, .video-wrapper, .sj-lesson-video') || iframe.parentElement;
    if (wrapper && wrapper.parentElement) {
      wrapper.parentElement.insertBefore(panel, wrapper.nextSibling);
    } else {
      iframe.parentElement.insertBefore(panel, iframe.nextSibling);
    }
    this._transcriptPanels.set(iframe, panel);

    // Toggle expand/collapse — click header to toggle
    const header = panel.querySelector('.sb-transcript-header');
    const body = panel.querySelector('.sb-transcript-body');
    header.addEventListener('click', (e) => {
      // Don't toggle when clicking the lang button
      if (e.target.closest('.sb-transcript-toggle-lang')) return;
      panel.classList.toggle('expanded');
    });

    // Fetch and translate captions
    const captions = await this._fetchCaptions(videoId);
    if (!captions || captions.length === 0) {
      body.innerHTML = '<div class="sb-transcript-empty">Captions not available for this video.</div>';
      // Auto-expand to show empty state, then allow toggle
      panel.classList.add('expanded');
      return;
    }

    const translated = await this._translateCaptions(captions, this.targetLang);

    // Show the toggle button now that we have data
    const toggleBtnEl = panel.querySelector('.sb-transcript-toggle-lang');
    if (toggleBtnEl) toggleBtnEl.style.display = '';

    // Render lines
    let showOriginal = false;
    const linesHtml = translated.map(line => `
      <div class="sb-transcript-line" data-time="${line.start}">
        <span class="sb-transcript-time">${this._formatTime(line.start)}</span>
        <span class="sb-transcript-text" data-original="${this._esc(line.original)}" data-translated="${this._esc(line.translated)}">${line.translated}</span>
      </div>
    `).join('');

    body.innerHTML = `<div class="sb-transcript-lines">${linesHtml}</div>`;

    // Toggle EN ↔ target language
    const toggleBtn = panel.querySelector('.sb-transcript-toggle-lang');
    toggleBtn.addEventListener('click', () => {
      showOriginal = !showOriginal;
      toggleBtn.textContent = showOriginal ? `EN ↔ ${langLabel}` : `${langLabel} ↔ EN`;
      panel.querySelectorAll('.sb-transcript-text').forEach(el => {
        el.textContent = showOriginal ? el.dataset.original : el.dataset.translated;
      });
    });

    // Click timestamp → seek video
    body.addEventListener('click', (e) => {
      const line = e.target.closest('.sb-transcript-line');
      if (!line) return;
      const time = parseInt(line.dataset.time, 10);
      if (isNaN(time)) return;

      try {
        iframe.contentWindow.postMessage(JSON.stringify({
          event: 'command', func: 'seekTo', args: [time, true]
        }), '*');
      } catch (err) { console.warn('[SkillBridge] Seek failed:', err); }

      panel.querySelectorAll('.sb-transcript-line.active').forEach(el => el.classList.remove('active'));
      line.classList.add('active');
    });

    console.log(`[SkillBridge] Transcript panel ready (${translated.length} lines)`);
  }

  _removeTranscriptPanel(iframe) {
    const panel = this._transcriptPanels.get(iframe);
    if (panel) { panel.remove(); this._transcriptPanels.delete(iframe); }
  }

  _esc(text) {
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

if (typeof window !== 'undefined') {
  window.YouTubeSubtitleManager = YouTubeSubtitleManager;
}
