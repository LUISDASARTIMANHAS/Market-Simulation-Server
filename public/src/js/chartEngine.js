/**
 * Motor de Gráficos e Indicadores Técnicos do Mercado Simulado.
 * Suporta canvas de alta resolução (Retina/DPI), indicadores técnicos (SMA, Bollinger, RSI),
 * múltiplos timeframes, visualizações em Linha/Área e Candlestick, crosshair interativo e sparklines.
 */

import { money, number, formatTime } from './common.js';

/**
 * Calcula Média Móvel Simples (SMA).
 * @param {Array<{ price: number }>} ticks
 * @param {number} period
 * @returns {Array<number|null>}
 */
export function calculateSMA(ticks, period) {
  const result = [];
  for (let i = 0; i < ticks.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += ticks[i - j].price;
      }
      result.push(sum / period);
    }
  }
  return result;
}

/**
 * Calcula Bandas de Bollinger (Média Móvel e faixas de desvio padrão).
 * @param {Array<{ price: number }>} ticks
 * @param {number} period
 * @param {number} multiplier
 * @returns {Array<{ upper: number|null, middle: number|null, lower: number|null }>}
 */
export function calculateBollingerBands(ticks, period = 20, multiplier = 2) {
  const sma = calculateSMA(ticks, period);
  const result = [];

  for (let i = 0; i < ticks.length; i++) {
    const middle = sma[i];
    if (middle === null) {
      result.push({ upper: null, middle: null, lower: null });
      continue;
    }

    let varianceSum = 0;
    for (let j = 0; j < period; j++) {
      varianceSum += Math.pow(ticks[i - j].price - middle, 2);
    }
    const stdDev = Math.sqrt(varianceSum / period);
    result.push({
      upper: middle + multiplier * stdDev,
      middle,
      lower: middle - multiplier * stdDev,
    });
  }

  return result;
}

/**
 * Calcula o Índice de Força Relativa (RSI).
 * @param {Array<{ price: number }>} ticks
 * @param {number} period
 * @returns {Array<number|null>}
 */
export function calculateRSI(ticks, period = 14) {
  const result = [];
  if (ticks.length <= period) {
    return ticks.map(() => null);
  }

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = ticks[i].price - ticks[i - 1].price;
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Primeiro valor do RSI
  for (let i = 0; i < period; i++) {
    result.push(null);
  }

  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + rs)));

  // Valores subsequentes usando alisamento de Wilder
  for (let i = period + 1; i < ticks.length; i++) {
    const diff = ticks[i].price - ticks[i - 1].price;
    const currentGain = diff > 0 ? diff : 0;
    const currentLoss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + currentGain) / period;
    avgLoss = (avgLoss * (period - 1) + currentLoss) / period;

    if (avgLoss === 0) {
      result.push(100);
    } else {
      rs = avgGain / avgLoss;
      result.push(100 - (100 / (1 + rs)));
    }
  }

  return result;
}

/**
 * Agrupa ticks em velas no estilo Candlestick japonês.
 * @param {Array<{ price: number, updatedAt: string, sequence: number }>} ticks
 * @param {number} groupSize Quantidade de ticks por vela (mínimo 2)
 */
export function groupIntoCandles(ticks, groupSize = 3) {
  if (!ticks || !ticks.length) return [];
  const candles = [];
  const size = Math.max(2, groupSize);

  for (let i = 0; i < ticks.length; i += size) {
    const group = ticks.slice(i, i + size);
    const open = group[0].price;
    const close = group[group.length - 1].price;
    let high = -Infinity;
    let low = Infinity;

    for (const tick of group) {
      if (tick.price > high) high = tick.price;
      if (tick.price < low) low = tick.price;
    }

    candles.push({
      open,
      high,
      low,
      close,
      isUp: close >= open,
      updatedAt: group[group.length - 1].updatedAt,
      sequence: group[group.length - 1].sequence,
    });
  }

  return candles;
}

/**
 * Calcula métricas e estatísticas de mercado para a janela atual.
 * @param {Array<{ price: number }>} ticks
 */
