/**
 * ScriptMasterLabs (SML) Leviathan Matrix API - Official Node.js SDK
 * Quant & Institutional Trader Integration
 */

class LeviathanClient {
  constructor(options = {}) {
    this.apiBase = (options.apiBase || 'https://sml-x402-signal-api.onrender.com').replace(/\/$/, '');
    this.apiToken = options.apiToken || null;
  }

  /**
   * Fetch 65-min delayed Shadow tier signal (Free for backtesting)
   */
  async getShadowSignal(ticker = 'GME') {
    const response = await fetch(`${this.apiBase}/matrix/${ticker.toUpperCase()}/delayed`);
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${await response.text()}`);
    }
    return await response.json();
  }

  /**
   * Fetch real-time squeeze signal using 30-day access token
   */
  async getLiveSignal(ticker = 'GME', accessToken = null) {
    const token = accessToken || this.apiToken;
    if (!token) {
      throw new Error("Live feed requires a 30-day token. Buy via subscription endpoint.");
    }
    const response = await fetch(`${this.apiBase}/matrix/${ticker.toUpperCase()}/live`, {
      headers: { 'X-Access-Token': token }
    });
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${await response.text()}`);
    }
    return await response.json();
  }

  /**
   * Check accrued affiliate earnings (15% revenue share)
   */
  async getAffiliateStats(walletAddress) {
    const response = await fetch(`${this.apiBase}/affiliate/${walletAddress}`);
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${await response.text()}`);
    }
    return await response.json();
  }
}

module.exports = LeviathanClient;