export function calculateMarketStats(ticks) {
  if (!ticks || !ticks.length) {
    return {
      startPrice: 0,
      currentPrice: 0,
      change: 0,
      changePercent: 0,
      high: 0,
      low: 0,
      spread: 0,
      volatility: 0,
      rsi: null,
      trend: 'Neutro',
      trendClass: 'trend-neutral',
    };
  }

  const prices = ticks.map((t) => t.price);
  const startPrice = prices[0];
  const currentPrice = prices[prices.length - 1];
  const change = currentPrice - startPrice;
  const changePercent = startPrice > 0 ? (change / startPrice) * 100 : 0;
  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const spread = high - low;
  const volatility = low > 0 ? (spread / low) * 100 : 0;

  const rsiList = calculateRSI(ticks, Math.min(14, Math.max(3, Math.floor(ticks.length / 2))));
  const currentRsi = rsiList.length ? rsiList[rsiList.length - 1] : null;

  const smaShort = calculateSMA(ticks, Math.min(7, Math.max(2, Math.floor(ticks.length / 3))));
  const lastSmaShort = smaShort[smaShort.length - 1];

  let trend = 'Consolidação / Neutro';
  let trendClass = 'trend-neutral';

  if (currentRsi !== null && lastSmaShort !== null) {
    if (currentPrice >= lastSmaShort && currentRsi >= 60) {
      trend = 'Forte Alta 🟢';
      trendClass = 'trend-bullish';
    } else if (currentPrice >= lastSmaShort || currentRsi >= 52) {
      trend = 'Tendência de Alta 📈';
      trendClass = 'trend-bullish';
    } else if (currentPrice < lastSmaShort && currentRsi <= 40) {
      trend = 'Forte Baixa 🔴';
      trendClass = 'trend-bearish';
    } else if (currentPrice < lastSmaShort || currentRsi <= 48) {
      trend = 'Tendência de Baixa 📉';
      trendClass = 'trend-bearish';
    }
  }

  return {
    startPrice,
    currentPrice,
    change,
    changePercent,
    high,
    low,
    spread,
    volatility,
    rsi: currentRsi,
    trend,
    trendClass,
  };
}

/**
 * Desenha um mini-gráfico Sparkline em canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {Array<number>} prices
 * @param {boolean} [isPositive]
 */
export function renderSparkline(canvas, prices, isPositive = true) {
  if (!canvas || !prices || prices.length < 2) return;
  const pixelRatio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 80;
  const height = canvas.clientHeight || 24;

  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);

  const ctx = canvas.getContext('2d');
  ctx.scale(pixelRatio, pixelRatio);
  ctx.clearRect(0, 0, width, height);

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const spread = max - min || 0.01;

  const points = prices.map((price, i) => ({
    x: (i / (prices.length - 1)) * (width - 4) + 2,
    y: height - 2 - ((price - min) / spread) * (height - 6),
  }));

  const strokeColor = isPositive ? '#61dfb2' : '#ff8d93';

  // Área preenchida com transparência
  ctx.beginPath();
  ctx.moveTo(points[0].x, height);
  points.forEach((pt) => ctx.lineTo(pt.x, pt.y));
  ctx.lineTo(points[points.length - 1].x, height);
  ctx.closePath();
  ctx.fillStyle = isPositive ? 'rgba(97, 223, 178, 0.12)' : 'rgba(255, 141, 147, 0.12)';
  ctx.fill();

  // Linha de contorno
  ctx.beginPath();
  points.forEach((pt, i) => {
    if (i === 0) ctx.moveTo(pt.x, pt.y);
    else ctx.lineTo(pt.x, pt.y);
  });
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Ponto no último valor
  const last = points[points.length - 1];
  ctx.beginPath();
  ctx.arc(last.x, last.y, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = strokeColor;
  ctx.fill();
}

/**
 * Controlador de Gráfico de Mercado Avançado.
 */
export class AdvancedMarketChart {
  constructor(canvas, tooltipElement) {
    this.canvas = canvas;
    this.tooltip = tooltipElement;
    this.ctx = canvas.getContext('2d');

    // Configurações de exibição
    this.timeframe = '30'; // '15', '30', '50', 'ALL'
    this.chartType = 'area'; // 'area', 'candles'
    this.indicators = {
      sma: true,
      bollinger: false,
      rsi: false,
    };

    this.rawHistory = [];
    this.hoverIndex = null;
    this.hoverPos = null;

    this._bindEvents();
  }

  _bindEvents() {
    const handleMove = (clientX, clientY) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      if (x < 0 || x > rect.width || y < 0 || y > rect.height) {
        this.clearHover();
        return;
      }

      this.hoverPos = { x, y };
      this.render();
    };

    this.canvas.addEventListener('mousemove', (e) => handleMove(e.clientX, e.clientY));
    this.canvas.addEventListener('mouseleave', () => this.clearHover());

    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches[0]) {
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    this.canvas.addEventListener('touchmove', (e) => {
      if (e.touches && e.touches[0]) {
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    this.canvas.addEventListener('touchend', () => this.clearHover());
  }

  clearHover() {
    this.hoverIndex = null;
    this.hoverPos = null;
    if (this.tooltip) {
      this.tooltip.hidden = true;
    }
    this.render();
  }

  setTimeframe(tf) {
    this.timeframe = tf;
    this.render();
  }

  setChartType(type) {
    this.chartType = type;
    this.render();
  }

  toggleIndicator(name) {
    if (name in this.indicators) {
      this.indicators[name] = !this.indicators[name];
      this.render();
    }
  }

  setHistory(history) {
    this.rawHistory = Array.isArray(history) ? history : [];
    this.render();
  }

  getFilteredHistory() {
    if (!this.rawHistory.length) return [];
    if (this.timeframe === 'ALL') return this.rawHistory;
    const count = parseInt(this.timeframe, 10) || 30;
    return this.rawHistory.slice(-count);
  }

  render() {
    const canvas = this.canvas;
    if (!canvas) return;

    const bounds = canvas.getBoundingClientRect();
    const pixelRatio = window.devicePixelRatio || 1;
    const width = Math.max(bounds.width, 100);
    const totalHeight = Math.max(bounds.height, 100);

    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(totalHeight * pixelRatio);

    const ctx = this.ctx;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, width, totalHeight);

    const data = this.getFilteredHistory();
    if (!data.length) {
      ctx.fillStyle = '#98a7b8';
      ctx.font = '13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Aguardando dados de mercado…', width / 2, totalHeight / 2);
      return;
    }

    // Divisão do espaço se RSI estiver ativo
    const hasRsi = this.indicators.rsi && data.length >= 5;
    const rsiHeight = hasRsi ? Math.min(80, totalHeight * 0.3) : 0;
    const priceHeight = totalHeight - rsiHeight - (hasRsi ? 16 : 0);

    const padding = { top: 18, right: 65, bottom: 24, left: 14 };
    const chartW = width - padding.left - padding.right;
    const chartH = priceHeight - padding.top - padding.bottom;

    // Métricas de preço
    const prices = data.map((t) => t.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const rawSpread = maxPrice - minPrice;
    // Margem superior e inferior para os indicadores não cortarem
    const margin = rawSpread === 0 ? maxPrice * 0.01 || 0.1 : rawSpread * 0.1;
    const yMin = minPrice - margin;
    const yMax = maxPrice + margin;
    const spread = yMax - yMin;

    const isPositive = prices[prices.length - 1] >= prices[0];
    const themeColor = isPositive ? '#61dfb2' : '#ff8d93';
    const themeGradient = isPositive ? 'rgba(97, 223, 178,' : 'rgba(255, 141, 147,';

    // 1. Grade de fundo e Eixo Y
    this._drawGrid(ctx, padding, chartW, chartH, yMin, yMax, width);

    // 2. Bandas de Bollinger (se ativadas)
    if (this.indicators.bollinger && data.length >= 5) {
      this._drawBollinger(ctx, data, padding, chartW, chartH, yMin, spread);
    }

    // 3. Gráfico Principal (Área/Linha ou Candlestick)
    let points = [];
    if (this.chartType === 'candles') {
      points = this._drawCandlesticks(ctx, data, padding, chartW, chartH, yMin, spread);
    } else {
      points = this._drawAreaChart(ctx, data, padding, chartW, chartH, yMin, spread, themeColor, themeGradient);
    }

    // 4. Médias Móveis (SMA 9 e SMA 21)
    if (this.indicators.sma && data.length >= 5) {
      this._drawSMA(ctx, data, 9, '#e5ac59', padding, chartW, chartH, yMin, spread);
      if (data.length >= 15) {
        this._drawSMA(ctx, data, 21, '#5bc0de', padding, chartW, chartH, yMin, spread);
      }
    }

    // 5. Linha de Preço Atual (Horizontal tracejada)
    this._drawCurrentPriceLine(ctx, prices[prices.length - 1], padding, chartW, chartH, yMin, spread, themeColor, width);

    // 6. Sub-painel RSI (se ativado)
    if (hasRsi) {
      const rsiY = priceHeight + 16;
      this._drawRSI(ctx, data, padding, chartW, rsiHeight, rsiY, width);
    }

    // 7. Crosshair e Tooltip Interativo
    if (this.hoverPos && points.length) {
      this._drawCrosshair(ctx, this.hoverPos, points, data, padding, chartW, chartH, yMin, spread, width, totalHeight, hasRsi);
    }
  }

  _drawGrid(ctx, padding, chartW, chartH, yMin, yMax, fullWidth) {
    const steps = 4;
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    ctx.fillStyle = '#64748b';
    ctx.font = '10px Inter, monospace';
    ctx.textAlign = 'left';

    for (let i = 0; i <= steps; i++) {
      const y = padding.top + (i / steps) * chartH;
      const priceVal = yMax - (i / steps) * (yMax - yMin);

      // Linha horizontal
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartW, y);
      ctx.stroke();

      // Rótulo de preço no eixo Y direito
      ctx.fillText(`$${priceVal.toFixed(2)}`, padding.left + chartW + 8, y + 3.5);
    }

    ctx.setLineDash([]);
  }

  _drawAreaChart(ctx, data, padding, chartW, chartH, yMin, spread, themeColor, themeGradient) {
    const points = data.map((tick, index) => {
      const x = data.length === 1
        ? padding.left + chartW / 2
        : padding.left + (index / (data.length - 1)) * chartW;
      const y = padding.top + chartH - ((tick.price - yMin) / spread) * chartH;
      return { x, y, tick, index };
    });

    if (points.length < 2) {
      return points;
    }

    // Gradiente sob a linha
    const grad = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
    grad.addColorStop(0, `${themeGradient} 0.28)`);
    grad.addColorStop(0.7, `${themeGradient} 0.06)`);
    grad.addColorStop(1, `${themeGradient} 0.0)`);

    ctx.beginPath();
    ctx.moveTo(points[0].x, padding.top + chartH);
    points.forEach((pt) => ctx.lineTo(pt.x, pt.y));
    ctx.lineTo(points[points.length - 1].x, padding.top + chartH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Linha principal com traço suave
    ctx.beginPath();
    points.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Ponto no último tick
    const last = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = themeColor;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(last.x, last.y, 7, 0, Math.PI * 2);
    ctx.strokeStyle = `${themeGradient} 0.4)`;
    ctx.lineWidth = 2;
    ctx.stroke();

    return points;
  }

  _drawCandlesticks(ctx, data, padding, chartW, chartH, yMin, spread) {
    const candles = groupIntoCandles(data, Math.max(2, Math.floor(data.length / 18)));
    if (!candles.length) return [];

    const candleWidth = Math.max(4, (chartW / candles.length) * 0.65);
    const points = [];

    candles.forEach((candle, index) => {
      const x = candles.length === 1
        ? padding.left + chartW / 2
        : padding.left + (index / (candles.length - 1)) * chartW;

      const yOpen = padding.top + chartH - ((candle.open - yMin) / spread) * chartH;
      const yClose = padding.top + chartH - ((candle.close - yMin) / spread) * chartH;
      const yHigh = padding.top + chartH - ((candle.high - yMin) / spread) * chartH;
      const yLow = padding.top + chartH - ((candle.low - yMin) / spread) * chartH;

      const color = candle.isUp ? '#61dfb2' : '#ff8d93';

      // Sombra / Pavio (High - Low)
      ctx.beginPath();
      ctx.moveTo(x, yHigh);
      ctx.lineTo(x, yLow);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Corpo da vela (Open - Close)
      const topY = Math.min(yOpen, yClose);
      const bodyH = Math.max(2, Math.abs(yClose - yOpen));

      ctx.fillStyle = color;
      ctx.fillRect(x - candleWidth / 2, topY, candleWidth, bodyH);

      points.push({
        x,
        y: yClose,
        tick: { price: candle.close, updatedAt: candle.updatedAt, sequence: candle.sequence },
        index,
        candle,
      });
    });

    return points;
  }

  _drawSMA(ctx, data, period, color, padding, chartW, chartH, yMin, spread) {
    const smaValues = calculateSMA(data, period);
    ctx.beginPath();
    let started = false;

    data.forEach((tick, i) => {
      const val = smaValues[i];
      if (val === null) return;

      const x = data.length === 1
        ? padding.left + chartW / 2
        : padding.left + (i / (data.length - 1)) * chartW;
      const y = padding.top + chartH - ((val - yMin) / spread) * chartH;

      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.stroke();
  }

  _drawBollinger(ctx, data, padding, chartW, chartH, yMin, spread) {
    const bands = calculateBollingerBands(data, Math.min(20, Math.max(5, Math.floor(data.length * 0.6))));
    const upperPoints = [];
    const lowerPoints = [];

    data.forEach((tick, i) => {
      const b = bands[i];
      if (!b || b.upper === null || b.lower === null) return;

      const x = data.length === 1
        ? padding.left + chartW / 2
        : padding.left + (i / (data.length - 1)) * chartW;
      const yUpper = padding.top + chartH - ((b.upper - yMin) / spread) * chartH;
      const yLower = padding.top + chartH - ((b.lower - yMin) / spread) * chartH;

      upperPoints.push({ x, y: yUpper });
      lowerPoints.push({ x, y: yLower });
    });

    if (upperPoints.length < 2) return;

    // Faixa preenchida semitransparente entre as bandas
    ctx.beginPath();
    upperPoints.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    for (let i = lowerPoints.length - 1; i >= 0; i--) {
      ctx.lineTo(lowerPoints[i].x, lowerPoints[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(91, 192, 222, 0.08)';
    ctx.fill();

    // Contorno da banda superior e inferior
    [upperPoints, lowerPoints].forEach((pts) => {
      ctx.beginPath();
      pts.forEach((pt, i) => {
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.strokeStyle = 'rgba(91, 192, 222, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
    });
    ctx.setLineDash([]);
  }

  _drawCurrentPriceLine(ctx, currentPrice, padding, chartW, chartH, yMin, spread, color, fullWidth) {
    const y = padding.top + chartH - ((currentPrice - yMin) / spread) * chartH;

    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + chartW, y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Etiqueta com fundo sólido na lateral
    const tagW = 60;
    const tagH = 18;
    const tagX = padding.left + chartW + 4;
    const tagY = y - tagH / 2;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(tagX, tagY, tagW, tagH, 4);
    ctx.fill();

    ctx.fillStyle = '#071710';
    ctx.font = 'bold 10px Inter, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`$${currentPrice.toFixed(2)}`, tagX + tagW / 2, tagY + 12.5);
  }

  _drawRSI(ctx, data, padding, chartW, rsiHeight, rsiY, fullWidth) {
    const rsiValues = calculateRSI(data, Math.min(14, Math.max(3, Math.floor(data.length / 2))));

    // Fundo do sub-painel
    ctx.fillStyle = '#0f1723';
    ctx.fillRect(padding.left, rsiY, chartW, rsiHeight);

    // Faixa 30-70 sombreada
    const y70 = rsiY + rsiHeight * 0.3;
    const y30 = rsiY + rsiHeight * 0.7;

    ctx.fillStyle = 'rgba(179, 136, 255, 0.06)';
    ctx.fillRect(padding.left, y70, chartW, y30 - y70);

    // Linhas guias 70 e 30
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);

    [y70, y30].forEach((lineY) => {
      ctx.beginPath();
      ctx.moveTo(padding.left, lineY);
      ctx.lineTo(padding.left + chartW, lineY);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    // Textos do RSI
    ctx.fillStyle = '#64748b';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('70', padding.left + chartW + 6, y70 + 3);
    ctx.fillText('30', padding.left + chartW + 6, y30 + 3);

    // Título do RSI
    const lastRsi = rsiValues.length ? rsiValues[rsiValues.length - 1] : null;
    ctx.fillStyle = '#b388ff';
    ctx.font = '10px Inter, sans-serif';
    ctx.fillText(`RSI (14)${lastRsi !== null ? `: ${lastRsi.toFixed(1)}` : ''}`, padding.left + 8, rsiY + 14);

    // Linha do RSI
    ctx.beginPath();
    let started = false;
    data.forEach((_, i) => {
      const val = rsiValues[i];
      if (val === null) return;

      const x = data.length === 1
        ? padding.left + chartW / 2
        : padding.left + (i / (data.length - 1)) * chartW;
      const y = rsiY + rsiHeight - (val / 100) * rsiHeight;

      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.strokeStyle = '#b388ff';
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  _drawCrosshair(ctx, pos, points, data, padding, chartW, chartH, yMin, spread, fullWidth, fullHeight, hasRsi) {
    // Acha o ponto mais próximo horizontalmente da posição do mouse
    let closest = points[0];
    let minDist = Infinity;

    for (const pt of points) {
      const dist = Math.abs(pt.x - pos.x);
      if (dist < minDist) {
        minDist = dist;
        closest = pt;
      }
    }

    if (!closest) return;

    // Linha vertical (guia de tempo)
    ctx.beginPath();
    ctx.moveTo(closest.x, padding.top);
    ctx.lineTo(closest.x, fullHeight - padding.bottom);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();

    // Linha horizontal (guia de preço)
    ctx.beginPath();
    ctx.moveTo(padding.left, closest.y);
    ctx.lineTo(padding.left + chartW, closest.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Ponto destacado com halo
    ctx.beginPath();
    ctx.arc(closest.x, closest.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(closest.x, closest.y, 8, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Atualiza tooltip HTML
    if (this.tooltip) {
      const tick = closest.tick;
      const firstPrice = data[0].price;
      const diff = tick.price - firstPrice;
      const diffPct = firstPrice > 0 ? (diff / firstPrice) * 100 : 0;
      const isUp = diff >= 0;

      this.tooltip.innerHTML = `
        <div class="tooltip-time">${formatTime(tick.updatedAt)} <span class="tooltip-seq">#${tick.sequence}</span></div>
        <div class="tooltip-price">${money(tick.price)}</div>
        <div class="tooltip-diff ${isUp ? 'positive' : 'negative'}">
          ${isUp ? '▲ +' : '▼ '}${money(diff)} (${isUp ? '+' : ''}${diffPct.toFixed(2)}%)
        </div>
      `;

      this.tooltip.hidden = false;

      // Posiciona tooltip
      const tooltipW = 150;
      let left = closest.x + 12;
      if (left + tooltipW > fullWidth) {
        left = closest.x - tooltipW - 12;
      }
      let top = Math.max(10, closest.y - 40);

      this.tooltip.style.left = `${Math.max(10, left)}px`;
      this.tooltip.style.top = `${top}px`;
    }
  }
}

